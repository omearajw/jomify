import { useUserStore } from '../../store/userStore';

const clientId = import.meta.env.VITE_SPOTIFY_CLIENT_ID;
const redirectUri = import.meta.env.VITE_REDIRECT_URI;

// The permissions Jomify needs to work (Includes the new Playlist Modify scopes)
const scope = [
  'streaming',
  'user-top-read',
  'user-read-recently-played',
  'user-read-email',
  'user-read-private',
  'user-follow-read',
  'user-follow-modify',
  'user-library-read',
  'user-library-modify',
  'user-read-playback-state',
  'user-modify-playback-state',
  'playlist-read-private',        
  'playlist-read-collaborative',
  'playlist-modify-public',   
  'playlist-modify-private',
  'ugc-image-upload'
].join(' ');

// `state` comes back on the redirect, which is how a second authorization (the server's own
// grant for push notifications) is told apart from a sign-in
export async function redirectToAuthCodeFlow({ state = '' } = {}) {
  const verifier = generateCodeVerifier(128);
  const challenge = await generateCodeChallenge(verifier);

  localStorage.setItem("verifier", verifier);

  const params = new URLSearchParams();
  params.append("client_id", clientId);
  params.append("response_type", "code");
  params.append("redirect_uri", redirectUri);
  params.append("scope", scope);
  params.append("code_challenge_method", "S256");
  params.append("code_challenge", challenge);
  if (state) params.append("state", state);

  document.location = `https://accounts.spotify.com/authorize?${params.toString()}`;
}

// Swaps an authorization code for tokens. Touches nothing but the single-use verifier, so a
// caller can decide what the tokens are for (the session, or the server's push grant).
export async function exchangeCode(code) {
  const verifier = localStorage.getItem("verifier");

  const params = new URLSearchParams();
  params.append("client_id", clientId);
  params.append("grant_type", "authorization_code");
  params.append("code", code);
  params.append("redirect_uri", redirectUri);
  params.append("code_verifier", verifier);

  const result = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params
  });

  if (!result.ok) throw new Error("Failed to fetch access token");

  // The verifier is single-use. It used to linger in localStorage forever, surviving even a
  // hard logout.
  localStorage.removeItem("verifier");

  return await result.json();
}

export async function getAccessToken(code) {
  const data = await exchangeCode(code);

  // Save the refresh token safely to the global store right here in the background
  const store = useUserStore.getState();
  if (data.refresh_token) {
    store.setRefreshToken(data.refresh_token);
  }

  // expires_in is Spotify's word on how long the token lasts; the caller feeds it to setToken
  // instead of assuming an hour.
  return { access_token: data.access_token, expires_in: data.expires_in };
}

export async function refreshAccessToken(refreshToken) {
  const params = new URLSearchParams();
  params.append("client_id", clientId);
  params.append("grant_type", "refresh_token");
  params.append("refresh_token", refreshToken);

  const result = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params
  });

  if (!result.ok) {
    // 400/401 mean Spotify rejected the grant (revoked, or a refresh token already rotated
    // away); anything else is Spotify or the network having a moment
    const err = new Error(`Failed to refresh token (${result.status})`);
    err.status = result.status;
    err.definitive = result.status === 400 || result.status === 401;
    throw err;
  }
  return await result.json();
}

function generateCodeVerifier(length) {
  let text = '';
  let possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  for (let i = 0; i < length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

async function generateCodeChallenge(codeVerifier) {
  const data = new TextEncoder().encode(codeVerifier);
  const digest = await window.crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode.apply(null, [...new Uint8Array(digest)]))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}