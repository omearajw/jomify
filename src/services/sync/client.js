import { useUserStore } from '../../store/userStore';
import { SCHEMA_VERSION } from '../../sync/mergeSyncDoc';

// HTTP layer for the sync API. Mirrors the interceptor style of spotifyFetch in
// services/spotify/api.js: one place that knows about transport, so the engine above it only
// deals in documents.

export class SyncApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    // A 401 is worth one retry after the token heartbeat refreshes; 400/413 are permanent and
    // should stop sync rather than spin.
    this.isRetryable = status !== 400 && status !== 413;
  }
}

export function apiBaseUrl() {
  const configured = import.meta.env.VITE_SYNC_API_BASE;
  if (configured !== undefined && configured !== '') return configured.replace(/\/$/, '');
  if (configured === '') return '';

  // The Electron build and the LAN dev server are served from origins that have no API of their
  // own, so they call the deployed one. The deployed site calls itself.
  if (typeof location !== 'undefined' && location.hostname.endsWith('vercel.app')) return '';
  return 'https://jomify.vercel.app';
}

function authHeader() {
  // Read lazily rather than closing over the token: the heartbeat in App.jsx rotates it roughly
  // hourly, and the engine must not have to restart to notice.
  const token = useUserStore.getState().token;
  if (!token) throw new SyncApiError(401, 'Not signed in');
  return { Authorization: `Bearer ${token}` };
}

async function readError(response) {
  try {
    const body = await response.json();
    return body?.error || `Sync failed (${response.status})`;
  } catch {
    return `Sync failed (${response.status})`;
  }
}

export async function pullDoc() {
  let response;
  try {
    response = await fetch(`${apiBaseUrl()}/api/sync`, { headers: authHeader() });
  } catch (err) {
    // Network-level failure: offline, DNS, or a CORS rejection. Never "empty".
    throw new SyncApiError(0, err?.message || 'Network unavailable');
  }

  if (!response.ok) throw new SyncApiError(response.status, await readError(response));
  return await response.json();
}

export async function pushDoc(doc, deviceId, { keepalive = false } = {}) {
  let response;
  try {
    response = await fetch(`${apiBaseUrl()}/api/sync`, {
      method: 'POST',
      headers: { ...authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ schemaVersion: SCHEMA_VERSION, doc, deviceId }),
      keepalive
    });
  } catch (err) {
    throw new SyncApiError(0, err?.message || 'Network unavailable');
  }

  if (!response.ok) throw new SyncApiError(response.status, await readError(response));
  return await response.json();
}
