// The demo's player: everything Spotify's player does except make sound. It keeps a play order,
// a position that moves with the clock, a queue, shuffle and repeat, and moves on when a song
// ends. Both the stand-in for Spotify's in-browser player and the stand-in for its Web API read
// and drive this one state, so every screen agrees.

import { trackByUri, playlistById, albumById, tracksOfArtist, LIKED, TRACKS, PLAYLISTS } from './library.js';

export const DEMO_DEVICE = { id: 'jomifydemodevice', name: 'Jomify (demo)', type: 'Computer', is_active: true, is_private_session: false, is_restricted: false, supports_volume: true, volume_percent: 70 };

const listeners = new Set();
const state = {
  list: [], // the context's tracks
  order: [], // indexes into list, shuffled or not
  at: 0, // position in order
  queue: [], // tracks added to the queue, played before the context carries on
  current: null,
  contextUri: null,
  playing: false,
  startedAt: 0, // when position 0 of the current song was, while playing
  heldAt: 0, // the position, while paused
  shuffle: false,
  repeat: 'off',
  volume: 70,
  plays: 0,
  history: []
};

const now = () => Date.now();
export const position = () => {
  if (!state.current) return 0;
  const p = state.playing ? now() - state.startedAt : state.heldAt;
  return Math.max(0, Math.min(state.current.duration_ms, p));
};

function contextTracks(uri) {
  const [, kind, id] = String(uri || '').split(':');
  if (kind === 'playlist') return playlistById(id)?.entries.map((e) => e.track) || [];
  if (kind === 'album') return albumById(id)?.trackList || [];
  if (kind === 'artist') return tracksOfArtist(id);
  if (String(uri).endsWith(':collection')) return [...LIKED.keys()].map((tid) => TRACKS.get(tid)).filter(Boolean);
  return [];
}

function shuffled(n, first) {
  const rest = Array.from({ length: n }, (_, i) => i).filter((i) => i !== first);
  for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
  return first === undefined ? rest : [first, ...rest];
}

function emit() { for (const fn of listeners) fn(); }

function start(track, at = 0) {
  if (state.current) state.history = [state.current, ...state.history].slice(0, 20);
  state.current = track;
  state.plays += 1;
  state.heldAt = at;
  state.startedAt = now() - at;
  emit();
}

export function play({ contextUri, uris, offset, positionMs = 0 } = {}) {
  let list = [];
  let index = 0;
  if (Array.isArray(uris) && uris.length) {
    list = uris.map(trackByUri).filter(Boolean);
    state.contextUri = null;
  } else if (contextUri) {
    list = contextTracks(contextUri);
    state.contextUri = contextUri;
  }
  if (!list.length) return false;
  if (offset && Number.isInteger(offset.position)) index = Math.max(0, Math.min(list.length - 1, offset.position));
  if (offset?.uri) index = Math.max(0, list.findIndex((t) => t.uri === offset.uri));
  state.list = list;
  state.order = state.shuffle ? shuffled(list.length, index) : list.map((_, i) => i);
  state.at = state.shuffle ? 0 : index;
  state.playing = true;
  start(list[index], positionMs);
  return true;
}

export function resume() {
  if (!state.current) {
    return play({ contextUri: `spotify:playlist:${PLAYLISTS[0].id}` });
  }
  if (state.playing) return true;
  state.playing = true;
  state.startedAt = now() - state.heldAt;
  emit();
  return true;
}

export function pause() {
  if (!state.playing) return;
  state.heldAt = position();
  state.playing = false;
  emit();
}

export const toggle = () => (state.playing ? pause() : resume());

export function next(auto = false) {
  if (state.repeat === 'track' && auto) { start(state.current, 0); return; }
  if (state.queue.length) { start(state.queue.shift(), 0); return; }
  if (!state.list.length) return;
  if (state.at + 1 < state.order.length) state.at += 1;
  else if (state.repeat === 'context' || !auto) state.at = 0;
  else { state.at = 0; state.playing = false; start(state.list[state.order[0]], 0); return; }
  start(state.list[state.order[state.at]], 0);
}

export function previous() {
  if (position() > 3000 || !state.list.length) { seek(0); return; }
  state.at = Math.max(0, state.at - 1);
  start(state.list[state.order[state.at]], 0);
}

export function seek(ms) {
  if (!state.current) return;
  const p = Math.max(0, Math.min(state.current.duration_ms - 500, Number(ms) || 0));
  state.heldAt = p;
  state.startedAt = now() - p;
  emit();
}

export function setShuffle(on) {
  state.shuffle = Boolean(on);
  if (state.list.length) {
    const playingIndex = state.order[state.at] ?? 0;
    state.order = state.shuffle ? shuffled(state.list.length, playingIndex) : state.list.map((_, i) => i);
    state.at = state.shuffle ? 0 : playingIndex;
  }
  emit();
}

export function setRepeat(mode) { state.repeat = ['off', 'context', 'track'].includes(mode) ? mode : 'off'; emit(); }
export function setVolume(v) { state.volume = Math.max(0, Math.min(100, Math.round(v))); emit(); }
export function addToQueue(uri) { const t = trackByUri(uri); if (t) { state.queue.push(t); emit(); } }

export function upNext(n = 20) {
  const fromContext = state.order.slice(state.at + 1).map((i) => state.list[i]);
  return [...state.queue, ...fromContext].slice(0, n);
}

export const snapshot = () => ({ ...state, position: position() });
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

// Songs end on their own. Started by the demo only: this module is in every build.
let clock = null;
export function startClock() {
  if (clock) return;
  clock = setInterval(() => {
    if (state.playing && state.current && position() >= state.current.duration_ms) next(true);
  }, 400);
}

// Something to look at from the start: the first playlist, ready, not playing
const first = contextTracks(`spotify:playlist:${PLAYLISTS[0].id}`);
if (first.length) {
  state.list = first;
  state.order = first.map((_, i) => i);
  state.contextUri = `spotify:playlist:${PLAYLISTS[0].id}`;
  state.current = first[0];
}

// Spotify's two shapes of the same state
const sdkTrack = (t, uid) => t && ({
  id: t.id, uri: t.uri, name: t.name, type: 'track', media_type: 'audio', duration_ms: t.duration_ms, is_playable: true, uid,
  linked_from: { uri: null, id: null },
  artists: t.artists.map((a) => ({ name: a.name, uri: a.uri })),
  album: { name: t.album.name, uri: t.album.uri, images: t.album.images }
});

export function sdkState() {
  if (!state.current) return null;
  const nextUp = upNext(2);
  return {
    paused: !state.playing,
    position: position(),
    duration: state.current.duration_ms,
    shuffle: state.shuffle,
    repeat_mode: state.repeat === 'context' ? 1 : state.repeat === 'track' ? 2 : 0,
    context: { uri: state.contextUri, metadata: {} },
    timestamp: now(),
    loading: false,
    disallows: {},
    track_window: {
      current_track: sdkTrack(state.current, `demo-${state.plays}`),
      previous_tracks: state.history.slice(0, 2).map((t, i) => sdkTrack(t, `demo-prev-${i}`)),
      next_tracks: nextUp.map((t, i) => sdkTrack(t, `demo-next-${i}`))
    }
  };
}

export function webState() {
  if (!state.current) return null;
  const [, kind] = String(state.contextUri || '').split(':');
  return {
    device: { ...DEMO_DEVICE, volume_percent: state.volume },
    is_playing: state.playing,
    progress_ms: position(),
    timestamp: now(),
    item: state.current,
    shuffle_state: state.shuffle,
    repeat_state: state.repeat,
    context: state.contextUri ? { uri: state.contextUri, type: kind || 'playlist', href: '', external_urls: {} } : null,
    currently_playing_type: 'track',
    actions: { disallows: {} }
  };
}
