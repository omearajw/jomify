import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import webpush from 'web-push';
import { redis } from './redis.js';

// Push notifications for Sevens. Everything stored here is per Spotify user id:
//   jomify:push:subs:v1:<userId>   hash  endpoint -> subscription JSON
//   jomify:push:grant:v1:<userId>  string  encrypted refresh token of the server's OWN Spotify
//                                          grant (a separate authorization, never the one the
//                                          browser uses, so refreshing it can't sign the user out)
//   jomify:push:state:v1:<userId>  string  JSON { [playlistId]: { total, notifiedTotal, lastReminderAt } }
//   jomify:push:users              set     user ids with at least one subscription
export const PUSH_KEYS = {
  subs: (userId) => `jomify:push:subs:v1:${userId}`,
  grant: (userId) => `jomify:push:grant:v1:${userId}`,
  state: (userId) => `jomify:push:state:v1:${userId}`,
  users: 'jomify:push:users'
};

export class PushConfigError extends Error {}

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) throw new PushConfigError(`${name} is not set in the Vercel project environment.`);
  return value.trim();
}

export function vapidPublicKey() {
  return requireEnv('VAPID_PUBLIC_KEY');
}

let vapidConfigured = false;
export function configureWebPush() {
  if (vapidConfigured) return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT?.trim() || 'mailto:hello@jomify.app',
    requireEnv('VAPID_PUBLIC_KEY'),
    requireEnv('VAPID_PRIVATE_KEY')
  );
  vapidConfigured = true;
}

// AES-256-GCM with a key derived from PUSH_TOKEN_SECRET. The refresh token is the one thing here
// that could act on someone's account, so it never sits in Redis in the clear.
function encryptionKey() {
  return createHash('sha256').update(requireEnv('PUSH_TOKEN_SECRET')).digest();
}

export function encrypt(plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const body = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

export function decrypt(blob) {
  const raw = Buffer.from(String(blob), 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const body = raw.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}

export async function listSubscriptions(userId) {
  const raw = await redis().hgetall(PUSH_KEYS.subs(userId));
  if (!raw) return [];
  return Object.values(raw).map((v) => (typeof v === 'string' ? JSON.parse(v) : v)).filter((s) => s?.endpoint);
}

export async function removeSubscription(userId, endpoint) {
  await redis().hdel(PUSH_KEYS.subs(userId), endpoint);
  const remaining = await redis().hlen(PUSH_KEYS.subs(userId));
  if (!remaining) await redis().srem(PUSH_KEYS.users, userId);
}

// Sends one payload to every device of a user; endpoints the push service has forgotten are
// dropped so they stop costing a request every run
export async function sendToUser(userId, payload) {
  configureWebPush();
  const subs = await listSubscriptions(userId);
  const body = JSON.stringify(payload);
  let delivered = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(sub, body, { TTL: 60 * 60 * 24 });
      delivered += 1;
    } catch (err) {
      if (err?.statusCode === 404 || err?.statusCode === 410) await removeSubscription(userId, sub.endpoint);
      else console.warn('[push] send failed', err?.statusCode, err?.body || err?.message);
    }
  }
  return delivered;
}
