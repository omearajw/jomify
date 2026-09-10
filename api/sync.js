import { applyCors } from './_lib/cors.js';
import { resolveUserId, AuthError } from './_lib/auth.js';
import { redis, KEYS, BACKUP_DEPTH } from './_lib/redis.js';
import {
  mergeSyncDoc,
  clampFutureTimestamps,
  findForbiddenKey,
  SCHEMA_VERSION
} from '../src/sync/mergeSyncDoc.js';

// The sync endpoint.
//
// THERE IS NO REPLACE OPERATION HERE, BY DESIGN. POST merges the incoming document with the
// stored one and returns the result. A device that sends an empty document therefore cannot
// delete anything -- absence of a folder is not an opinion about that folder. Deletion is only
// expressible as an explicit tombstone carrying a timestamp. This property is what makes it safe
// for a freshly-installed phone to talk to an account full of folders.

const MAX_BODY_BYTES = 256 * 1024;

async function readStoredDoc(userId) {
  const raw = await redis().get(KEYS.doc(userId));
  if (!raw) return null;
  // Upstash may hand back an already-parsed object or a JSON string depending on how it was set
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return; // preflight handled

  const serverTime = Date.now();

  try {
    if (req.method === 'GET') {
      const userId = await resolveUserId(req);
      const [doc, revision] = await Promise.all([
        readStoredDoc(userId),
        redis().get(KEYS.rev(userId))
      ]);

      return res.status(200).json({
        doc,
        revision: Number(revision) || 0,
        serverTime
      });
    }

    if (req.method === 'POST') {
      const body = req.body ?? {};

      if (body.schemaVersion !== SCHEMA_VERSION) {
        return res.status(400).json({
          error: `Unsupported schemaVersion (expected ${SCHEMA_VERSION}, got ${body.schemaVersion})`
        });
      }

      const incoming = body.doc;
      if (!incoming || typeof incoming !== 'object') {
        return res.status(400).json({ error: 'Missing document' });
      }

      const serialized = JSON.stringify(incoming);
      if (serialized.length > MAX_BODY_BYTES) {
        return res.status(413).json({ error: 'Document too large' });
      }

      // Second line of defence. The client builds documents from an explicit whitelist, so this
      // should never fire -- but a synced document is the last place a Spotify refresh token
      // should ever end up.
      const forbidden = findForbiddenKey(incoming);
      if (forbidden) {
        return res.status(400).json({ error: `Document contains a forbidden key: ${forbidden}` });
      }

      const userId = await resolveUserId(req);

      // A document that claims to belong to someone else is refused outright. Combined with the
      // client-side owner check, this makes account mix-ups take three independent failures.
      if (incoming.ownerId && incoming.ownerId !== userId) {
        return res.status(400).json({ error: 'Document owner does not match the authenticated user' });
      }

      // A fast clock must not let one device win every conflict forever
      clampFutureTimestamps(incoming, serverTime);

      const stored = await readStoredDoc(userId);
      const merged = mergeSyncDoc(stored, incoming);
      merged.ownerId = userId;

      // Keep the previous version before overwriting. The merge is commutative and idempotent so
      // a lost update would at worst be one stale field, never a wipe -- but the ring costs a few
      // KB and is the only server-side way back from a bad deploy of the merge itself.
      const writes = [redis().set(KEYS.doc(userId), JSON.stringify(merged))];
      if (stored) {
        writes.push(
          redis().lpush(KEYS.backup(userId), JSON.stringify(stored))
            .then(() => redis().ltrim(KEYS.backup(userId), 0, BACKUP_DEPTH - 1))
        );
      }
      writes.push(redis().incr(KEYS.rev(userId)));

      const results = await Promise.all(writes);
      const revision = Number(results[results.length - 1]) || 0;

      return res.status(200).json({ doc: merged, revision, serverTime });
    }

    res.setHeader('Allow', 'GET, POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (err instanceof AuthError) {
      if (err.status === 503) res.setHeader('Retry-After', '30');
      return res.status(err.status).json({ error: err.message });
    }

    console.error('Sync handler failed:', err);
    res.setHeader('Retry-After', '30');
    return res.status(503).json({ error: 'Sync is temporarily unavailable' });
  }
}
