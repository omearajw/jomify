import { useState } from 'react';
import { useUserStore } from '../store/userStore';
import { useSlice } from '../store/selectors';
import { artUrl } from '../utils/images';
import { TRACK_DRAG_TYPE } from '../utils/spotifyUri';
import { tagCache } from '../services/tags';
import { MOOD_WORDS } from '../utils/playlistSuggestions';
import { useUnaddedStore, cardOf, waitingCount, fileInto, takeOut, undo, skip, retrySuggestions, blocked, blockedWhy } from './unadded';

// The Unadded mode's open thing (DESIGN.md §8): the targets. The playing song is the card, so
// it is already in the room's column on the right; here is where it can go: the check playlists
// as covers, the two the suggestions rank highest for it large, the rest small. Drag the cover
// out of the column (or a row from the pile) onto a target, or click the target; a second one
// may be clicked before moving on; a target it is in, clicked again, takes it back out. Under
// the targets, the song that just left stays for ten seconds, so a late decision needs no
// Back. Skip is the column's Next, or the word here.

const Mono = ({ children, className = '' }) => <p className={`room-mono ${className}`}>{children}</p>;
const Word = ({ onClick, children, lit, disabled, tip }) => <button type="button" data-tip={tip} onClick={onClick} disabled={disabled} aria-pressed={lit || undefined} className="ui-word">{children}</button>;

const uriFrom = (e) => e.dataTransfer.getData(TRACK_DRAG_TYPE) || (e.dataTransfer.getData('text/plain') || '').trim();

export default function RoomUnadded() {
  const st = useSlice(useUnaddedStore, ['pileId', 'pile', 'loading', 'cardUri', 'placed', 'lastAction', 'ghost', 'busy', 'suggestionsByTrack', 'targets', 'suggestionStatus']);
  const skips = useUserStore((s) => s.sortSkips);
  const settings = useUserStore((s) => s.sortModeSettings);
  const setSettings = useUserStore((s) => s.setSortModeSettings);
  const card = cardOf(st);
  const track = card?.track || null;
  const waiting = waitingCount(st);
  const [over, setOver] = useState(null);
  void skips;

  const suggestions = track ? (st.suggestionsByTrack.get(track.id) || []) : [];
  const suggestedIds = suggestions.slice(0, 2).map((s) => s.id);
  const large = suggestedIds.map((id) => st.targets.find((t) => t.id === id)).filter(Boolean);
  const small = st.targets.filter((t) => !suggestedIds.includes(t.id));
  const placedHere = track ? (st.placed[track.uri] || []) : [];
  const songTags = track ? (tagCache.get(track.id) || []).slice(0, 6).sort((a, b) => Number(MOOD_WORDS.has(b.name)) - Number(MOOD_WORDS.has(a.name))) : [];

  const drop = (e, playlistId) => {
    e.preventDefault(); setOver(null);
    const uri = uriFrom(e);
    if (uri) fileInto(uri, playlistId);
  };
  const tile = (t, size) => {
    const placed = placedHere.includes(t.id);
    const why = suggestions.find((s) => s.id === t.id)?.reason;
    return (
      <button
        key={t.id}
        type="button"
        data-sort-target={t.id}
        disabled={st.busy || !track}
        onClick={() => (placed ? takeOut(track.uri, t.id) : fileInto(track.uri, t.id))}
        onDragOver={(e) => { if (Array.from(e.dataTransfer.types).some((x) => x === TRACK_DRAG_TYPE || x === 'text/plain')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; if (over !== t.id) setOver(t.id); } }}
        onDragLeave={() => setOver((o) => (o === t.id ? null : o))}
        onDrop={(e) => drop(e, t.id)}
        aria-pressed={placed || undefined}
        className={`group flex flex-col items-start text-left transition-opacity disabled:opacity-40 ${over === t.id ? 'opacity-100' : ''}`}
        style={{ width: size }}
      >
        <span className={`block aspect-square w-full overflow-hidden rounded-[5px] bg-white/5 transition-[box-shadow,transform] ${over === t.id ? 'scale-[1.03] shadow-[0_0_0_2px_var(--room-paper)]' : placed ? 'shadow-[0_0_0_1px_var(--room-paper)]' : ''}`} style={{ transitionDuration: 'var(--room-mid)' }}>
          {t.images?.[0]?.url && <img src={artUrl(t.images, size)} alt="" draggable="false" className="h-full w-full object-cover" />}
        </span>
        <span className={`mt-2 block w-full truncate text-[13px] font-medium ${placed ? 'text-[var(--room-paper)]' : 'text-[var(--room-paper)]/85'}`}>{t.name}</span>
        {placed
          ? <span className="block text-[11.5px] leading-[1.3] text-[var(--room-dim)]"><span className="group-hover:hidden">Added</span><span className="hidden group-hover:inline">Take out</span></span>
          : why ? <span className="line-clamp-2 block w-full text-[11.5px] leading-[1.3] text-[var(--room-faint)]">{why}</span> : null}
      </button>
    );
  };

  const ghost = st.ghost;
  const ghostIn = ghost ? (st.placed[ghost.item.track.uri] || []) : [];

  return (
    <div className="relative pb-6" style={{ fontFamily: 'var(--font-room)' }}>
      <Mono className="text-[var(--room-faint)]">Unadded · {st.loading && !st.pile.length ? 'loading the pile' : `${waiting} waiting`}{st.targets.length ? ` · ${st.targets.length} targets` : ''}</Mono>
      {track ? (
        <>
          <h1 className="mt-2 truncate text-[30px] font-semibold leading-[1.05] tracking-[-0.025em] text-[var(--room-paper)]">{track.name}</h1>
          <Mono className="mt-2 text-[var(--room-dim)]">{(track.artists || []).map((a) => a.name).join(', ')}{track.album?.name ? ` · ${track.album.name}` : ''}</Mono>
          {blocked(track) && <p className="mt-2 text-[12.5px] text-[var(--room-dim)]">{blockedWhy(track)}, so it won't play. You can still file it.</p>}
          {songTags.length > 0 && <p className="mt-2 text-[12px] text-[var(--room-faint)]">{songTags.map((t, i) => <span key={t.name} className={MOOD_WORDS.has(t.name) ? 'text-[var(--room-dim)]' : ''}>{i ? ' · ' : ''}{t.name}</span>)}</p>}
        </>
      ) : (
        <h1 className="mt-2 text-[30px] font-semibold leading-[1.05] tracking-[-0.025em] text-[var(--room-paper)]">{st.loading ? 'Loading' : st.pile.length ? 'Every song is dealt with' : 'Nothing in the pile'}</h1>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
        <Word onClick={skip} disabled={!track || st.busy} tip="Leave this song in the pile and move on; it is remembered as skipped">{placedHere.length ? 'Next' : 'Skip'}</Word>
        <Word onClick={undo} disabled={!st.lastAction || st.busy} tip="Take the last filing back out of its playlist">Undo</Word>
        <Word onClick={() => setSettings({ advance: !settings.advance })} lit={settings.advance} tip="On: filing a song plays the next one. Off: it stays, so it can go in a second playlist">Move on after filing</Word>
      </div>

      {st.targets.length === 0 && <p className="mt-8 text-[13px] text-[var(--room-dim)]">No targets yet: choose the check playlists in the pile's head.</p>}
      {track && st.targets.length > 0 && large.length === 0 && (
        <p className="mt-8 flex items-center gap-4 text-[12px] text-[var(--room-faint)]">
          {st.suggestionStatus === 'loading' ? 'Working out which would suit…' : st.suggestionStatus === 'error' ? <>Couldn't work out which would suit. <Word onClick={retrySuggestions}>Try again</Word></> : 'Nothing stands out for this one.'}
        </p>
      )}
      {large.length > 0 && (
        <>
          <Mono className="mt-9 border-b border-[var(--room-hair)] pb-2 text-[var(--room-faint)]">Where it would suit</Mono>
          <div className="mt-4 flex flex-wrap gap-6">{large.map((t) => tile(t, 168))}</div>
        </>
      )}
      {small.length > 0 && (
        <>
          <Mono className="mt-9 border-b border-[var(--room-hair)] pb-2 text-[var(--room-faint)]">{large.length ? 'Or' : 'The targets'}</Mono>
          <div className="mt-4 flex flex-wrap gap-5">{small.map((t) => tile(t, 104))}</div>
        </>
      )}

      {ghost && (
        <div
          className="mt-10 flex items-center gap-3 border-t border-[var(--room-hair)] pt-4 text-[13px]"
          draggable
          onDragStart={(e) => { e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData(TRACK_DRAG_TYPE, ghost.item.track.uri); e.dataTransfer.setData('text/plain', ghost.item.track.uri); }}
        >
          <Mono className="shrink-0 text-[var(--room-faint)]">Last ⟵</Mono>
          <span className="h-[32px] w-[32px] shrink-0 overflow-hidden rounded-[3px] bg-white/5">{ghost.item.track.album?.images?.[0]?.url && <img src={artUrl(ghost.item.track.album.images, 32)} alt="" draggable="false" className="h-full w-full object-cover" />}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-[var(--room-paper)]/90">{ghost.item.track.name}</span>
            <span className="block truncate text-[11.5px] text-[var(--room-faint)]">{ghostIn.length ? `In ${ghostIn.map((id) => st.targets.find((t) => t.id === id)?.name || 'a playlist').join(', ')}` : 'Not filed'}. Drag it onto a target, or:</span>
          </span>
          <span className="flex shrink-0 flex-wrap items-center gap-4" onClick={(e) => e.stopPropagation()}>
            {(st.suggestionsByTrack.get(ghost.item.track.id) || []).slice(0, 2).filter((s) => !ghostIn.includes(s.id)).map((s) => <Word key={s.id} disabled={st.busy} onClick={() => fileInto(ghost.item.track.uri, s.id)}>→ {s.name}</Word>)}
            <Mono className="text-[var(--room-faint)]">{ghost.left}s</Mono>
          </span>
        </div>
      )}
    </div>
  );
}
