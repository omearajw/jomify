// Spotify identifies things by URI ("spotify:artist:4Z8W4fKeB5YxbusRsdQVPb") in the Web Playback
// SDK, but by bare id in the Web API and in every navigation helper in this app. The SDK's
// current_track carries `uri` on artists and album with NO `id`, so anything reading the
// player state needs this to navigate anywhere.

export function idFromUri(uri, expectedType) {
  if (typeof uri !== 'string') return null;

  const parts = uri.split(':');
  if (parts.length < 3 || parts[0] !== 'spotify') return null;

  // Local files ("spotify:local:...") and other non-catalogue items have no page to go to
  if (expectedType && parts[1] !== expectedType) return null;

  return parts[2] || null;
}
