import { toast } from '../store/toastStore';

// Spotify links, since Jomify's own pages have no addresses yet. Shares through the phone's
// share sheet where there is one; otherwise copies the link.
export const spotifyLink = (type, id) => `https://open.spotify.com/${type}/${encodeURIComponent(id)}`;

export async function shareSpotifyLink(type, id, name) {
  const url = spotifyLink(type, id);
  const title = name || 'Spotify';
  if (typeof navigator !== 'undefined' && navigator.share && /Android|iPhone|iPad/i.test(navigator.userAgent)) {
    try { await navigator.share({ title, url }); return 'shared'; }
    catch (err) { if (err?.name === 'AbortError') return 'cancelled'; }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast(`Link to ${title} copied`, { tone: 'success' });
    return 'copied';
  } catch {
    toast(url, { duration: 8000 });
    return 'shown';
  }
}
