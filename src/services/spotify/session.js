import { useUserStore } from '../../store/userStore';
import { refreshAccessToken } from './auth';

// One place that renews the Spotify access token. The heartbeat in App.jsx calls it on a timer;
// anything that meets a 401 can call it directly rather than waiting up to a minute for the next
// tick. Concurrent callers share a single request, so a burst of 401s cannot stampede Spotify.

// Spotify's tokens last an hour; renew with five minutes to spare
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

let inFlight = null;

export function isTokenStale(now = Date.now()) {
  const { token, tokenExpiresAt } = useUserStore.getState();
  if (!token) return true;
  if (!tokenExpiresAt) return false;
  return now > tokenExpiresAt - EXPIRY_MARGIN_MS;
}

// Resolves with a usable access token, or null when there is nothing to refresh with. Rejects
// with the underlying error (which carries `.definitive` for a token Spotify has revoked).
export function ensureFreshToken({ force = false } = {}) {
  const { refreshToken, setToken, setRefreshToken } = useUserStore.getState();
  if (!refreshToken) return Promise.resolve(null);
  if (!force && !isTokenStale()) return Promise.resolve(useUserStore.getState().token);
  if (inFlight) return inFlight;

  inFlight = refreshAccessToken(refreshToken)
    .then((data) => {
      setToken(data.access_token, data.expires_in);
      // PKCE rotates refresh tokens; losing the new one signs the device out an hour later
      if (data.refresh_token) setRefreshToken(data.refresh_token);
      return data.access_token;
    })
    .finally(() => { inFlight = null; });

  return inFlight;
}
