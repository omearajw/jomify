// How the real Spotify behaves with lists Jomify hands it, run from the debug log on the user's own
// account (19 Oct, before the queue redesign: Jomify will own the order and give Spotify a list
// of songs to play, and none of what that relies on is documented). It plays a few seconds of the
// user's liked songs on this browser, writes one "queue check" line per finding, puts shuffle and
// repeat back as they were and leaves the music paused.

import { useUserStore } from '../store/userStore';
import { usePlayerStore } from '../store/playerStore';
import { usePartyStore } from '../store/partyStore';
import { spotifyFetch } from './spotify/api';
import { holdForCheck } from './spotify/playbackController';
import { log } from './debugLog';

const PLAYER = 'https://api.spotify.com/v1/me/player';
const say = (message, detail) => log('queue check', message, detail);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let running = false;

async function call(method, path, body) {
  const token = useUserStore.getState().token;
  const started = Date.now();
  try {
    const response = await spotifyFetch(`${path.startsWith('http') ? path : PLAYER + path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    let json = null;
    if (response.status !== 204) { try { json = await response.json(); } catch { /* no body */ } }
    return { status: response.status, ms: Date.now() - started, json };
  } catch (err) {
    return { status: 0, ms: Date.now() - started, json: null, error: err?.message || String(err) };
  }
}

const sameSong = (track, uri) => Boolean(track && uri && (track.uri === uri || track.linked_from?.uri === uri || (track.id && uri.endsWith(':' + track.id))));
const current = () => usePlayerStore.getState().playbackState;

// Resolves with the time the player first reports a state passing the test, or null at the timeout
function waitForState(test, timeoutMs) {
  return new Promise((resolve) => {
    const check = (s) => { const st = s.playbackState; if (st && test(st)) { done(Date.now()); return true; } return false; };
    let unsub = () => {};
    const timer = setTimeout(() => { unsub(); resolve(null); }, timeoutMs);
    const done = (at) => { clearTimeout(timer); unsub(); resolve(at); };
    if (check(usePlayerStore.getState())) return;
    unsub = usePlayerStore.subscribe(check);
  });
}

const playing = (uri) => (st) => sameSong(st.track_window?.current_track, uri) && !st.paused && !st.loading;
const describe = (st) => st?.track_window?.current_track ? `${st.track_window.current_track.name}${st.paused ? ' (paused)' : ''}` : 'nothing';

async function likedSongs(max) {
  const songs = [];
  let url = 'https://api.spotify.com/v1/me/tracks?limit=50&market=from_token';
  while (url && songs.length < max) {
    const r = await call('GET', url);
    if (r.status !== 200) break;
    (r.json?.items || []).forEach((i) => { if (i?.track?.uri && i.track.is_playable !== false && !i.track.is_local) songs.push(i.track); });
    url = r.json?.next || null;
  }
  return songs.slice(0, max);
}

export async function checkQueueBehaviour() {
  if (running) return;
  const device = usePlayerStore.getState().deviceId;
  if (!useUserStore.getState().token) { say('not signed in'); return; }
  if (usePartyStore.getState().code) { say('not during a party: it would interrupt the music'); return; }
  if (!device) { say("this browser's player is not ready yet; try again in a moment"); return; }
  running = true;
  holdForCheck(true);
  const before = await call('GET', '');
  const was = before.json || {};
  say('starting', `this browser; was ${was.is_playing ? 'playing' : 'not playing'} on ${was.device?.name || 'nothing'}, shuffle ${was.shuffle_state ? 'on' : 'off'}, repeat ${was.repeat_state || 'off'}`);
  try {
    const songs = await likedSongs(500);
    say('songs to test with', `${songs.length} playable liked songs`);
    if (songs.length < 30) { say('needs at least 30 liked songs; stopping'); return; }
    const uris = songs.map((s) => s.uri);
    const q = `?device_id=${device}`;
    await call('PUT', '', { device_ids: [device], play: false });
    await sleep(1500);
    await call('PUT', `/shuffle?state=false&device_id=${device}`);
    await call('PUT', `/repeat?state=off&device_id=${device}`);
    await sleep(500);

    // 1. How long a list Spotify takes: start each at its last song, which only works if Spotify
    // kept the whole list
    for (const n of [100, 200, 300, 500]) {
      if (n > uris.length) { say(`LENGTH ${n}`, `skipped: only ${uris.length} songs`); continue; }
      const last = uris[n - 1];
      const asked = Date.now();
      const r = await call('PUT', `/play${q}`, { uris: uris.slice(0, n), offset: { position: n - 1 } });
      const at = r.status < 300 ? await waitForState(playing(last), 8000) : null;
      say(`LENGTH ${n}`, r.status >= 300 ? `refused: ${r.status} ${r.json?.error?.message || r.error || ''}` : at ? `took it: started song #${n} after ${at - asked}ms` : `answered ${r.status} but started ${describe(current())}`);
      await sleep(800);
    }

    // 2. Does a list start on the song asked for, with Spotify's shuffle off, and is the next one
    // the next in the list?
    const list = uris.slice(0, 60);
    for (const k of [0, 7, 23, 41]) {
      const asked = Date.now();
      const r = await call('PUT', `/play${q}`, { uris: list, offset: { position: k } });
      const at = r.status < 300 ? await waitForState(playing(list[k]), 8000) : null;
      const next = current()?.track_window?.next_tracks?.[0];
      say(`START at #${k + 1}`, r.status >= 300 ? `refused: ${r.status}` : at ? `right song after ${at - asked}ms; player's next is ${sameSong(next, list[k + 1]) ? 'the next in the list' : `NOT the next in the list (${next?.name || 'none'})`}` : `WRONG: asked for ${songs[k].name}, started ${describe(current())}`);
      await sleep(600);
    }
    const sq = await call('GET', '/queue');
    const upcoming = (sq.json?.queue || []).slice(0, 5);
    const k = 41;
    say("Spotify's queue during a list", upcoming.length ? `${upcoming.filter((t, i) => sameSong(t, list[k + 1 + i])).length} of the next ${upcoming.length} are the list's next songs, in order` : `empty (${sq.status})`);

    // 3. A song change Jomify makes itself: a new list given just before a song ends, against the
    // song change Spotify makes on its own within a list
    const timeChange = async (label, give) => {
      const a = songs[100] || songs[songs.length - 3];
      const nextInList = songs[101] || songs[songs.length - 2];
      const start = Math.max(0, (a.duration_ms || 30000) - 3500);
      await call('PUT', `/play${q}`, { uris: [a.uri, nextInList.uri], position_ms: start });
      const began = await waitForState(playing(a.uri), 8000);
      if (!began) { say(label, `could not start the test song (${describe(current())})`); return; }
      const endsAt = began + 3500;
      const r = await give(endsAt);
      const target = r?.target || nextInList.uri;
      const changed = await waitForState((st) => sameSong(st.track_window?.current_track, target), 9000);
      const sounding = await waitForState(playing(target), 9000);
      const rel = (at) => (at - endsAt < 0 ? `${endsAt - at}ms before` : `${at - endsAt}ms after`);
      say(label, changed ? `next song reported ${rel(changed)} the old one was due to end, sounding ${sounding ? rel(sounding) : 'never'}${r?.ms !== undefined ? `; the request took ${r.ms}ms` : ''}` : `the next song never came (${describe(current())})`);
      await sleep(800);
    };
    await timeChange('SONG CHANGE by Spotify, within a list', async () => null);
    for (const lead of [300, 1500]) {
      await timeChange(`SONG CHANGE by Jomify, new list sent ${lead}ms before the end`, async (endsAt) => {
        const b = songs[150] || songs[songs.length - 1];
        await sleep(Math.max(0, endsAt - lead - Date.now()));
        const r = await call('PUT', `/play${q}`, { uris: [b.uri, ...(songs.slice(151, 160).map((s) => s.uri))] });
        return { target: b.uri, ms: r.ms };
      });
    }

    // 4. Replacing the list mid-song, at the same song and position: how long the music stops
    {
      const c = songs[200] || songs[songs.length - 4];
      await call('PUT', `/play${q}`, { uris: [c.uri], position_ms: 20000 });
      if (await waitForState(playing(c.uri), 8000)) {
        await sleep(2500);
        const pos = current()?.position || 22000;
        const asked = Date.now();
        await call('PUT', `/play${q}`, { uris: [c.uri, ...uris.slice(0, 20)], position_ms: pos + 200 });
        // the player reports the restart as a fresh state for the same song once it is sounding
        const back = await waitForState((st) => playing(c.uri)(st) && st.timestamp > asked, 8000);
        say('NEW LIST MID-SONG', back ? `music back ${back - asked}ms after asking` : `no fresh report of the song (${describe(current())})`);
      } else say('NEW LIST MID-SONG', `could not start the test song (${describe(current())})`);
      await sleep(800);
    }

    // 5. What Spotify does when the list runs out
    {
      const e = songs[250] || songs[songs.length - 5];
      await call('PUT', `/play${q}`, { uris: [e.uri], position_ms: Math.max(0, (e.duration_ms || 30000) - 2500) });
      if (await waitForState(playing(e.uri), 8000)) {
        await sleep(9000);
        const st = current();
        const now = st?.track_window?.current_track;
        say('END OF LIST', sameSong(now, e.uri) ? `stopped: the last song, ${st?.paused ? 'paused' : 'still playing?'} at ${Math.round((st?.position || 0) / 1000)}s` : now ? `Spotify went on to its own pick: ${now.name} (${st?.paused ? 'paused' : 'playing'})` : 'nothing reported');
      } else say('END OF LIST', `could not start the test song (${describe(current())})`);
    }

    // 6. Moving to another device, paused: does the list go with it?
    {
      const d = await call('GET', '/devices');
      const other = (d.json?.devices || []).find((x) => x.id && x.id !== device && !x.is_restricted);
      if (!other) say('DEVICE MOVE', 'no other device available to try');
      else {
        const dl = uris.slice(300, 320).length === 20 ? uris.slice(300, 320) : uris.slice(0, 20);
        await call('PUT', `/play${q}`, { uris: dl, offset: { position: 0 } });
        await waitForState(playing(dl[0]), 8000);
        await call('PUT', `/pause${q}`);
        await sleep(1000);
        const moved = await call('PUT', '', { device_ids: [other.id], play: false });
        await sleep(2500);
        const there = await call('GET', '/queue');
        const kept = (there.json?.queue || []).slice(0, 3).filter((t, i) => sameSong(t, dl[1 + i])).length;
        say('DEVICE MOVE', `to ${other.name} (${other.type}), paused: ${moved.status >= 300 ? `refused ${moved.status}` : `playing ${sameSong(there.json?.currently_playing, dl[0]) ? 'the same song' : there.json?.currently_playing?.name || 'nothing'}, ${kept} of the next 3 still the list's`}`);
        await call('PUT', '', { device_ids: [device], play: false });
        await sleep(2000);
        const back = await call('GET', '/queue');
        const keptBack = (back.json?.queue || []).slice(0, 3).filter((t, i) => sameSong(t, dl[1 + i])).length;
        say('DEVICE MOVE back here', `${keptBack} of the next 3 still the list's`);
      }
    }
  } catch (err) {
    say('stopped by an error', err?.message || String(err));
  } finally {
    await call('PUT', `/pause?device_id=${device}`);
    if (was.shuffle_state !== undefined) await call('PUT', `/shuffle?state=${Boolean(was.shuffle_state)}&device_id=${device}`);
    if (was.repeat_state) await call('PUT', `/repeat?state=${was.repeat_state}&device_id=${device}`);
    holdForCheck(false);
    running = false;
    say('finished', 'paused here; shuffle and repeat put back');
  }
}
