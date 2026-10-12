// The demo's Spotify: answers every Web API request the app makes from the demo library and the
// silent player, and stands in for Spotify's in-browser player. Requests to anything else go out
// as normal (lyrics, tempo, cover art), so those parts of the demo are real.

import * as engine from './engine.js';
import {
  DEMO_USER, DEMO_FRIEND, ALBUMS, TRACKS, PLAYLISTS, MY_PLAYLISTS, LIKED, SAVED_ALBUMS, FOLLOWED, ARTISTS,
  artistById, albumById, trackByUri, playlistById, tracksOfArtist, albumsOfArtist, createPlaylist,
  simplePlaylist, fullAlbum, albumSummary
} from './library.js';

const DEMO_TOKEN = 'jomify-demo-token';
export { DEMO_TOKEN };

const json = (status, body) => (status === 204 || body === undefined
  ? new Response(null, { status: status === 200 ? 204 : status })
  : new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
const notFound = () => json(404, { error: { status: 404, message: 'Not found in the demo library' } });

const page = (items, url, total = items.length) => {
  const offset = Number(url.searchParams.get('offset') || 0);
  const limit = Number(url.searchParams.get('limit') || 50);
  const slice = items.slice(offset, offset + limit);
  const nextUrl = offset + limit < total ? (() => { const u = new URL(url); u.searchParams.set('offset', String(offset + limit)); return u.toString(); })() : null;
  return { href: url.toString(), items: slice, limit, offset, total, next: nextUrl, previous: null };
};

// Playlist entries carry both names Spotify has used (track/item)
const entryShape = (e) => ({ ...e, item: e.track });
const playlistDetail = (p, url) => {
  const tracks = page(p.entries.map(entryShape), url, p.entries.length);
  return { ...simplePlaylist(p), followers: { total: 3 }, tracks, items: tracks };
};

const ids = (url, body, key = 'ids') => {
  const fromQuery = url.searchParams.get(key);
  if (fromQuery) return decodeURIComponent(fromQuery).split(',').filter(Boolean);
  return Array.isArray(body?.[key]) ? body[key] : [];
};

const kindOfUri = (uri) => String(uri).split(':')[1];

function readBody(init) {
  if (!init?.body || typeof init.body !== 'string') return {};
  try { return JSON.parse(init.body); } catch { return {}; }
}

function search(url) {
  const q = String(url.searchParams.get('q') || '').toLowerCase().trim();
  const types = String(url.searchParams.get('type') || 'track').split(',');
  const has = (s) => String(s || '').toLowerCase().includes(q);
  const out = {};
  if (types.includes('track')) out.tracks = page([...TRACKS.values()].filter((t) => has(t.name) || t.artists.some((a) => has(a.name)) || has(t.album.name)), url);
  if (types.includes('album')) out.albums = page(ALBUMS.filter((a) => has(a.name) || a.artists.some((x) => has(x.name))).map(albumSummary), url);
  if (types.includes('artist')) out.artists = page([...ARTISTS.values()].filter((a) => has(a.name)), url);
  if (types.includes('playlist')) out.playlists = page(PLAYLISTS.filter((p) => has(p.name)).map(simplePlaylist), url);
  return out;
}

function playlistWrite(p, method, url, body) {
  if (method === 'POST') {
    const uris = ids(url, body, 'uris');
    const tracks = uris.map(trackByUri).filter(Boolean);
    const at = Number.isInteger(body.position) ? body.position : p.entries.length;
    p.entries.splice(at, 0, ...tracks.map((t) => ({ added_at: new Date().toISOString(), added_by: { id: DEMO_USER.id, type: 'user' }, is_local: false, track: t })));
  } else if (method === 'DELETE') {
    const gone = new Set([...(body.tracks || []), ...(body.items || [])].map((x) => x.uri));
    p.entries = p.entries.filter((e) => !gone.has(e.track.uri));
  } else if (method === 'PUT') {
    const uris = ids(url, body, 'uris');
    if (uris.length || Array.isArray(body.uris)) {
      p.entries = uris.map(trackByUri).filter(Boolean).map((t) => ({ added_at: new Date().toISOString(), added_by: { id: DEMO_USER.id, type: 'user' }, is_local: false, track: t }));
    } else if (Number.isInteger(body.range_start) && Number.isInteger(body.insert_before)) {
      const len = body.range_length || 1;
      const moving = p.entries.splice(body.range_start, len);
      const to = body.insert_before > body.range_start ? body.insert_before - len : body.insert_before;
      p.entries.splice(to, 0, ...moving);
    }
  }
  p.snapshot_id = `${p.id}-${Date.now()}`;
  p.images = p.entries[0] ? [p.entries[0].track.album.images[0]] : [];
  return json(method === 'POST' ? 201 : 200, { snapshot_id: p.snapshot_id });
}

function libraryWrite(method, uris) {
  for (const uri of uris) {
    const id = String(uri).split(':').pop();
    const kind = kindOfUri(uri);
    const on = method === 'PUT';
    if (kind === 'track') { if (on) LIKED.set(id, new Date().toISOString()); else LIKED.delete(id); }
    if (kind === 'album') { if (on) SAVED_ALBUMS.add(id); else SAVED_ALBUMS.delete(id); }
    if (kind === 'artist') { if (on) FOLLOWED.add(id); else FOLLOWED.delete(id); }
    if (kind === 'playlist') { if (on) MY_PLAYLISTS.add(id); else MY_PLAYLISTS.delete(id); }
  }
  return json(200, {});
}
const inLibrary = (uri) => {
  const id = String(uri).split(':').pop();
  const kind = kindOfUri(uri);
  if (kind === 'track') return LIKED.has(id);
  if (kind === 'album') return SAVED_ALBUMS.has(id);
  if (kind === 'artist') return FOLLOWED.has(id);
  if (kind === 'playlist') return MY_PLAYLISTS.has(id);
  return false;
};

function player(method, url, path, body) {
  if (path === '/me/player/devices') return json(200, { devices: [{ ...engine.DEMO_DEVICE, volume_percent: engine.snapshot().volume }] });
  if (path === '/me/player/recently-played') {
    const recent = [...engine.snapshot().history, ...PLAYLISTS[1].entries.map((e) => e.track)].slice(0, 20);
    return json(200, { items: recent.map((t, i) => ({ track: t, played_at: new Date(Date.now() - (i + 1) * 3600e3).toISOString(), context: { type: 'album', uri: t.album.uri } })), next: null, cursors: null, limit: 20 });
  }
  if (path === '/me/player/queue' && method === 'POST') { engine.addToQueue(url.searchParams.get('uri')); return json(204); }
  if (path === '/me/player/queue') { const s = engine.snapshot(); return json(200, { currently_playing: s.current, queue: engine.upNext(20) }); }
  if (path === '/me/player/play') {
    if (body.context_uri || body.uris) engine.play({ contextUri: body.context_uri, uris: body.uris, offset: body.offset, positionMs: body.position_ms || 0 });
    else engine.resume();
    return json(204);
  }
  if (path === '/me/player/pause') { engine.pause(); return json(204); }
  if (path === '/me/player/next') { engine.next(); return json(204); }
  if (path === '/me/player/previous') { engine.previous(); return json(204); }
  if (path === '/me/player/seek') { engine.seek(url.searchParams.get('position_ms')); return json(204); }
  if (path === '/me/player/shuffle') { engine.setShuffle(url.searchParams.get('state') === 'true'); return json(204); }
  if (path === '/me/player/repeat') { engine.setRepeat(url.searchParams.get('state')); return json(204); }
  if (path === '/me/player/volume') { engine.setVolume(Number(url.searchParams.get('volume_percent'))); return json(204); }
  if (path === '/me/player' && method === 'PUT') { if (body.play) engine.resume(); return json(204); }
  if (path === '/me/player' || path === '/me/player/currently-playing') { const w = engine.webState(); return w ? json(200, w) : json(204); }
  return notFound();
}

export function answerSpotify(url, method, init) {
  const path = url.pathname.replace(/^\/v1/, '');
  const body = readBody(init);

  if (path.startsWith('/me/player')) return player(method, url, path, body);
  if (path === '/me') return json(200, DEMO_USER);

  if (path === '/me/playlists' && method === 'POST') return json(201, playlistDetail(createPlaylist(body.name, body.description), url));
  if (path === '/me/playlists') return json(200, page(PLAYLISTS.filter((p) => MY_PLAYLISTS.has(p.id)).map(simplePlaylist), url));

  if (path === '/me/tracks/contains') return json(200, ids(url, body).map((id) => LIKED.has(id)));
  if (path === '/me/tracks') {
    if (method === 'PUT') { ids(url, body).forEach((id) => LIKED.set(id, new Date().toISOString())); return json(200, {}); }
    if (method === 'DELETE') { ids(url, body).forEach((id) => LIKED.delete(id)); return json(200, {}); }
    const items = [...LIKED.entries()].sort((a, b) => (a[1] < b[1] ? 1 : -1)).map(([id, at]) => ({ added_at: at, track: TRACKS.get(id) })).filter((e) => e.track);
    return json(200, page(items.map((e) => ({ ...e, item: e.track })), url));
  }
  if (path === '/me/library/contains') return json(200, ids(url, body, 'uris').map(inLibrary));
  if (path === '/me/library') return libraryWrite(method, ids(url, body, 'uris'));

  if (path === '/me/albums/contains') return json(200, ids(url, body).map((id) => SAVED_ALBUMS.has(id)));
  if (path === '/me/albums') {
    if (method === 'PUT') { ids(url, body).forEach((id) => SAVED_ALBUMS.add(id)); return json(200, {}); }
    if (method === 'DELETE') { ids(url, body).forEach((id) => SAVED_ALBUMS.delete(id)); return json(200, {}); }
    return json(200, page(ALBUMS.filter((a) => SAVED_ALBUMS.has(a.id)).map((a) => ({ added_at: '2026-01-01T00:00:00Z', album: fullAlbum(a) })), url));
  }

  if (path === '/me/following/contains') {
    const type = url.searchParams.get('type');
    return json(200, ids(url, body).map((id) => (type === 'user' ? id === DEMO_FRIEND.id : FOLLOWED.has(id))));
  }
  if (path === '/me/following') {
    if (method === 'PUT' || method === 'DELETE') {
      if (url.searchParams.get('type') !== 'user') ids(url, body).forEach((id) => (method === 'PUT' ? FOLLOWED.add(id) : FOLLOWED.delete(id)));
      return json(204);
    }
    const items = [...ARTISTS.values()].filter((a) => FOLLOWED.has(a.id));
    return json(200, { artists: { items, total: items.length, next: null, cursors: { after: null }, limit: 50, href: url.toString() } });
  }

  if (path.startsWith('/me/top/')) {
    const kind = path.split('/').pop();
    const range = url.searchParams.get('time_range') || 'medium_term';
    const shift = range === 'short_term' ? 0 : range === 'medium_term' ? 5 : 11;
    if (kind === 'artists') { const all = [...ARTISTS.values()].filter((a) => a.genres.length); return json(200, page([...all.slice(shift % all.length), ...all.slice(0, shift % all.length)], url)); }
    const all = [...LIKED.keys()].map((id) => TRACKS.get(id)).filter(Boolean);
    return json(200, page([...all.slice(shift), ...all.slice(0, shift)], url));
  }

  let m = /^\/users\/([^/]+)\/playlists$/.exec(path);
  if (m) {
    if (method === 'POST') return json(201, playlistDetail(createPlaylist(body.name, body.description), url));
    const who = m[1];
    return json(200, page(PLAYLISTS.filter((p) => (who === DEMO_USER.id ? MY_PLAYLISTS.has(p.id) : p.owner.id === who)).map(simplePlaylist), url));
  }
  m = /^\/users\/([^/]+)$/.exec(path);
  if (m) return m[1] === DEMO_USER.id ? json(200, DEMO_USER) : m[1] === DEMO_FRIEND.id ? json(200, DEMO_FRIEND) : notFound();

  m = /^\/playlists\/([^/]+)(\/[a-z]+)?(\/contains)?$/.exec(path);
  if (m) {
    const p = playlistById(m[1]);
    if (!p) return notFound();
    const sub = m[2] || '';
    if (sub === '/followers') {
      if (m[3]) return json(200, [MY_PLAYLISTS.has(p.id)]);
      if (method === 'PUT') MY_PLAYLISTS.add(p.id);
      if (method === 'DELETE') MY_PLAYLISTS.delete(p.id);
      return json(200, {});
    }
    if (sub === '/images') return json(202, {});
    if (sub === '/tracks' || sub === '/items') {
      if (method !== 'GET') return playlistWrite(p, method, url, body);
      return json(200, page(p.entries.map(entryShape), url));
    }
    if (method === 'PUT') {
      if (typeof body.name === 'string') p.name = body.name;
      if (typeof body.description === 'string') p.description = body.description;
      if (typeof body.public === 'boolean') p.public = body.public;
      if (typeof body.collaborative === 'boolean') p.collaborative = body.collaborative;
      return json(200, {});
    }
    return json(200, playlistDetail(p, url));
  }

  m = /^\/albums\/([^/]+)(\/tracks)?$/.exec(path);
  if (m) {
    const a = albumById(m[1]);
    if (!a) return notFound();
    return json(200, m[2] ? page(a.trackList, url) : fullAlbum(a));
  }
  if (path === '/albums') return json(200, { albums: ids(url, body).map(albumById).filter(Boolean).map(fullAlbum) });
  if (path === '/tracks') return json(200, { tracks: ids(url, body).map((id) => TRACKS.get(id) || null) });
  m = /^\/tracks\/([^/]+)$/.exec(path);
  if (m) return TRACKS.has(m[1]) ? json(200, TRACKS.get(m[1])) : notFound();

  m = /^\/artists\/([^/]+)(\/[a-z-]+)?$/.exec(path);
  if (m) {
    const a = artistById(m[1]);
    if (!a) return notFound();
    if (m[2] === '/top-tracks') return json(200, { tracks: tracksOfArtist(a.id).slice(0, 10) });
    if (m[2] === '/albums') return json(200, page(albumsOfArtist(a.id).map(albumSummary), url));
    if (m[2] === '/related-artists') return json(200, { artists: [...ARTISTS.values()].filter((x) => x.id !== a.id).slice(0, 6) });
    return json(200, a);
  }
  if (path === '/artists') return json(200, { artists: ids(url, body).map((id) => artistById(id)) });

  if (path === '/search') return json(200, search(url));
  if (path.startsWith('/browse/')) return json(200, { playlists: page([], url), albums: page([], url), categories: page([], url) });
  return notFound();
}


// Jomify's own server: sync, parties and notifications need a real account. Tags answer empty;
// lyrics go to the real server, which serves the demo's songs without an account.
export async function answerJomify(url, init, realFetch) {
  if (url.pathname === '/api/lyrics') {
    const u = new URL(url);
    u.searchParams.set('demo', '1');
    return realFetch(u.toString(), { signal: init?.signal });
  }
  if (url.pathname === '/api/tags') return json(200, { tags: {} });
  return json(503, { error: 'Not available in the demo. Sign in with Spotify to use it.' });
}

// Spotify's in-browser player, without the browser part: it reports the demo player's state and
// passes every control to it
export function installDemoPlayer() {
  const listeners = {};
  const emit = (ev, payload) => (listeners[ev] || []).forEach((fn) => { try { fn(payload); } catch { /* a listener's problem */ } });
  window.Spotify = {
    Player: function Player() {
      let connected = false;
      const unsubscribe = engine.subscribe(() => { if (connected) emit('player_state_changed', engine.sdkState()); });
      this.addListener = (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); return true; };
      this.removeListener = (ev, fn) => { listeners[ev] = fn ? (listeners[ev] || []).filter((f) => f !== fn) : []; return true; };
      this.on = this.addListener;
      this.connect = () => { connected = true; setTimeout(() => emit('ready', { device_id: engine.DEMO_DEVICE.id }), 150); return Promise.resolve(true); };
      this.disconnect = () => { connected = false; unsubscribe(); };
      this.getCurrentState = () => Promise.resolve(engine.sdkState());
      this.togglePlay = () => { engine.toggle(); return Promise.resolve(); };
      this.resume = () => { engine.resume(); return Promise.resolve(); };
      this.pause = () => { engine.pause(); return Promise.resolve(); };
      this.nextTrack = () => { engine.next(); return Promise.resolve(); };
      this.previousTrack = () => { engine.previous(); return Promise.resolve(); };
      this.seek = (ms) => { engine.seek(ms); return Promise.resolve(); };
      this.setVolume = (v) => { engine.setVolume(Number(v) * 100); return Promise.resolve(); };
      this.getVolume = () => Promise.resolve(engine.snapshot().volume / 100);
      this.setName = () => Promise.resolve();
      this.activateElement = () => Promise.resolve();
    }
  };
}
