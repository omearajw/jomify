import { Redis } from '@upstash/redis';

// Upstash credentials arrive under different names depending on how the database was connected:
// Upstash's own Vercel integration sets UPSTASH_REDIS_REST_*, while a store migrated from the
// retired Vercel KV product uses KV_REST_API_*. Accepting both removes a whole class of
// "connected the database but it still 503s" confusion.
//
// These must NOT be VITE_-prefixed: anything with that prefix is compiled into the public
// browser bundle, which would hand every visitor write access to the database.

const URL_VARS = ['UPSTASH_REDIS_REST_URL', 'KV_REST_API_URL'];
const TOKEN_VARS = ['UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_TOKEN'];

export class RedisConfigError extends Error {
  constructor(message, detail) {
    super(message);
    this.detail = detail;
  }
}

function firstPresent(names) {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) return { name, value: value.trim() };
  }
  return null;
}

// Reports which expected variable names exist, never their values. Safe to return to the client:
// it turns an opaque 503 into an immediately actionable answer.
export function configReport() {
  const seen = {};
  [...URL_VARS, ...TOKEN_VARS].forEach((name) => { seen[name] = Boolean(process.env[name]); });
  return seen;
}

let client = null;

export function redis() {
  if (client) return client;

  const url = firstPresent(URL_VARS);
  const token = firstPresent(TOKEN_VARS);

  if (!url || !token) {
    throw new RedisConfigError(
      'Upstash is not configured. Expected UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN ' +
      '(or the KV_REST_API_* equivalents) in the Vercel project environment.',
      configReport()
    );
  }

  // @upstash/redis speaks the REST API, not the Redis wire protocol. A rediss:// connection
  // string is a different thing entirely and fails in a confusing way, so reject it clearly.
  if (!url.value.startsWith('https://')) {
    throw new RedisConfigError(
      `${url.name} is not a REST URL (it should start with https://). A rediss:// connection ` +
      'string will not work with the REST client.',
      configReport()
    );
  }

  client = new Redis({ url: url.value, token: token.value });
  return client;
}

export const KEYS = {
  doc: (userId) => `jomify:doc:v1:${userId}`,
  rev: (userId) => `jomify:rev:v1:${userId}`,
  backup: (userId) => `jomify:bak:v1:${userId}`,
  auth: (tokenHash) => `jomify:auth:${tokenHash}`
};

// How many previous versions of a document to keep. Cheap insurance: a few KB per user, and the
// only server-side way back if a bad merge deploy ever corrupts a document.
export const BACKUP_DEPTH = 20;
