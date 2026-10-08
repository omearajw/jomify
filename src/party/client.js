import { apiBaseUrl } from '../services/sync/client';
import { useUserStore } from '../store/userStore';

// Talking to the party API. Host calls carry the Spotify token; guest calls carry a guest id in
// the body and nothing else, which is the whole point.

export class PartyApiError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}

async function send(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new PartyApiError(0, 'No connection');
  }
  let data;
  try { data = await response.json(); } catch { data = null; }
  if (!response.ok) throw new PartyApiError(response.status, data?.error || `Request failed (${response.status})`, data || {});
  return data;
}

const hostToken = () => {
  const t = useUserStore.getState().token;
  if (!t) throw new PartyApiError(401, 'Not signed in');
  return t;
};

export const hostApi = {
  current: () => send('/api/party', { token: hostToken() }),
  create: (body) => send('/api/party', { method: 'POST', body, token: hostToken() }),
  op: (code, body) => send(`/api/party/${encodeURIComponent(code)}`, { method: 'POST', body, token: hostToken() })
};

export const guestApi = {
  state: (code, guestId) => send(`/api/party/${encodeURIComponent(code)}${guestId ? `?guest=${encodeURIComponent(guestId)}` : ''}`),
  op: (code, body) => send(`/api/party/${encodeURIComponent(code)}`, { method: 'POST', body })
};

export const partyLink = (code) => {
  const origin = typeof location !== 'undefined' && location.hostname.endsWith('vercel.app') ? location.origin : 'https://jomify.vercel.app';
  return `${origin}/p/${code}`;
};

// The display for a screen on the wall: QR, now playing, what's next
export const partyScreenLink = (code) => `${partyLink(code)}/screen`;
