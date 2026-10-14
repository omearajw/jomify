import { useState } from 'react';
import { useUserStore } from '../store/userStore';
import { useSlice, usePlaybackSummary } from '../store/selectors';
import { artUrl } from '../utils/images';
import { isSameTrack, TRACK_DRAG_TYPE } from '../utils/spotifyUri';
import ConfirmDialog from '../components/ConfirmDialog';
import CheckPlaylistsDialog from './CheckPlaylistsDialog';
import { useUnaddedStore, cardOf, isDecided, waitingCount, playFrom, fileInto, findSongs, applyPlan, dismissPlan, retrySuggestions } from './unadded';

// The Unadded layer's list (DESIGN.md §8): the pile, in its own order, each song with the two
// playlists the suggestions rank highest as words, for a quick filing without playing it. A row
// plays that song (and the pile goes on from there), so the card moves to it. "Find songs" runs
// the check and shows what it would change before touching anything; "Check playlists" picks
// which playlists count as added and are offered as targets.

const Mono = ({ children, className = '' }) => <span className={`room-mono ${className}`}>{children}</span>;
const Word = ({ onClick, children, lit, disabled }) => <button type="button" onClick={onClick} disabled={disabled} aria-pressed={lit || undefined} className="ui-word">{children}</button>;

export default function UnaddedColumn({ onExpand }) {
  const st = useSlice(useUnaddedStore, ['pileId', 'pile', 'total', 'loading', 'loadError', 'cardUri', 'placed', 'busy', 'suggestionsByTrack', 'targets', 'suggestionStatus', 'checking', 'checkStatus', 'plan', 'ghost']);
  const checkIds = useUserStore((s) => s.unaddedCheckPlaylists);
  const skips = useUserStore((s) => s.sortSkips);
  const { currentPlayingTrack, isCurrentTrackPaused } = usePlaybackSummary();
  const [picking, setPicking] = useState(false);
  const skipped = new Set(skips[st.pileId] || []);
  const card = cardOf(st);
  const waiting = waitingCount(st);
  const nameOf = (id) => st.targets.find((t) => t.id === id)?.name || 'a playlist';

  const row = (item) => {
    const track = item.track;
    const uri = track.uri;
    const isCard = card?.track?.uri === uri;
    const playing = isSameTrack(track, currentPlayingTrack) && !isCurrentTrackPaused;
    const inLists = st.placed[uri] || [];
    const decided = isDecided(uri, st, skipped);
    const picks = decided ? [] : (st.suggestionsByTrack.get(track.id) || []).slice(0, 2);
    return (
      <div
        key={uri}
        draggable={!decided}
        onDragStart={(e) => { e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData(TRACK_DRAG_TYPE, uri); e.dataTransfer.setData('text/plain', uri); }}
        onClick={() => { playFrom(uri); onExpand?.(); }}
        className={`group flex cursor-pointer items-start gap-3 py-[8px] text-[13px] transition-colors hover:bg-white/[0.03] ${decided && !isCard ? 'opacity-45' : ''} ${isCard ? 'bg-white/[0.05]' : ''}`}
        style={{ borderTop: '1px solid var(--room-hair)', transitionDuration: 'var(--room-mid)' }}
        aria-current={isCard ? 'true' : undefined}
      >
        <span className="mt-[9px] flex w-3 shrink-0 justify-center">{playing && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--room-paper)]" aria-label="Playing" />}</span>
        <span className="h-[32px] w-[32px] shrink-0 overflow-hidden rounded-[3px] bg-white/5">{track.album?.images?.[0]?.url && <img src={artUrl(track.album.images, 32)} alt="" width="32" height="32" loading="lazy" decoding="async" draggable="false" className="h-full w-full object-cover" />}</span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate font-medium ${isCard ? 'text-[var(--room-paper)]' : 'text-[var(--room-paper)]/90'}`}>{track.name}</span>
          <span className="block truncate text-[11.5px] text-[var(--room-dim)]">{(track.artists || []).map((a) => a.name).join(', ')}</span>
          {inLists.length > 0 && <Mono className="mt-1 block truncate text-[var(--room-faint)]">in {inLists.map(nameOf).join(', ')}</Mono>}
          {inLists.length === 0 && skipped.has(uri) && <Mono className="mt-1 block text-[var(--room-faint)]">skipped</Mono>}
          {picks.length > 0 && (
            <span className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1" onClick={(e) => e.stopPropagation()}>
              {picks.map((p) => <Word key={p.id} disabled={st.busy} onClick={() => fileInto(uri, p.id)}>→ {p.name}</Word>)}
            </span>
          )}
        </span>
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ fontFamily: 'var(--font-room)' }}>
      <p className="room-mono flex justify-between border-b border-[var(--room-hair)] pb-3 text-[var(--room-dim)]">
        <span>Unadded{st.pile.length ? ` · ${waiting} waiting` : ''}</span>
        <button type="button" onClick={() => onExpand?.()} className="ui-headword transition-colors hover:text-[var(--room-paper)]">The targets</button>
      </p>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-3">
        <Word onClick={findSongs} disabled={st.checking || !st.pileId}>{st.checking ? 'Checking' : 'Find songs'}</Word>
        <Word onClick={() => setPicking(true)} lit={picking}>Check playlists · {checkIds.length}</Word>
      </div>
      {st.checkStatus && <p className="room-mono pt-2 text-[var(--room-faint)]">{st.checkStatus}</p>}
      {checkIds.length === 0 && <p className="pt-3 text-[13px] text-[var(--room-faint)]">Choose the playlists that count as added first; they are the targets too.</p>}
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
        {!st.pileId && <p className="pt-2 text-[13px] text-[var(--room-dim)]">There is no pile yet. Make a playlist called "unadded songs" and Find songs fills it from your liked songs.</p>}
        {st.loadError && <p className="pt-2 text-[13px] text-[var(--room-dim)]">{st.loadError}</p>}
        {st.pileId && !st.loadError && st.pile.length === 0 && !st.loading && <p className="pt-2 text-[13px] text-[var(--room-faint)]">The pile is empty. Find songs looks through your liked songs for ones in none of the check playlists.</p>}
        {st.pile.map(row)}
        {st.loading && <p className="room-mono py-3 text-[var(--room-faint)]">Loading{st.total > st.pile.length ? ` · ${st.pile.length} of ${st.total}` : ''}</p>}
        {st.suggestionStatus === 'loading' && st.pile.length > 0 && <p className="py-3 text-[12px] text-[var(--room-faint)]">Working out where each would suit…</p>}
        {st.suggestionStatus === 'error' && <p className="flex items-center gap-4 py-3 text-[12px] text-[var(--room-faint)]">Couldn't work out where they would suit. <Word onClick={retrySuggestions}>Try again</Word></p>}
      </div>
      <CheckPlaylistsDialog open={picking} onClose={() => setPicking(false)} />
      <ConfirmDialog open={Boolean(st.plan)} tone="neutral" title="Apply these changes?" confirmLabel="Apply" cancelLabel="Keep as is" onConfirm={applyPlan} onCancel={dismissPlan}
        message={st.plan ? [st.plan.remove.length ? `Take ${st.plan.remove.length} song${st.plan.remove.length === 1 ? '' : 's'} out` : null, st.plan.add.length ? `add ${st.plan.add.length} liked song${st.plan.add.length === 1 ? '' : 's'}` : null].filter(Boolean).join(', ') + '.' : ''}>
        {st.plan && (
          <div className="space-y-4 text-[13px]">
            {st.plan.remove.length > 0 && <div><p className="room-mono mb-2 text-[var(--room-faint)]">Out</p><ul className="space-y-1">{st.plan.remove.slice(0, 40).map((t) => <li key={t.uri} className="flex justify-between gap-3 text-[var(--room-dim)]"><span className="truncate">{t.name} · {t.artist}</span><Mono className="shrink-0 text-[var(--room-faint)]">{t.reason}</Mono></li>)}{st.plan.remove.length > 40 && <li className="room-mono text-[var(--room-faint)]">and {st.plan.remove.length - 40} more</li>}</ul></div>}
            {st.plan.add.length > 0 && <div><p className="room-mono mb-2 text-[var(--room-faint)]">In</p><ul className="space-y-1">{st.plan.add.slice(0, 40).map((t) => <li key={t.uri} className="truncate text-[var(--room-dim)]">{t.name} · {t.artist}</li>)}{st.plan.add.length > 40 && <li className="room-mono text-[var(--room-faint)]">and {st.plan.add.length - 40} more</li>}</ul></div>}
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}
