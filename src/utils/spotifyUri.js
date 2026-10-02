import { cleanString } from './strings.js';

// Spotify identifies things by URI ("spotify:artist:4Z8W4fKeB5YxbusRsdQVPb") in the Web Playback
// SDK, but by bare id in the Web API and in every navigation helper in this app. The SDK's
// current_track carries `uri` on artists and album with NO `id`, so anything reading the
// player state needs this to navigate anywhere.

// What people paste to add a friend: a profile link, a URI, or a bare id. Returns the user id
// or null. Spotify user ids are what the URL carries; they can be numbers, usernames or
// opaque strings, so the only rule is "one path/URI segment, no separators".
export function userIdFromInput(text) {
  if (typeof text !== 'string') return null;
  const raw = text.trim();
  if (!raw) return null;

  const uri = raw.match(/^spotify:user:([^:?#\s]+)/i);
  if (uri) return safeDecode(uri[1]);

  const url = raw.match(/^(?:https?:\/\/)?(?:open|play)\.spotify\.com\/(?:intl-[a-z]{2}\/)?user\/([^/?#\s]+)/i);
  if (url) return safeDecode(url[1]);

  if (/^[A-Za-z0-9._~%-]+$/.test(raw)) return safeDecode(raw);
  return null;
}

function safeDecode(segment) {
  try { return decodeURIComponent(segment) || null; } catch { return segment; }
}

export function idFromUri(uri, expectedType) {
  if (typeof uri !== 'string') return null;

  const parts = uri.split(':');
  if (parts.length < 3 || parts[0] !== 'spotify') return null;

  // Local files ("spotify:local:...") and other non-catalogue items have no page to go to
  if (expectedType && parts[1] !== expectedType) return null;

  return parts[2] || null;
}

// The one answer, everywhere in the app, to "is this the song that is playing".
//
// The same recording can reach the app under more than one id. Spotify relinks a track to
// another release in the listener's market and migrates catalogue to new ids, so a playlist can
// hold one id while the player reports another. Since March 2026 the Web API no longer says
// which id a relinked track stood in for: linked_from was removed for development-mode apps.
// Comparing ids alone made every re-released back catalogue look like a different song from the
// one playing, which is what left the sorting card stuck on one artist's songs.
//
// So ids are only the first test. Failing that, the same title, lead artist and length within a
// few seconds. Length is what keeps "Song" and "Song - Live" apart, which matching on title and
// artist alone used to confuse.
const LENGTH_TOLERANCE_MS = 3000;

// Marks a drag as carrying a song, so a drop target can tell one from a playlist being reordered
// while the drag is still in the air, when only the drag's types can be read and not its data
export const TRACK_DRAG_TYPE = 'application/x-jomify-track';

export function trackIdentities(track) {
  if (!track) return [];
  return [track.uri, track.id, track.linked_from?.uri, track.linked_from?.id].filter(Boolean);
}

const leadArtist = (track) => String(track?.artists?.[0]?.name || '').trim().toLowerCase();

export function isSameTrack(a, b) {
  if (!a || !b) return false;
  const left = trackIdentities(a);
  if (trackIdentities(b).some((id) => left.includes(id))) return true;

  // An unknown length is recorded as 0, and would match anything
  if (!a.duration_ms || !b.duration_ms || Math.abs(a.duration_ms - b.duration_ms) > LENGTH_TOLERANCE_MS) return false;
  const title = cleanString(a.name);
  const artist = leadArtist(a);
  return title !== '' && artist !== '' && title === cleanString(b.name) && artist === leadArtist(b);
}
