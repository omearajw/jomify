import { apiBaseUrl } from './sync/client';
import { useUserStore } from '../store/userStore';
import { setWordLyricsSource } from '../lib/lrc';

// Word-timed lyrics (Spicy Lyrics, through Jomify's /api/lyrics, which holds the key). Lines keep
// lrclib's shape, { timeMs, text }, plus `words`, so everything that shows line lyrics still works.
async function fetchWordLyrics(track, { signal } = {}) {
  const token = useUserStore.getState().token;
  if (!token) return null;
  const res = await fetch(`${apiBaseUrl()}/api/lyrics?id=${encodeURIComponent(track.id)}`, { headers: { Authorization: `Bearer ${token}` }, signal });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  if (!Array.isArray(body?.lines) || body.lines.length === 0) return null;
  return { synced: body.lines, plain: [], timing: body.type, source: body.source };
}

setWordLyricsSource(fetchWordLyrics);
