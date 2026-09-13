// Turns a Web API `GET /me/player` response into the shape the Web Playback SDK emits from
// player_state_changed. Ten consumers read `track_window.current_track`, `paused`, `position`,
// `duration` and `current_track.uid`, so when playback lives on another device we feed them the
// same shape rather than teaching each one a second format.
//
// Pure and import-free so scripts/playback-cases.mjs can run it under plain node.

export const REPEAT_MODES = { off: 0, context: 1, track: 2 };
export const REPEAT_NAMES = ['off', 'context', 'track'];

// The SDK gives every play its own `uid`, and the queue panel and manual-queue bookkeeping key
// off it. Remote state has no such thing, so one is minted per play: the same track keeps its
// uid while progress moves forward; a jump backwards of more than a moment means it restarted.
const RESTART_TOLERANCE_MS = 3000;
let mintCounter = 0; // two plays minted in the same millisecond must still differ

export function nextUid(prev, item, progressMs) {
  const prevTrack = prev?.track_window?.current_track;
  if (prevTrack?.uid && item?.id && prevTrack.id === item.id) {
    const prevPosition = prev.position ?? 0;
    if ((progressMs ?? 0) + RESTART_TOLERANCE_MS >= prevPosition) return prevTrack.uid;
  }
  mintCounter += 1;
  return `remote:${item?.id || 'unknown'}:${Date.now()}:${mintCounter}`;
}

function toSdkTrack(item, uid) {
  if (!item) return null;
  const isEpisode = item.type === 'episode';
  const images = item.album?.images || item.images || item.show?.images || [];
  return {
    id: item.id,
    uri: item.uri,
    name: item.name,
    type: item.type || 'track',
    duration_ms: item.duration_ms ?? 0,
    is_playable: item.is_playable !== false,
    linked_from: item.linked_from || null,
    uid,
    artists: isEpisode
      ? [{ name: item.show?.name || 'Podcast', uri: item.show?.uri || null }]
      : (item.artists || []).map(a => ({ name: a.name, uri: a.uri, id: a.id })),
    album: {
      name: isEpisode ? (item.show?.name || '') : (item.album?.name || ''),
      uri: isEpisode ? (item.show?.uri || null) : (item.album?.uri || null),
      images
    }
  };
}

export function toSdkShape(webState, prev = null) {
  if (!webState) return null;
  const item = webState.item || null;
  const position = webState.progress_ms ?? 0;
  const uid = item ? nextUid(prev, item, position) : null;
  // Same play as last poll: hand back the same track object, so components that select the
  // current track don't re-render every few seconds for nothing
  const prevTrack = prev?.track_window?.current_track;
  const currentTrack = uid && prevTrack?.uid === uid ? prevTrack : toSdkTrack(item, uid);
  return {
    paused: !webState.is_playing,
    position,
    duration: item?.duration_ms ?? 0,
    shuffle: Boolean(webState.shuffle_state),
    repeat_mode: REPEAT_MODES[webState.repeat_state] ?? 0,
    context: webState.context ? { uri: webState.context.uri, metadata: {} } : null,
    timestamp: webState.timestamp ?? Date.now(),
    track_window: { current_track: currentTrack, previous_tracks: [], next_tracks: [] },
    remote: true
  };
}

// Which device should a play request target. Whatever Spotify says is active wins; failing that
// this browser's own player if it came up; otherwise nobody, and the caller asks the user.
export function resolveDeviceId({ activeDevice, sdkStatus, deviceId }) {
  if (activeDevice?.id) return activeDevice.id;
  if (sdkStatus === 'ready' && deviceId) return deviceId;
  return null;
}
