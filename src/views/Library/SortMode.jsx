import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Play, Pause, SkipForward, SkipBack, ChevronRight, Undo2, Star, Check, Layers, Loader } from 'lucide-react';
import { useUserStore } from '../../store/userStore';
import { usePlayerStore } from '../../store/playerStore';
import { usePlaybackSummary } from '../../store/selectors';
import { playOn, togglePlay, next as nextTrack, previous as previousTrack, seek, requestFastPlaybackUpdates } from '../../services/spotify/playbackController';
import { playUris, addTracksToPlaylist, removeTrackFromPlaylist } from '../../services/spotify/api';
import { useProgress } from '../../hooks/useProgress';
import { toast } from '../../store/toastStore';
import { artUrl } from '../../utils/images';
import { tagCache } from '../../services/tags';
import { MOOD_WORDS } from '../../utils/playlistSuggestions';
import { isSameTrack } from '../../utils/spotifyUri';
import { log } from '../../services/debugLog';

// Full-screen sorting for Unadded Songs: one song at a time as a card, the check playlists as
// tiles, the suggested ones large. Drag the card onto a tile (or tap the tile) to file the song.
// The first filing removes it from Unadded Songs; further filings only add, so a song can go
// into two playlists before you move on. Pointer events rather than HTML drag and drop, because
// touch screens have no drag and drop.
//
// Skipped songs are remembered per playlist on this device and passed over next time, until
// every song has been filed or skipped, when the slate is wiped.

const SETTINGS_KEY = 'jomify_sort_mode';
const skippedKey = (playlistId) => `jomify_sort_skipped:${playlistId}`;

// How long the card must hold still before its song is started. Long enough that a run of taps
// on Skip asks Spotify for one song rather than all of them, short enough not to feel sluggish
// on a single deliberate skip, where only the audio waits and the card moves at once.
const AUTOPLAY_SETTLE_MS = 300;
// How many songs still waiting are handed to Spotify along with the card
const PLAY_AHEAD = 50;
const DROP_THRESHOLD_PX = 8;
const SWIPE_SKIP_PX = 140;
// Spotify is told to change song, but the next poll can still be describing the old one for a
// few seconds. For this long after the card moves, it does not follow playback anywhere else.
const HOLD_FOLLOW_MS = 8000;

// Settings and skips live in the store now (and sync between devices). What an earlier build
// kept in localStorage on this device is read once more, merged in, and the old keys go.
function readLegacy(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}
function adoptLegacy(playlistId) {
  const store = useUserStore.getState();
  const settings = readLegacy(SETTINGS_KEY);
  if (settings && typeof settings === 'object') store.setSortModeSettings(settings);
  const skipped = readLegacy(skippedKey(playlistId));
  if (Array.isArray(skipped) && skipped.length) {
    store.setSortSkips(playlistId, [...new Set([...(store.sortSkips[playlistId] || []), ...skipped])]);
  }
  try { localStorage.removeItem(SETTINGS_KEY); localStorage.removeItem(skippedKey(playlistId)); } catch { /* fine */ }
}

const nowPlayingTrack = () => usePlayerStore.getState().playbackState?.track_window?.current_track || null;

function Toggle({ label, on, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="flex items-center gap-2 text-xs font-semibold text-neutral-300 whitespace-nowrap"
    >
      <span className={`relative inline-block shrink-0 w-9 h-5 rounded-full transition-colors ${on ? 'bg-[var(--brand-mid)]' : 'bg-neutral-700'}`}>
        <span className={`absolute left-0 top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </span>
      {label}
    </button>
  );
}

export default function SortMode({ items, total, loadingMore, suggestionsByTrack, suggestionsReady, targets, sourcePlaylistId, onRemovedFromSource, onRestoredToSource, onClose }) {
  const token = useUserStore((s) => s.token);
  const playlists = useUserStore((s) => s.playlists);
  const { currentPlayingTrack, isCurrentTrackPaused } = usePlaybackSummary();

  // The page owns the pile: it only ever grows, as the rest of the playlist streams in
  const queue = items;
  const pileSize = Math.max(total || 0, queue.length);

  // What has been decided about each song: skipped (remembered in the store, so on every
  // device) or filed into one or more playlists. A song with neither is still waiting.
  const [skipped, setSkipped] = useState(() => new Set([
    ...(useUserStore.getState().sortSkips[sourcePlaylistId] || []),
    ...(readLegacy(skippedKey(sourcePlaylistId)) || [])
  ]));
  const saveSkipped = (playlistId, set) => useUserStore.getState().setSortSkips(playlistId, [...set]);
  useEffect(() => { adoptLegacy(sourcePlaylistId); }, [sourcePlaylistId]);
  const [placed, setPlaced] = useState({}); // uri -> [playlistId]
  const isDecided = (uri) => skipped.has(uri) || (placed[uri] || []).length > 0;

  // The card is named by its song, not by a position in the pile. Null means "the first song
  // still waiting", which is also how songs arriving with a later page get picked up once the
  // ones already loaded run out. A song just filed stays the card until the user moves on, so it
  // can be undone or added to a second playlist. It starts on whatever is playing, if that is in
  // the pile and has not been skipped.
  const [cardUri, setCardUri] = useState(() => {
    const playing = nowPlayingTrack();
    const hit = playing ? queue.find((i) => i?.track && isSameTrack(i.track, playing)) : null;
    return hit && !skipped.has(hit.track.uri) ? hit.track.uri : null;
  });
  const pinned = cardUri ? queue.findIndex((i) => i?.track?.uri === cardUri) : -1;
  const cursor = pinned >= 0 ? pinned : queue.findIndex((i) => i?.track?.uri && !isDecided(i.track.uri));
  const current = cursor >= 0 ? queue[cursor] : null;
  const track = current?.track || null;
  const exhausted = cursor < 0;
  const done = exhausted && !loadingMore;

  const [busy, setBusy] = useState(false);
  const [lastAction, setLastAction] = useState(null);
  const settings = useUserStore((s) => s.sortModeSettings);
  const [drag, setDrag] = useState(null); // { dx, dy, overId }
  const cardRef = useRef(null);
  const dragState = useRef(null);

  // Every song filed or skipped: the remembered skips have served their purpose
  useEffect(() => {
    if (done) saveSkipped(sourcePlaylistId, new Set());
  }, [done, sourcePlaylistId]);

  useEffect(() => {
    log('sort', 'opened', `${queue.length} songs loaded, ${skipped.size} skipped in earlier sessions`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateSettings = (patch) => useUserStore.getState().setSortModeSettings(patch);

  const imageFor = (id) => playlists.find((p) => p.id === id)?.images;
  const suggestions = track ? (suggestionsByTrack.get(track.id) || []) : [];
  const suggestedIds = new Set(suggestions.map((s) => s.id));
  const others = targets.filter((t) => !suggestedIds.has(t.id));
  const placedHere = track ? (placed[track.uri] || []) : [];
  const filed = placedHere.length > 0;
  // What the song is being judged on, mood words first, so a decision is never a mystery
  const songTags = track ? (tagCache.get(track.id) || []).slice(0, 6).sort((a, b) => Number(MOOD_WORDS.has(b.name)) - Number(MOOD_WORDS.has(a.name))) : [];
  const isThisPlaying = isSameTrack(currentPlayingTrack, track);

  // The next song still waiting after the card, wrapping round so a pile begun part way through
  // still visits what came before. The card itself never counts, which matters because a skip
  // asks this before the skip has been recorded.
  const waitingAfter = (index, limit = 1) => {
    const found = [];
    const n = queue.length;
    for (let k = 1; k < n && found.length < limit; k++) {
      const uri = queue[(index + k) % n]?.track?.uri;
      if (uri && !isDecided(uri)) found.push(uri);
    }
    return found;
  };
  const nextCard = () => waitingAfter(cursor)[0] || null;

  const skip = () => {
    if (!track) return;
    if (!filed) {
      const next = new Set(skipped);
      next.add(track.uri);
      setSkipped(next);
      saveSkipped(sourcePlaylistId, next);
    }
    log('sort', filed ? 'moved on' : 'skipped', track.name);
    setCardUri(nextCard());
  };

  // Plays the card and then every song still waiting after it, in pile order, so playback carries
  // on through exactly the songs left to sort. Playing the playlist itself carried on into songs
  // already skipped, and the card had to chase it.
  const playGeneration = useRef(0);
  const playCard = () => {
    if (!track) return undefined;
    const uris = [track.uri, ...waitingAfter(cursor, PLAY_AHEAD - 1)];
    const mine = ++playGeneration.current;
    return playOn((deviceId) => {
      // Finding a device can take a moment, and the card may have moved on while it did
      if (playGeneration.current !== mine) return Promise.resolve();
      log('sort', 'playing the card', `${track.name}, ${uris.length - 1} more queued behind it`);
      return playUris(token, deviceId, uris, 0);
    }, { track });
  };

  // Only the card the user settles on is played. Skipping through a run of songs used to send one
  // play request per card it passed, so every song being skipped started in turn. The effect's
  // own cleanup cancels a pending start when the card moves.
  useEffect(() => {
    if (!settings.autoplay || !track || !token) return undefined;
    if (isSameTrack(nowPlayingTrack(), track)) return undefined;
    const wanted = track;
    const timer = setTimeout(() => {
      if (!isSameTrack(nowPlayingTrack(), wanted)) playCard();
    }, AUTOPLAY_SETTLE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.uri, settings.autoplay]);

  // When the card moves on the user's account, Spotify can go on describing the song it left for
  // a few seconds. Following playback is held off until Spotify names the card's own song or the
  // hold runs out. A move that came from following playback needs no hold. Declared before the
  // subscriber below, so the hold is in place by the time that one first looks.
  const holdFollowUntil = useRef(0);
  const followed = useRef(false);
  useEffect(() => {
    if (followed.current) { followed.current = false; return; }
    holdFollowUntil.current = Date.now() + HOLD_FOLLOW_MS;
  }, [track?.uri]);

  // The card follows playback through the pile: when a song ends and Spotify plays the next one
  // waiting, or someone presses next on the lock screen, the card moves with it. Songs from
  // outside the pile leave the card alone.
  useEffect(() => {
    if (!track) return undefined;
    const card = track;
    const from = cursor;
    let heard = false;
    const moveOn = (why) => {
      const uri = waitingAfter(from)[0] || null;
      log('sort', why, uri ? 'moving the card on' : 'nothing else waiting');
      setCardUri(uri);
    };
    const check = (state) => {
      const pb = state.playbackState;
      const now = pb?.track_window?.current_track;
      // Only Spotify's own word counts. A "pending:" track is this app showing what it has just
      // asked for, before Spotify has confirmed it.
      if (!pb || !now || String(now.uid || '').startsWith('pending:')) return;

      if (isSameTrack(now, card)) {
        holdFollowUntil.current = 0;
        if (!pb.paused) { heard = true; return; }
        const finished = (pb.position || 0) === 0 || (pb.duration > 0 && pb.position >= pb.duration - 1500);
        if (heard && finished && settings.autoplay) { heard = false; moveOn('song finished'); }
        return;
      }
      if (Date.now() < holdFollowUntil.current) return;

      const hit = queue.findIndex((i) => i?.track && isSameTrack(i.track, now));
      if (hit < 0) return;
      const uri = queue[hit].track.uri;
      if (!isDecided(uri)) {
        log('sort', 'followed playback', now.name);
        followed.current = true;
        setCardUri(uri);
        return;
      }
      // Playing on into songs already dealt with, which happens when the pile was started from
      // the playlist page before Sort mode opened. Move the card on and let it take over.
      if (heard && settings.autoplay) { heard = false; moveOn('playback ran on into a song already sorted'); }
    };
    check(usePlayerStore.getState());
    return usePlayerStore.subscribe(check);
    // check reads `skipped` and `placed`, so it is rebuilt when they change: filing a song
    // without moving on changes neither the card nor the queue
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.autoplay, track?.uri, queue, skipped, placed]);

  // This screen shows the pile and what is playing side by side, so it needs the quick cadence
  useEffect(() => requestFastPlaybackUpdates(), []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const fileInto = async (playlistId) => {
    if (!track || busy || !token) return;
    const target = targets.find((t) => t.id === playlistId);
    if (!target || placedHere.includes(playlistId)) return;
    const first = placedHere.length === 0;
    setBusy(true);
    try {
      await addTracksToPlaylist(token, playlistId, [track.uri]);
      if (first) {
        await removeTrackFromPlaylist(token, sourcePlaylistId, track.uri);
        onRemovedFromSource(track.uri);
      }
    } catch (err) {
      console.error('Filing the song failed:', err);
      toast(`Couldn't add "${track.name}" to ${target.name}`, { tone: 'error' });
      setBusy(false);
      return;
    }
    setBusy(false);
    setPlaced((prev) => ({ ...prev, [track.uri]: [...(prev[track.uri] || []), playlistId] }));
    setLastAction({ uri: track.uri, item: current, playlistId });
    toast(`Added to ${target.name}`, { tone: 'success', duration: 1500 });
    log('sort', 'filed', `${track.name} into ${target.name}`);
    // Without "Next after sorting" the card stays on the song, so it can be undone or filed again
    setCardUri(settings.advance ? nextCard() : track.uri);
  };

  // Takes a song back out of a playlist, from Undo or from tapping a playlist it is already in.
  // The first filing took it out of Unadded Songs, so taking it out of the last playlist it is in
  // puts it back there. That is decided from where the song is now, not from which filing came
  // first, so undoing and deselecting in any order never leaves a song in no playlist at all.
  const takeOut = async (uri, item, playlistId) => {
    const inPlaylists = placed[uri] || [];
    if (!inPlaylists.includes(playlistId)) return false;
    const target = targets.find((t) => t.id === playlistId);
    const name = item?.track?.name || 'the song';
    const last = inPlaylists.length === 1;
    setBusy(true);
    try {
      await removeTrackFromPlaylist(token, playlistId, uri);
      if (last) {
        await addTracksToPlaylist(token, sourcePlaylistId, [uri]);
        onRestoredToSource(item);
      }
    } catch (err) {
      console.error('Taking the song back out failed:', err);
      toast(`Couldn't remove "${name}" from ${target?.name || 'that playlist'}`, { tone: 'error' });
      setBusy(false);
      return false;
    }
    setBusy(false);
    setPlaced((prev) => ({ ...prev, [uri]: (prev[uri] || []).filter((id) => id !== playlistId) }));
    if (lastAction?.uri === uri && lastAction.playlistId === playlistId) setLastAction(null);
    log('sort', last ? 'took out of its last playlist, back in Unadded Songs' : 'took out', `${name} from ${target?.name || playlistId}`);
    toast(last ? `Removed from ${target?.name || 'the playlist'}, back in Unadded Songs` : `Removed from ${target?.name || 'the playlist'}`, { tone: 'info', duration: 1800 });
    return true;
  };

  const unfile = (playlistId) => {
    if (!track || busy || !token) return;
    takeOut(track.uri, current, playlistId);
  };

  const undo = async () => {
    if (!lastAction || busy || !token) return;
    const { uri, item, playlistId } = lastAction;
    if (await takeOut(uri, item, playlistId)) setCardUri(uri);
  };

  // --- Dragging the card ---
  // The dragged card is under the pointer, so look through the whole stack for a tile
  const tileAt = (x, y) => {
    for (const el of document.elementsFromPoint(x, y)) {
      if (cardRef.current?.contains(el)) continue;
      const tile = el.closest('[data-sort-target]');
      if (tile) return tile.dataset.sortTarget;
    }
    return null;
  };

  const onPointerDown = (e) => {
    if (busy || !track || e.button > 0) return;
    if (e.target.closest('button')) return;
    dragState.current = { startX: e.clientX, startY: e.clientY, moved: false, pointerId: e.pointerId };
    cardRef.current?.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    const d = dragState.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < DROP_THRESHOLD_PX) return;
    d.moved = true;
    setDrag({ dx, dy, overId: tileAt(e.clientX, e.clientY) });
  };
  const onPointerUp = () => {
    const d = dragState.current;
    dragState.current = null;
    if (!d) return;
    cardRef.current?.releasePointerCapture?.(d.pointerId);
    const snapshot = drag;
    setDrag(null);
    if (!d.moved || !snapshot) return;
    if (snapshot.overId) fileInto(snapshot.overId);
    else if (Math.abs(snapshot.dx) > SWIPE_SKIP_PX && Math.abs(snapshot.dx) > Math.abs(snapshot.dy)) skip();
  };

  const tile = (t, large) => {
    const suggestion = suggestions.find((s) => s.id === t.id);
    const already = placedHere.includes(t.id);
    const over = drag?.overId === t.id;
    const images = imageFor(t.id);
    return (
      <button
        key={t.id}
        type="button"
        data-sort-target={t.id}
        disabled={busy}
        onClick={() => (already ? unfile(t.id) : fileInto(t.id))}
        aria-pressed={already}
        title={already ? `In ${t.name}. Tap to take it back out` : (suggestion?.reason || `Add to ${t.name}`)}
        className={`group relative flex ${large ? 'flex-col items-stretch p-3 rounded-3xl' : 'items-center gap-3 p-2 rounded-2xl'} border text-left backdrop-blur-md transition-all
          ${over ? 'border-[var(--brand-mid)] bg-[var(--brand-mid)]/20 scale-[1.04] shadow-brand-glow' : already ? 'border-[var(--brand-mid)]/60 bg-[var(--brand-mid)]/10 hover:border-red-400/60 hover:bg-red-500/10' : large ? 'border-white/10 bg-white/[0.05] hover:border-white/25' : 'border-white/5 bg-white/[0.03] hover:border-white/20'}`}
      >
        <div className={`${large ? 'w-full aspect-square mb-3' : 'w-10 h-10 shrink-0'} rounded-xl overflow-hidden bg-neutral-800 flex items-center justify-center pointer-events-none`}>
          {images?.[0]?.url ? <img src={artUrl(images, large ? 240 : 40)} alt="" className="w-full h-full object-cover" draggable="false" /> : <span className="text-2xl">🎵</span>}
        </div>
        <div className="min-w-0 pointer-events-none">
          <p className={`font-bold text-white truncate ${large ? 'text-sm' : 'text-xs'}`}>{t.name}</p>
          {large && suggestion?.reason && <p className="text-[11px] text-neutral-400 truncate">{suggestion.reason}</p>}
        </div>
        {already && (
          <span className="absolute top-2 right-2 pointer-events-none">
            <Check className="w-4 h-4 text-[var(--brand-mid)] group-hover:hidden" />
            <X className="w-4 h-4 text-red-300 hidden group-hover:block" />
          </span>
        )}
        {large && suggestion && !already && <Star className="absolute top-2 right-2 w-4 h-4 fill-current text-[var(--brand-mid)] pointer-events-none" />}
      </button>
    );
  };

  const cardStyle = drag
    ? { transform: `translate(${drag.dx}px, ${drag.dy}px) rotate(${drag.dx / 30}deg)`, transition: 'none' }
    : { transform: 'translate(0,0)', transition: 'transform 200ms ease' };

  const art = track?.album?.images?.[0]?.url;
  const { position, duration, paused, track: playingTrack } = useProgress();
  const progress = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;
  const fmt = (ms) => { const s = Math.floor((ms || 0) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const transport = (
    <div className="w-full max-w-[22rem] rounded-2xl border border-white/10 bg-black/40 backdrop-blur-md px-3 py-2">
      <div className="flex items-center gap-2">
        <p data-sort-transport="" className="flex-1 min-w-0 text-xs text-neutral-300 truncate">
          {playingTrack
            ? <>{!isThisPlaying && <span className="text-neutral-500">Playing: </span>}<span className="text-white font-semibold">{playingTrack.name}</span> · {playingTrack.artists?.map((a) => a.name).join(', ')}</>
            : 'Nothing playing'}
        </p>
        <button type="button" onClick={previousTrack} aria-label="Previous" className="w-9 h-9 rounded-full flex items-center justify-center text-neutral-300 hover:text-white"><SkipBack className="w-4 h-4 fill-current" /></button>
        <button type="button" onClick={togglePlay} aria-label={paused ? 'Play' : 'Pause'} className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center active:scale-95 transition-transform">
          {paused ? <Play className="w-4 h-4 fill-current ml-0.5" /> : <Pause className="w-4 h-4 fill-current" />}
        </button>
        <button type="button" onClick={nextTrack} aria-label="Next" className="w-9 h-9 rounded-full flex items-center justify-center text-neutral-300 hover:text-white"><SkipForward className="w-4 h-4 fill-current" /></button>
      </div>
      <div className="flex items-center gap-2 mt-1.5 text-[10px] text-neutral-500 tabular-nums">
        <span>{fmt(position)}</span>
        <input
          type="range"
          min="0"
          max={Math.max(1, duration)}
          value={Math.min(position, duration || 0)}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label="Seek"
          disabled={!playingTrack}
          className="flex-1 h-1.5 rounded-lg appearance-none cursor-pointer accent-white disabled:opacity-40"
          style={{ background: `linear-gradient(to right, var(--brand-start) 0%, var(--brand-mid) ${progress}%, #404040 ${progress}%, #404040 100%)` }}
        />
        <span>{fmt(duration)}</span>
      </div>
    </div>
  );

  return createPortal(
    <div className="fixed inset-0 z-[9000] bg-black text-white flex flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] select-none touch-none overflow-hidden font-sans">
      {/* Same backdrop as Now Playing: the aurora, the song's art blurred, a fade to black */}
      <div className="absolute inset-0 bg-aurora opacity-20 pointer-events-none" aria-hidden="true" />
      {art && <img src={art} alt="" aria-hidden="true" className="absolute inset-0 w-full h-full object-cover opacity-25 blur-3xl scale-125 pointer-events-none" />}
      <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/50 to-black/90 pointer-events-none" aria-hidden="true" />

      <div className="relative flex flex-wrap items-center gap-x-3 gap-y-2 px-4 md:px-6 py-3 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-full bg-white/[0.06] border border-white/10 flex items-center justify-center shrink-0"><Layers className="w-4 h-4 text-[var(--brand-mid)]" /></div>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-400">Unadded songs</p>
            <h2 className="font-extrabold tracking-tight leading-tight whitespace-nowrap">Sort songs <span className="text-neutral-400 font-semibold text-sm">{Math.min(Math.max(cursor, 0) + 1, pileSize)} / {pileSize}</span></h2>
          </div>
        </div>
        <div className="order-last w-full md:order-none md:w-auto md:ml-auto flex items-center gap-4">
          <Toggle label="Play songs" on={settings.autoplay} onChange={(v) => updateSettings({ autoplay: v })} />
          <Toggle label="Next after sorting" on={settings.advance} onChange={(v) => updateSettings({ advance: v })} />
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="ml-auto md:ml-0 w-10 h-10 rounded-full bg-black/40 flex items-center justify-center text-neutral-300 hover:text-white"><X className="w-5 h-5" /></button>
      </div>

      {exhausted && !done ? (
        <div className="relative flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
          <Loader className="w-8 h-8 animate-spin text-neutral-400" />
          <p className="text-sm text-neutral-400">Loading the rest of the playlist…</p>
        </div>
      ) : done ? (
        <div className="relative flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center">
          <div className="w-16 h-16 rounded-full bg-brand-gradient flex items-center justify-center shadow-brand-glow"><Check className="w-8 h-8" /></div>
          <p className="text-2xl font-extrabold tracking-tight">That's the pile</p>
          <p className="text-sm text-neutral-400 max-w-xs">Every song has been filed or skipped. Skipped songs are still in Unadded Songs and will come round again next time.</p>
          <div className="flex gap-3">
            {lastAction && <button type="button" onClick={undo} className="rounded-full border border-white/15 px-4 py-2 text-sm font-semibold hover:bg-white/5">Undo last</button>}
            <button type="button" onClick={onClose} className="rounded-full bg-white text-black px-5 py-2 text-sm font-bold hover:bg-neutral-200">Done</button>
          </div>
        </div>
      ) : (
        // On the phone the card sits at the bottom, under the thumb, and the tiles scroll above it
        <div className="relative flex-1 min-h-0 flex flex-col-reverse md:flex-row gap-3 md:gap-6 p-3 md:p-6 overflow-hidden">
          <div className="md:w-[22rem] shrink-0 flex flex-col items-center gap-3">
            <div
              ref={cardRef}
              data-sort-card=""
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              style={cardStyle}
              className={`w-full max-w-[22rem] rounded-3xl border border-white/10 bg-white/[0.06] backdrop-blur-xl shadow-2xl p-3 md:p-4 flex md:flex-col items-center md:items-stretch gap-3 md:gap-4 cursor-grab active:cursor-grabbing ${drag ? 'z-20 shadow-brand-glow border-[var(--brand-mid)]/40' : ''}`}
            >
              <div className="w-20 h-20 md:w-full md:aspect-square md:h-auto rounded-2xl overflow-hidden bg-neutral-800 shrink-0 shadow-lg pointer-events-none">
                {art && <img src={artUrl(track.album.images, 320)} alt="" className="w-full h-full object-cover" draggable="false" />}
              </div>
              <div className="min-w-0 flex-1 pointer-events-none">
                <p className="font-extrabold text-base md:text-lg leading-tight tracking-tight line-clamp-2">{track.name}</p>
                <p className="text-sm text-neutral-400 truncate">{track.artists?.map((a) => a.name).join(', ')}</p>
                {songTags.length > 0 && (
                  <p className="text-[11px] text-neutral-500 mt-1 truncate">
                    {songTags.map((t, i) => <span key={t.name} className={MOOD_WORDS.has(t.name) ? 'text-neutral-300' : ''}>{i ? ' · ' : ''}{t.name}</span>)}
                  </p>
                )}
                {placedHere.length > 0 && (
                  <p className="text-xs text-[var(--brand-mid)] mt-1 truncate">In {placedHere.map((id) => targets.find((t) => t.id === id)?.name).filter(Boolean).join(', ')}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => { if (isThisPlaying) togglePlay(); else playCard(); }}
                aria-label={isThisPlaying && !isCurrentTrackPaused ? 'Pause' : 'Play'}
                className="w-12 h-12 rounded-full bg-brand-gradient flex items-center justify-center shrink-0 md:self-center shadow-brand-glow active:scale-95 transition-transform"
              >
                {isThisPlaying && !isCurrentTrackPaused ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
              </button>
            </div>
            {transport}
            <p className="text-[11px] text-neutral-500 text-center hidden md:block">Drag the card onto a playlist, or tap one. Swipe sideways to skip.</p>
            <div className="flex items-center gap-2">
              <button type="button" onClick={undo} disabled={!lastAction || busy} className="flex items-center gap-1.5 rounded-full border border-white/15 bg-black/30 px-4 h-10 text-sm font-semibold hover:bg-white/5 disabled:opacity-40">
                <Undo2 className="w-4 h-4" /> Undo
              </button>
              <button type="button" onClick={skip} disabled={busy} className="flex items-center gap-1.5 rounded-full border border-white/15 bg-black/30 px-4 h-10 text-sm font-semibold hover:bg-white/5 disabled:opacity-40">
                {filed ? 'Next' : 'Skip'} <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain -mx-1 px-1">
            {suggestions.length > 0 && (
              <>
                <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-400 mb-2">Suggested</p>
                <div className="grid grid-cols-3 gap-2 md:gap-3 mb-4">
                  {suggestions.map((s) => tile(targets.find((t) => t.id === s.id) || s, true))}
                </div>
              </>
            )}
            {!suggestionsReady && suggestions.length === 0 && (
              <p className="flex items-center gap-2 text-xs text-neutral-400 mb-3"><Loader className="w-3.5 h-3.5 animate-spin" /> Working out which playlists fit…</p>
            )}
            {others.length > 0 && (
              <>
                <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-400 mb-2">{suggestions.length ? 'Everything else' : 'Your playlists'}</p>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                  {others.map((t) => tile(t, false))}
                </div>
              </>
            )}
            {targets.length === 0 && <p className="text-sm text-neutral-500">Pick some playlists to check against first.</p>}
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}
