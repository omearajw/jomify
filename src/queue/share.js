// The queue shared by a listener's devices, on the server (api/queue.js). `pull` asks whether it
// changed since a revision (one small read when it hasn't); `push` sends a change. Both answer
// null when the server can't be reached, and the device carries on with its own copy.

import { useUserStore } from '../store/userStore';
import { apiBaseUrl } from '../services/sync/client';
import { timeoutSignal } from '../services/spotify/http';

async function call(method, path, body) {
  const token = useUserStore.getState().token;
  if (!token) return null;
  try {
    const response = await fetch(`${apiBaseUrl()}/api/queue${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: timeoutSignal(10000)
    });
    if (response.status === 409) return { conflict: true, ...(await response.json().catch(() => ({}))) };
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

// -> { rev } when unchanged since `since`, else { rev, q, given }; null when unreachable
export const pull = (since) => call('GET', since === undefined || since === null ? '' : `?since=${since}`);

// -> { rev, q, given } | { conflict: true, rev, q, given } | null
export const push = (body) => call('POST', '', body);
