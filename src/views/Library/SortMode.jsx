import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Play, Pause, SkipForward, Undo2, Star, Check, Layers } from 'lucide-react';
import { useUserStore } from '../../store/userStore';
import { usePlaybackSummary } from '../../store/selectors';
import { playOn, togglePlay } from '../../services/spotify/playbackController';
import { playSingleTrack, addTracksToPlaylist, removeTrackFromPlaylist } from '../../services/spotify/api';
import { toast } from '../../store/toastStore';
import { artUrl } from '../../utils/images';

// Full-screen sorting for Unadded Songs: one song at a time as a card, the check playlists as
// tiles, the suggested ones large. Drag the card onto a tile (or tap the tile) to file the song.
// The first filing removes it from Unadded Songs; further filings only add, so a song can go
// into two playlists before you move on. Pointer events rather than HTML drag and drop, because
// touch screens have no drag and drop.

const SETTINGS_KEY = 'jomify_sort_mode';
const DROP_THRESHOLD_PX = 8;
const SWIPE_SKIP_PX = 140;

function loadSettings() {
  try { return { autoplay: true, advance: false, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; }
  catch { return { autoplay: true, advance: false }; }
}

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

export default function SortMode({ items, suggestionsByTrack, targets, sourcePlaylistId, onRemovedFromSource, onRestoredToSource, onClose }) {
  const token = useUserStore((s) => s.token);
  const playlists = useUserStore((s) => s.playlists);
  const { currentPlayingTrack, isCurrentTrackPaused } = usePlaybackSummary();

  // A snapshot: the source list shrinks as songs are filed, the pile must not
  const [queue] = useState(() => (items || []).filter((i) => i?.track?.uri));
  const [index, setIndex] = useState(0);
  const [placed, setPlaced] = useState({}); // uri -> [playlistId]
  const [busy, setBusy] = useState(false);
  const [lastAction, setLastAction] = useState(null);
  const [settings, setSettings] = useState(loadSettings);
  const [drag, setDrag] = useState(null); // { dx, dy, overId }
  const cardRef = useRef(null);
  const dragState = useRef(null);

  const current = queue[index] || null;
  const track = current?.track || null;
  const done = index >= queue.length;

  const updateSettings = (patch) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch { /* fine */ }
      return next;
    });
  };

  const imageFor = (id) => playlists.find((p) => p.id === id)?.images;
  const suggestions = track ? (suggestionsByTrack.get(track.id) || []) : [];
  const suggestedIds = new Set(suggestions.map((s) => s.id));
  const others = targets.filter((t) => !suggestedIds.has(t.id));
  const placedHere = track ? (placed[track.uri] || []) : [];

  // Play each song as it comes up, when asked to
  useEffect(() => {
    if (!settings.autoplay || !track || !token) return;
    playOn((deviceId) => playSingleTrack(token, deviceId, track.uri));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.uri, settings.autoplay]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isThisPlaying = track && currentPlayingTrack && (currentPlayingTrack.uri === track.uri || currentPlayingTrack.id === track.id);

  const advance = () => setIndex((i) => i + 1);

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
    setLastAction({ uri: track.uri, item: current, index, playlistId, playlistName: target.name, first });
    toast(`Added to ${target.name}`, { tone: 'success', duration: 1500 });
    if (settings.advance) advance();
  };

  const undo = async () => {
    if (!lastAction || busy || !token) return;
    setBusy(true);
    try {
      await removeTrackFromPlaylist(token, lastAction.playlistId, lastAction.uri);
      if (lastAction.first) {
        await addTracksToPlaylist(token, sourcePlaylistId, [lastAction.uri]);
        onRestoredToSource(lastAction.item);
      }
    } catch (err) {
      console.error('Undo failed:', err);
      toast("Couldn't undo that", { tone: 'error' });
      setBusy(false);
      return;
    }
    setBusy(false);
    setPlaced((prev) => ({ ...prev, [lastAction.uri]: (prev[lastAction.uri] || []).filter((id) => id !== lastAction.playlistId) }));
    setIndex(lastAction.index);
    setLastAction(null);
    toast(`Removed from ${lastAction.playlistName}`, { tone: 'info', duration: 1500 });
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
    else if (Math.abs(snapshot.dx) > SWIPE_SKIP_PX && Math.abs(snapshot.dx) > Math.abs(snapshot.dy)) advance();
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
        disabled={busy || already}
        onClick={() => fileInto(t.id)}
        title={suggestion?.reason || `Add to ${t.name}`}
        className={`group relative flex ${large ? 'flex-col items-stretch p-3 rounded-3xl' : 'items-center gap-3 p-2 rounded-2xl'} border text-left transition-all
          ${over ? 'border-[var(--brand-mid)] bg-[var(--brand-mid)]/20 scale-[1.04] shadow-brand-glow' : already ? 'border-white/5 bg-white/[0.03] opacity-60' : large ? 'border-white/10 bg-white/[0.06] hover:border-white/25' : 'border-white/5 bg-white/[0.03] hover:border-white/20'}`}
      >
        <div className={`${large ? 'w-full aspect-square mb-3' : 'w-10 h-10 shrink-0'} rounded-xl overflow-hidden bg-neutral-800 flex items-center justify-center pointer-events-none`}>
          {images?.[0]?.url ? <img src={artUrl(images, large ? 240 : 40)} alt="" className="w-full h-full object-cover" draggable="false" /> : <span className="text-2xl">🎵</span>}
        </div>
        <div className="min-w-0 pointer-events-none">
          <p className={`font-bold text-white truncate ${large ? 'text-sm' : 'text-xs'}`}>{t.name}</p>
          {large && suggestion?.reason && <p className="text-[11px] text-neutral-400 truncate">{suggestion.reason}</p>}
        </div>
        {already && <Check className="absolute top-2 right-2 w-4 h-4 text-[var(--brand-mid)] pointer-events-none" />}
        {large && suggestion && !already && <Star className="absolute top-2 right-2 w-4 h-4 fill-current text-[var(--brand-mid)] pointer-events-none" />}
      </button>
    );
  };

  const cardStyle = drag
    ? { transform: `translate(${drag.dx}px, ${drag.dy}px) rotate(${drag.dx / 30}deg)`, transition: 'none' }
    : { transform: 'translate(0,0)', transition: 'transform 200ms ease' };

  return createPortal(
    <div className="fixed inset-0 z-[10000] bg-neutral-950 text-white flex flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] select-none touch-none">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 border-b border-white/10 shrink-0">
        <Layers className="w-5 h-5 text-[var(--brand-mid)] shrink-0" />
        <h2 className="font-bold whitespace-nowrap">Sort songs</h2>
        <span className="text-xs text-neutral-400 whitespace-nowrap">{Math.min(index + 1, queue.length)} / {queue.length}</span>
        <div className="order-last w-full md:order-none md:w-auto md:ml-auto flex items-center gap-4">
          <Toggle label="Play songs" on={settings.autoplay} onChange={(v) => updateSettings({ autoplay: v })} />
          <Toggle label="Next after sorting" on={settings.advance} onChange={(v) => updateSettings({ advance: v })} />
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="ml-auto md:ml-0 p-2 -mr-2 text-neutral-400 hover:text-white"><X className="w-5 h-5" /></button>
      </div>

      {done ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center">
          <Check className="w-12 h-12 text-[var(--brand-mid)]" />
          <p className="text-xl font-bold">That's the pile</p>
          <p className="text-sm text-neutral-400">Everything has been filed or skipped. Skipped songs are still in Unadded Songs.</p>
          <div className="flex gap-3">
            {lastAction && <button type="button" onClick={undo} className="rounded-full border border-white/15 px-4 py-2 text-sm font-semibold">Undo last</button>}
            <button type="button" onClick={onClose} className="rounded-full bg-white text-black px-5 py-2 text-sm font-bold">Done</button>
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col md:flex-row gap-4 p-4 overflow-hidden">
          {/* The card */}
          <div className="md:w-[22rem] shrink-0 flex flex-col items-center gap-3">
            <div
              ref={cardRef}
              data-sort-card=""
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              style={cardStyle}
              className={`w-full max-w-[22rem] rounded-3xl border border-white/10 bg-neutral-900 shadow-2xl p-4 flex md:flex-col items-center md:items-stretch gap-4 cursor-grab active:cursor-grabbing ${drag ? 'z-20 shadow-brand-glow' : ''}`}
            >
              <div className="w-24 h-24 md:w-full md:aspect-square md:h-auto rounded-2xl overflow-hidden bg-neutral-800 shrink-0 pointer-events-none">
                {track.album?.images?.[0]?.url && <img src={artUrl(track.album.images, 320)} alt="" className="w-full h-full object-cover" draggable="false" />}
              </div>
              <div className="min-w-0 flex-1 pointer-events-none">
                <p className="font-bold text-lg leading-tight line-clamp-2">{track.name}</p>
                <p className="text-sm text-neutral-400 truncate">{track.artists?.map((a) => a.name).join(', ')}</p>
                {placedHere.length > 0 && (
                  <p className="text-xs text-[var(--brand-mid)] mt-1 truncate">In {placedHere.map((id) => targets.find((t) => t.id === id)?.name).filter(Boolean).join(', ')}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  if (isThisPlaying) togglePlay();
                  else playOn((deviceId) => playSingleTrack(token, deviceId, track.uri));
                }}
                aria-label={isThisPlaying && !isCurrentTrackPaused ? 'Pause' : 'Play'}
                className="w-12 h-12 rounded-full bg-brand-gradient flex items-center justify-center shrink-0 md:self-center"
              >
                {isThisPlaying && !isCurrentTrackPaused ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
              </button>
            </div>
            <p className="text-[11px] text-neutral-500 text-center hidden md:block">Drag the card onto a playlist, or tap one. Swipe sideways to skip.</p>
            <div className="flex items-center gap-2">
              <button type="button" onClick={undo} disabled={!lastAction || busy} className="flex items-center gap-1.5 rounded-full border border-white/15 px-4 h-10 text-sm font-semibold disabled:opacity-40">
                <Undo2 className="w-4 h-4" /> Undo
              </button>
              <button type="button" onClick={advance} disabled={busy} className="flex items-center gap-1.5 rounded-full border border-white/15 px-4 h-10 text-sm font-semibold disabled:opacity-40">
                Skip <SkipForward className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* The targets */}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain -mx-1 px-1">
            {suggestions.length > 0 && (
              <>
                <p className="text-[11px] font-bold uppercase tracking-wider text-neutral-500 mb-2">Suggested</p>
                <div className="grid grid-cols-3 gap-2 md:gap-3 mb-4">
                  {suggestions.map((s) => tile(targets.find((t) => t.id === s.id) || s, true))}
                </div>
              </>
            )}
            {others.length > 0 && (
              <>
                <p className="text-[11px] font-bold uppercase tracking-wider text-neutral-500 mb-2">{suggestions.length ? 'Everything else' : 'Your playlists'}</p>
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
