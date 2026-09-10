import { Redis } from '@upstash/redis';

// UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are set by the Upstash integration in the
// Vercel dashboard. They must NOT be VITE_-prefixed: anything with that prefix is compiled into
// the public browser bundle, which would hand every visitor write access to the database.

let client = null;

export function redis() {
  if (client) return client;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new Error('Upstash is not configured (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN)');
  }

  client = new Redis({ url, token });
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
