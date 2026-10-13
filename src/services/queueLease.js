// The lease on carrying out the queue, from the server (api/lease.js): with the music on a device
// that is no Jomify, only the device holding it hands songs over. Answers true, false, or null
// when the server could not say.
import { useUserStore } from '../store/userStore';
import { apiBaseUrl } from './sync/client';
import { timeoutSignal } from './spotify/http';

export async function askLease(id, { release = false } = {}) {
  const token = useUserStore.getState().token;
  if (!token) return null;
  try {
    const response = await fetch(`${apiBaseUrl()}/api/lease`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ job: 'queue', id, release }),
      signal: timeoutSignal(8000),
      keepalive: release
    });
    if (!response.ok) return null;
    const body = await response.json();
    return Boolean(body?.held);
  } catch {
    return null;
  }
}
