import { useRef, useState } from 'react';
import { Play, Pause, SkipBack, SkipForward } from 'lucide-react';
import { useUserStore } from '../../store/userStore';
import { useSlice, usePlaybackSummary } from '../../store/selectors';
import { togglePlay, next, previous } from '../../services/spotify/playbackController';
import { artUrl } from '../../utils/images';
import { isSameTrack } from '../../utils/spotifyUri';
import { tagCache } from '../../services/tags';
import { MOOD_WORDS } from '../../utils/playlistSuggestions';
import ConfirmDialog from '../../components/ConfirmDialog';
import CheckPlaylistsDialog from '../CheckPlaylistsDialog';
import Artists from '../Artists';
import { Progress } from './PhoneNowPlaying';
import { useUnaddedStore, cardOf, isDecided, waitingCount, fileInto, takeOut, undo, skip, playFrom, findSongs, applyPlan, dismissPlan, retrySuggestions, blocked, blockedWhy } from '../unadded';

// Unadded on the phone (Jack, 16 Oct): one screen built round the song being sorted, instead of
// the sheet, where the pile was at half, the playlists at full and the controls behind both.
// Top: the song and its controls, held in place. Then where it can go: the two suggested as large
// tiles with the reason, the rest small; a tap files it there, a second tap on another files it
// there too, a tap on one it is in takes it back out. Skip and Undo large. Last of all the pile
// as a strip of covers, to see what is coming and tap one to sort it now. A swipe left on the
// song skips it. The sheet's launcher stays under it all, as the way out.

const SWIPE_PX = 90;
const Mono = ({ children, className = '' }) => <p className={`room-mono ${className}`}>{children}</p>;

export default function PhoneUnadded({ bottomInset }) {
  const st = useSlice(useUnaddedStore, ['pileId', 'pile', 'total', 'loading', 'loadError', 'cardUri', 'placed', 'lastAction', 'ghost', 'busy', 'suggestionsByTrack', 'targets', 'suggestionStatus', 'checking', 'checkStatus', 'plan']);
  const checkIds = useUserStore((s) => s.unaddedCheckPlaylists);
  const skips = useUserStore((s) => s.sortSkips);
  const settings = useUserStore((s) => s.sortModeSettings);
  const setSettings = useUserStore((s) => s.setSortModeSettings);
  const { currentPlayingTrack, isCurrentTrackPaused } = usePlaybackSummary();
  const [picking, setPicking] = useState(false);
  const card = cardOf(st);
  const track = card?.track || null;
  const waiting = waitingCount(st);
  const playingCard = Boolean(track && isSameTrack(track, currentPlayingTrack));
  const skipped = new Set(skips[st.pileId] || []);

  const suggestions = track ? (st.suggestionsByTrack.get(track.id) || []) : [];
  const suggestedIds = suggestions.slice(0, 2).map((s) => s.id);
  const large = suggestedIds.map((id) => st.targets.find((t) => t.id === id)).filter(Boolean);
  const small = st.targets.filter((t) => !suggestedIds.includes(t.id));
  const placedHere = track ? (st.placed[track.uri] || []) : [];
  const tags = track ? (tagCache.get(track.id) || []).slice(0, 5).sort((a, b) => Number(MOOD_WORDS.has(b.name)) - Number(MOOD_WORDS.has(a.name))) : [];
  const upcoming = st.pile.filter((i) => i?.track?.uri && i.track.uri !== track?.uri && !isDecided(i.track.uri, st, skipped)).slice(0, 30);

  // the swipe: the song follows the finger sideways; far enough left on release, it is skipped
  const [dx, setDx] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [sliding, setSliding] = useState(false);
  const swipe = useRef(null);
  const onDown = (e) => { if (e.target.closest('button, input, a')) return; swipe.current = { x: e.clientX, y: e.clientY, id: e.pointerId, along: null }; };
  const onMove = (e) => {
    const s = swipe.current;
    if (!s) return;
    const mx = e.clientX - s.x, my = e.clientY - s.y;
    if (s.along === null && Math.hypot(mx, my) > 10) s.along = Math.abs(mx) > Math.abs(my) * 1.3;
    if (s.along) { try { e.currentTarget.setPointerCapture(s.id); } catch { /* fine */ } setSliding(true); setDx(Math.min(40, mx)); }
  };
  const onUp = () => {
    const s = swipe.current;
    swipe.current = null;
    setSliding(false);
    if (!s?.along) { setDx(0); return; }
    if (dx < -SWIPE_PX && track && !st.busy) { setLeaving(true); setTimeout(() => { skip(); setLeaving(false); setDx(0); }, 220); } else setDx(0);
  };

  const tile = (t, big) => {
    const placed = placedHere.includes(t.id);
    const why = suggestions.find((s) => s.id === t.id)?.reason;
    return (
      <button key={t.id} type="button" data-sort-target={t.id} disabled={st.busy || !track} aria-pressed={placed || undefined}
        onClick={() => (placed ? takeOut(track.uri, t.id) : fileInto(track.uri, t.id))}
        className="flex min-w-0 flex-col items-start text-left disabled:opacity-40">
        <span className={`block aspect-square w-full overflow-hidden rounded-[5px] bg-white/5 transition-shadow ${placed ? 'shadow-[0_0_0_2px_var(--room-paper)]' : ''}`}>
          {t.images?.[0]?.url && <img src={artUrl(t.images, big ? 200 : 120)} alt="" draggable="false" className="h-full w-full object-cover" />}
        </span>
        <span className={`mt-1.5 block w-full truncate font-medium ${big ? 'text-[14px]' : 'text-[12px]'} ${placed ? 'text-[var(--room-paper)]' : 'text-[var(--room-paper)]/85'}`}>{t.name}</span>
        {placed
          ? <span className="block text-[11.5px] text-[var(--room-dim)]">Added · tap to take out</span>
          : big && why ? <span className="line-clamp-2 block w-full text-[11.5px] leading-[1.3] text-[var(--room-faint)]">{why}</span> : null}
      </button>
    );
  };

  const ghost = st.ghost;
  const ghostIn = ghost ? (st.placed[ghost.item.track.uri] || []) : [];

  return (
    <div className="absolute inset-0 flex flex-col" style={{ background: 'var(--room-ink)', color: 'var(--room-paper)', fontFamily: 'var(--font-room)', paddingBottom: bottomInset }}>
      {/* the song and its controls: held at the top while the rest scrolls */}
      <div className="shrink-0 border-b border-[var(--room-hair)] px-5 pb-3 pt-[calc(env(safe-area-inset-top)+12px)]">
        <div className="flex items-center justify-between gap-3">
          <Mono className="text-[var(--room-faint)]">Unadded · {st.loading && !st.pile.length ? 'loading the pile' : `${waiting} waiting`}</Mono>
          <button type="button" onClick={() => setPicking(true)} className="ui-word min-h-[36px]">Check playlists · {checkIds.length}</button>
        </div>
        <div
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
          className="mt-2 flex touch-pan-y select-none items-center gap-4"
          style={{ transform: `translateX(${leaving ? -420 : dx}px)`, opacity: leaving ? 0 : 1 - Math.min(0.6, Math.abs(dx) / 300), transition: sliding ? 'none' : 'transform 220ms ease-out, opacity 220ms ease-out' }}
        >
          <span className="h-[88px] w-[88px] shrink-0 overflow-hidden rounded-[5px] bg-white/5">{track?.album?.images?.[0]?.url && <img src={artUrl(track.album.images, 88)} alt="" draggable="false" className="h-full w-full object-cover" />}</span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[21px] font-semibold leading-tight tracking-[-0.02em]">{track?.name || (st.loading ? 'Loading' : st.pile.length ? 'Every song is dealt with' : 'Nothing in the pile')}</h1>
            {track && <Artists artists={track.artists} className="room-mono mt-1 block truncate text-[var(--room-dim)]" />}
            {track && blocked(track) && <p className="mt-1 text-[12px] text-[var(--room-dim)]">{blockedWhy(track)}; it can still be filed</p>}
            {tags.length > 0 && <p className="mt-1 truncate text-[11.5px] text-[var(--room-faint)]">{tags.map((t) => t.name).join(' · ')}</p>}
          </div>
        </div>
        {dx < -30 && <p className="room-mono -mt-1 text-right text-[var(--room-faint)]">{dx < -SWIPE_PX ? 'Let go to skip' : 'Swipe to skip'}</p>}
        <div className="mt-2"><Progress /></div>
        <div className="flex items-center justify-center gap-9" data-control>
          <button type="button" onClick={previous} aria-label="Previous" className="grid h-11 w-11 place-items-center text-[var(--room-dim)]"><SkipBack className="h-6 w-6" /></button>
          <button type="button" onClick={() => (playingCard ? togglePlay() : track && playFrom(track.uri))} disabled={!track || blocked(track)} aria-label={playingCard && !isCurrentTrackPaused ? 'Pause' : 'Play'}
            className="grid h-14 w-14 place-items-center rounded-full bg-[var(--room-paper)] text-[#0a0810] active:scale-95 disabled:opacity-40">
            {playingCard && !isCurrentTrackPaused ? <Pause className="h-6 w-6 fill-current" /> : <Play className="ml-0.5 h-6 w-6 fill-current" />}
          </button>
          <button type="button" onClick={next} aria-label="Next" className="grid h-11 w-11 place-items-center text-[var(--room-dim)]"><SkipForward className="h-6 w-6" /></button>
        </div>
      </div>

      {/* where it can go, the decisions, and the pile */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-5 pb-6 pt-4">
        {checkIds.length === 0 && <p className="text-[13px] text-[var(--room-dim)]">Choose the playlists that count as added first; they are where songs can go.</p>}
        {track && st.targets.length > 0 && large.length === 0 && (
          <p className="text-[12.5px] text-[var(--room-faint)]">
            {st.suggestionStatus === 'loading' ? 'Working out which would suit…' : st.suggestionStatus === 'error' ? <>Couldn't work out which would suit. <button type="button" onClick={retrySuggestions} className="ui-word">Try again</button></> : 'Nothing stands out for this one.'}
          </p>
        )}
        {large.length > 0 && (
          <>
            <Mono className="text-[var(--room-faint)]">Where it would suit</Mono>
            <div className="mt-3 grid grid-cols-2 gap-4">{large.map((t) => tile(t, true))}</div>
          </>
        )}
        {small.length > 0 && (
          <>
            <Mono className="mt-6 text-[var(--room-faint)]">{large.length ? 'Or' : 'Where it can go'}</Mono>
            <div className="mt-3 grid grid-cols-3 gap-3">{small.map((t) => tile(t, false))}</div>
          </>
        )}

        <div className="mt-6 grid grid-cols-2 gap-3">
          <button type="button" onClick={skip} disabled={!track || st.busy} className="min-h-[48px] rounded-[6px] text-[15px] font-semibold disabled:opacity-40" style={{ background: 'rgba(241,239,233,0.1)' }}>{placedHere.length ? 'Next song' : 'Skip'}</button>
          <button type="button" onClick={undo} disabled={!st.lastAction || st.busy} className="min-h-[48px] rounded-[6px] text-[15px] font-semibold disabled:opacity-40" style={{ background: 'rgba(241,239,233,0.06)' }}>Undo</button>
        </div>
        <p className="mt-3 flex items-center justify-between gap-3">
          <span className="text-[12.5px] text-[var(--room-faint)]">Swipe the song left to skip it.</span>
          <button type="button" onClick={() => setSettings({ advance: !settings.advance })} aria-pressed={settings.advance || undefined} className="ui-word shrink-0">Move on after filing</button>
        </p>

        {ghost && (
          <div className="mt-6 border-t border-[var(--room-hair)] pt-3">
            <Mono className="text-[var(--room-faint)]">Last · {ghost.left}s</Mono>
            <p className="mt-1 truncate text-[14px] font-medium">{ghost.item.track.name}</p>
            <p className="text-[12px] text-[var(--room-faint)]">{ghostIn.length ? `In ${ghostIn.map((id) => st.targets.find((t) => t.id === id)?.name || 'a playlist').join(', ')}` : 'Not filed'}</p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 [&>button]:max-w-full [&>button]:truncate">
              {(st.suggestionsByTrack.get(ghost.item.track.id) || []).slice(0, 2).filter((s) => !ghostIn.includes(s.id)).map((s) => <button key={s.id} type="button" disabled={st.busy} onClick={() => fileInto(ghost.item.track.uri, s.id)} className="ui-word">→ {s.name}</button>)}
            </div>
          </div>
        )}

        <div className="mt-8 border-t border-[var(--room-hair)] pt-3">
          <div className="flex items-center justify-between">
            <Mono className="text-[var(--room-faint)]">Coming up in the pile</Mono>
            <button type="button" onClick={findSongs} disabled={st.checking || !st.pileId} className="ui-word">{st.checking ? 'Checking' : 'Find songs'}</button>
          </div>
          {st.checkStatus && <Mono className="mt-1 text-[var(--room-faint)]">{st.checkStatus}</Mono>}
          {st.loadError && <p className="mt-2 text-[13px] text-[var(--room-dim)]">{st.loadError}</p>}
          <div className="-mx-5 mt-3 flex gap-3 overflow-x-auto px-5 pb-2 [scrollbar-width:none]">
            {upcoming.length === 0 && <p className="text-[13px] text-[var(--room-faint)]">{st.loading ? 'Loading' : 'Nothing else waiting.'}</p>}
            {upcoming.map((i) => (
              <button key={i.track.uri} type="button" onClick={() => playFrom(i.track.uri)} className={`w-[84px] shrink-0 text-left ${blocked(i.track) ? 'opacity-45' : ''}`} aria-label={`Sort ${i.track.name} now`}>
                <span className="block aspect-square w-full overflow-hidden rounded-[4px] bg-white/5">{i.track.album?.images?.[0]?.url && <img src={artUrl(i.track.album.images, 84)} alt="" loading="lazy" draggable="false" className="h-full w-full object-cover" />}</span>
                <span className="mt-1 block truncate text-[11.5px] font-medium text-[var(--room-paper)]/85">{i.track.name}</span>
                <span className="block truncate text-[10.5px] text-[var(--room-faint)]">{(i.track.artists || []).map((a) => a.name).join(', ')}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <CheckPlaylistsDialog open={picking} onClose={() => setPicking(false)} />
      <ConfirmDialog open={Boolean(st.plan)} tone="neutral" title="Apply these changes?" confirmLabel="Apply" cancelLabel="Keep as is" onConfirm={applyPlan} onCancel={dismissPlan}
        message={st.plan ? [st.plan.remove.length ? `Take ${st.plan.remove.length} song${st.plan.remove.length === 1 ? '' : 's'} out` : null, st.plan.add.length ? `add ${st.plan.add.length} liked song${st.plan.add.length === 1 ? '' : 's'}` : null].filter(Boolean).join(', ') + '.' : ''} />
    </div>
  );
}
