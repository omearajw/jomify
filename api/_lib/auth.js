import { createHash } from 'node:crypto';
import { redis, KEYS } from './redis.js';

// Jomify is a public PKCE client with no client secret, so there is no server session to check.
// The only credential the browser holds is its Spotify access token -- so we verify that token
// against Spotify itself and use the account it resolves to as the storage key.
//
// Spotify access tokens rotate roughly hourly. Verifying on every request would add a Spotify
// API call to every sync and risk 429s, so the resolved user id is cached against a hash of the
// token for 15 minutes. The raw token is never stored anywhere: access tokens are opaque and
// unique per grant, so a hash can never resolve to the wrong account.

const CACHE_TTL_SECONDS = 900;

export class AuthError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export async function resolveUserId(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

  if (!token) throw new AuthError(401, 'Missing bearer token');

  const cacheKey = KEYS.auth(hashToken(token));

  const cached = await redis().get(cacheKey);
  if (cached) return String(cached);

  let response;
  try {
    response = await fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${token}` }
    });
  } catch {
    // Spotify unreachable. 503 rather than 401 matters: the client treats 401 as "log in again"
    // but 503 as "unknown, stay dirty and retry" -- and it must never read either as "empty".
    throw new AuthError(503, 'Could not reach Spotify to verify the token');
  }

  if (response.status === 401) throw new AuthError(401, 'Spotify rejected the token');
  if (response.status === 429) throw new AuthError(503, 'Spotify rate limited the verification');
  if (!response.ok) throw new AuthError(503, `Spotify verification failed (${response.status})`);

  const profile = await response.json();
  if (!profile?.id) throw new AuthError(503, 'Spotify returned no user id');

  await redis().set(cacheKey, profile.id, { ex: CACHE_TTL_SECONDS });
  return profile.id;
}
