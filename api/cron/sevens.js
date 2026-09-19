import { redis, KEYS, RedisConfigError } from '../_lib/redis.js';
import { decrypt, encrypt, sendToUser, PUSH_KEYS, PushConfigError } from '../_lib/push.js';

// The Sevens watcher. Runs on a schedule (Vercel cron daily, GitHub Actions every 30 minutes)
// and, for each user with push subscriptions:
//   1. refreshes the server's own Spotify grant,
//   2. reads the user's active Sevens from their sync document,
//   3. looks at who added the last track of each,
//   4. notifies "X dropped a Seven" once per new drop, and reminds every REMINDER_MS while it
//      is still the user's turn.
// Authenticated with CRON_SECRET (Vercel sends it as a bearer token; the GitHub workflow does too).

const REMINDER_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_USERS_PER_RUN = 200;

async function refreshGrant(refreshToken) {
  const clientId = process.env.SPOTIFY_CLIENT_ID || process.env.VITE_SPOTIFY_CLIENT_ID;
  if (!clientId) throw new PushConfigError('SPOTIFY_CLIENT_ID (or VITE_SPOTIFY_CLIENT_ID) is not set.');
  const params = new URLSearchParams({ client_id: clientId, grant_type: 'refresh_token', refresh_token: refreshToken });
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params
  });
  if (!response.ok) {
    const err = new Error(`Spotify refused the refresh (${response.status})`);
    err.status = response.status;
    throw err;
  }
  return await response.json();
}

async function spotifyGet(accessToken, url) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) {
    const err = new Error(`Spotify ${response.status} for ${url}`);
    err.status = response.status;
    throw err;
  }
  return await response.json();
}

async function lastAdder(accessToken, playlistId) {
  const head = await spotifyGet(accessToken, `https://api.spotify.com/v1/playlists/${playlistId}?fields=name,tracks(total)`);
  const total = head.tracks?.total ?? 0;
  if (total === 0) return { name: head.name, total, adderId: null };
  const tail = await spotifyGet(accessToken, `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=1&offset=${total - 1}&fields=items(added_by.id,added_at)`);
  return { name: head.name, total, adderId: tail.items?.[0]?.added_by?.id || null };
}

async function readJson(r, key) {
  const raw = await r.get(key);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

async function checkUser(userId, now) {
  const r = redis();
  const grantBlob = await r.get(PUSH_KEYS.grant(userId));
  if (!grantBlob) return { userId, skipped: 'no grant' };

  let tokens;
  try {
    tokens = await refreshGrant(decrypt(grantBlob));
  } catch (err) {
    // A revoked grant can't recover on its own; drop it so the user is asked to re-enable
    if (err.status === 400 || err.status === 401) await r.del(PUSH_KEYS.grant(userId));
    return { userId, skipped: `refresh failed (${err.status || err.message})` };
  }
  if (tokens.refresh_token) await r.set(PUSH_KEYS.grant(userId), encrypt(tokens.refresh_token));

  const doc = await readJson(r, KEYS.doc(userId));
  const sevens = (doc?.sevens?.v?.list || []).filter((s) => s?.playlistId && s.active !== false);
  if (sevens.length === 0) return { userId, checked: 0, sent: 0 };

  const state = (await readJson(r, PUSH_KEYS.state(userId))) || {};
  let sent = 0;
  for (const seven of sevens) {
    let info;
    try {
      info = await lastAdder(tokens.access_token, seven.playlistId);
    } catch (err) {
      console.warn('[push] playlist check failed', userId, seven.playlistId, err.message);
      continue;
    }
    const prev = state[seven.playlistId] || {};
    const myTurn = Boolean(info.adderId) && info.adderId !== userId;
    const partner = seven.partnerName || 'Your partner';
    const url = `/?open=playlist:${seven.playlistId}`;

    if (!myTurn) {
      state[seven.playlistId] = { total: info.total, notifiedTotal: info.total, lastReminderAt: null };
      continue;
    }
    if (prev.notifiedTotal !== info.total) {
      // A new batch landed since we last looked (or this is the first look while it's our turn)
      const fresh = typeof prev.total === 'number';
      sent += await sendToUser(userId, {
        title: fresh ? `${partner} dropped a Seven` : `Your turn in ${info.name}`,
        body: fresh ? `It's your turn in ${info.name}.` : `${partner} has dropped and it's your move.`,
        url,
        tag: `seven-${seven.playlistId}`
      });
      state[seven.playlistId] = { total: info.total, notifiedTotal: info.total, lastReminderAt: now };
    } else if (!prev.lastReminderAt || now - prev.lastReminderAt >= REMINDER_MS) {
      sent += await sendToUser(userId, {
        title: `Still your turn in ${info.name}`,
        body: `${partner} is waiting on your seven.`,
        url,
        tag: `seven-${seven.playlistId}`
      });
      state[seven.playlistId] = { ...prev, total: info.total, lastReminderAt: now };
    } else {
      state[seven.playlistId] = { ...prev, total: info.total };
    }
  }
  await r.set(PUSH_KEYS.state(userId), JSON.stringify(state));
  return { userId, checked: sevens.length, sent };
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET?.trim();
  const header = req.headers.authorization || '';
  if (!secret || header !== `Bearer ${secret}`) { res.status(401).json({ error: 'Unauthorized' }); return; }

  try {
    const r = redis();
    const users = (await r.smembers(PUSH_KEYS.users)) || [];
    const now = Date.now();
    const results = [];
    for (const userId of users.slice(0, MAX_USERS_PER_RUN)) {
      results.push(await checkUser(String(userId), now));
    }
    res.status(200).json({ ok: true, users: users.length, results });
  } catch (err) {
    if (err instanceof RedisConfigError || err instanceof PushConfigError) { res.status(503).json({ error: err.message }); return; }
    console.error('[push] cron failed', err);
    res.status(500).json({ error: 'Cron failed' });
  }
}
