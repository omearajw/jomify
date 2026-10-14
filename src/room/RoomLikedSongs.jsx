import { Play, Shuffle, Heart } from 'lucide-react';
import { useLikedSongsView, SORTS } from '../views/Library/useLikedSongsView';
import SelectionBar from '../components/SelectionBar';
import LikeButton from '../components/LikeButton';
import { formatTime } from '../utils/formatTime';
import { artUrl } from '../utils/images';
import { rowButtonProps } from '../utils/a11y';
import { isSameTrack, isUnplayable, TRACK_DRAG_TYPE } from '../utils/spotifyUri';
import { TRACKS_DRAG_TYPE } from './LibraryTree';

// Liked Songs on the room's language: the same head and rows as the open playlist
// (RoomPlaylist.jsx), on the Liked Songs hook. The one list that is not a playlist.

const Mono = ({ children, className = '' }) => <span className={`room-mono ${className}`}>{children}</span>;
const Word = ({ onClick, lit, children }) => (
  <button type="button" onClick={onClick} aria-pressed={lit || undefined} className={`room-mono whitespace-nowrap transition-colors ${lit ? 'text-[var(--room-paper)]' : 'text-[var(--room-dim)] hover:text-[var(--room-paper)]'}`} style={{ transitionDuration: 'var(--room-mid)' }}>{children}</button>
);

export default function RoomLikedSongs() {
  const {
    trackData, data, loadError, setReloadNonce, loadRestOfTracks, isFetchingMore, isShuffled, handleShufflePlay, handleTrackSelect,
    sortMode, setSortMode, find, setFind, needle, items, visibleCount, sentinelRef, totalRows, nextPageUrl,
    currentTrack, isCurrentTrackPaused, country, selection, selectedTracks, unlikeSelected, openRowMenu, navigateToAlbum, formatDateAdded
  } = useLikedSongsView();

  const facts = !trackData ? 'Loading' : data.items.length < data.total ? `${data.items.length.toLocaleString()} of ${data.total.toLocaleString()} songs loaded` : `${data.total.toLocaleString()} songs`;

  return (
    <div className="relative pb-10" style={{ fontFamily: 'var(--font-room)' }}>
      <header className="relative flex items-end gap-7 pt-4">
        <div className="grid h-[168px] w-[168px] shrink-0 place-items-center rounded-[5px] bg-[var(--room-paper)]/[0.07] shadow-[0_40px_80px_-30px_rgba(0,0,0,0.8)]">
          <Heart className="h-12 w-12 fill-[var(--room-paper)] text-[var(--room-paper)] opacity-80" />
        </div>
        <div className="min-w-0 flex-1 pb-1">
          <Mono className="text-[var(--room-faint)]">Your songs · {facts}</Mono>
          <h1 className="mt-2 text-[34px] font-semibold leading-[1.05] tracking-[-0.025em] text-[var(--room-paper)]">Liked Songs</h1>
          {loadError && <p className="room-mono mt-2 flex items-center gap-3 text-amber-300/80">{loadError}<Word onClick={() => { if (!trackData) setReloadNonce((n) => n + 1); else if (data.next && !isFetchingMore.current) loadRestOfTracks(data.next); }}>Try again</Word></p>}
          <div className="mt-5 flex items-center gap-5">
            <button type="button" onClick={() => (isShuffled ? handleShufflePlay() : handleTrackSelect(0))} aria-label="Play Liked Songs" className="grid h-[46px] w-[46px] place-items-center rounded-full bg-[var(--room-paper)] text-[#0a0810] transition-transform hover:scale-105 active:scale-95"><Play className="ml-0.5 h-[18px] w-[18px] fill-current" /></button>
            <button type="button" onClick={handleShufflePlay} aria-label="Shuffle play" title="Shuffle play" className={`transition-colors ${isShuffled ? 'text-[var(--room-paper)]' : 'text-[var(--room-faint)] hover:text-[var(--room-dim)]'}`}><Shuffle className="h-[18px] w-[18px]" /></button>
          </div>
        </div>
      </header>

      <div className="mt-8 flex items-center gap-6 border-b border-[var(--room-hair)] pb-3">
        <input type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find in Liked Songs" aria-label="Find in Liked Songs" className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--room-paper)] outline-none placeholder:text-[var(--room-faint)] [&::-webkit-search-cancel-button]:hidden" />
        {needle && <Mono className="text-[var(--room-faint)]">{items.length} match{items.length === 1 ? '' : 'es'}{trackData?.next ? ' so far' : ''}</Mono>}
        <span className="ml-auto flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
          {SORTS.map((s) => <Word key={s.id} lit={sortMode === s.id} onClick={() => setSortMode(s.id)}>{s.label}</Word>)}
        </span>
      </div>

      <div className="mt-1">
        {!trackData && !loadError && <p className="room-mono py-6 text-[var(--room-faint)]">Loading the songs</p>}
        {trackData && data.items.length === 0 && <p className="py-14 text-[13px] text-[var(--room-dim)]">Songs you like will appear here. Tap the heart on any song.</p>}
        {data.items.slice(0, visibleCount).map((item, index) => {
          const track = item.track;
          if (!track) return null;
          const current = isSameTrack(track, currentTrack);
          const unplayable = isUnplayable(track, country);
          const selected = selection.has(track.uri);
          return (
            <div
              key={`${track.id}-${index}`}
              onClick={(e) => (selection.wantsSelect(e) && track.uri ? selection.toggle(track.uri, { range: e.shiftKey }) : handleTrackSelect(index))}
              {...rowButtonProps(() => handleTrackSelect(index))}
              onContextMenu={(e) => { e.preventDefault(); openRowMenu(e, track); }}
              aria-disabled={unplayable || undefined}
              aria-selected={selection.active ? selected : undefined}
              title={unplayable ? 'Not available on Spotify' : undefined}
              draggable
              onDragStart={(e) => { e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData(TRACK_DRAG_TYPE, track.uri); e.dataTransfer.setData('text/plain', track.uri); if (selected && selectedTracks.length > 1) e.dataTransfer.setData(TRACKS_DRAG_TYPE, JSON.stringify(selectedTracks.map((t) => t.uri))); }}
              className={`group grid cursor-pointer grid-cols-[28px_34px_minmax(0,1.3fr)_minmax(0,1fr)_92px_24px_44px] items-center gap-3 py-[9px] text-[13px] transition-colors [content-visibility:auto] [contain-intrinsic-size:auto_54px] ${unplayable ? 'opacity-40' : ''} ${selected ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'}`}
              style={{ borderTop: '1px solid var(--room-hair)', transitionDuration: 'var(--room-mid)' }}
            >
              <span className="room-mono flex items-center justify-center text-[var(--room-faint)]">
                {current && !isCurrentTrackPaused ? <span className="h-1.5 w-1.5 rounded-full bg-[var(--room-paper)] animate-pulse" aria-label="Playing" />
                  : <><span className="group-hover:hidden">{index + 1}</span><Play className="hidden h-3 w-3 fill-current text-[var(--room-paper)] group-hover:block" /></>}
              </span>
              <span className="h-[34px] w-[34px] overflow-hidden rounded-[3px] bg-white/5">{track.album?.images?.[0]?.url && <img src={artUrl(track.album.images, 34)} alt="" width="34" height="34" loading="lazy" decoding="async" draggable="false" className="h-full w-full object-cover" />}</span>
              <span className="min-w-0 pr-3">
                <span className={`block truncate ${current ? 'font-semibold text-[var(--room-paper)]' : 'font-medium text-[var(--room-paper)]/90'}`}>{track.name}</span>
                <span className="block truncate text-[11.5px] text-[var(--room-dim)]">{track.artists.map((a) => a.name).join(', ')}</span>
              </span>
              <span className="min-w-0 truncate pr-3 text-[var(--room-dim)]">
                {track.album?.id ? <button type="button" onClick={(e) => { e.stopPropagation(); navigateToAlbum(track.album.id); }} className="block w-full truncate text-left hover:text-[var(--room-paper)]">{track.album.name}</button> : track.album?.name}
              </span>
              <Mono className="truncate text-[var(--room-faint)]">{formatDateAdded(item.added_at)}</Mono>
              <span className="flex items-center justify-center [&_svg]:h-4 [&_svg]:w-4 room-like"><LikeButton trackId={track.id} /></span>
              <Mono className="text-right text-[var(--room-faint)]">{formatTime(track.duration_ms)}</Mono>
            </div>
          );
        })}
        {(visibleCount < totalRows || nextPageUrl) && <p ref={sentinelRef} className="room-mono py-5 text-center text-[var(--room-faint)]">{Math.max(0, (data.total || totalRows) - Math.min(visibleCount, totalRows))} more</p>}
      </div>
      <SelectionBar count={selection.count} tracks={selectedTracks} onClear={selection.clear} onRemove={unlikeSelected} removeLabel="Remove from Liked" />
    </div>
  );
}
