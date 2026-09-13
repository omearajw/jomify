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
