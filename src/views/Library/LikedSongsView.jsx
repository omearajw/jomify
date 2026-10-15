import { formatTime } from '../../utils/formatTime';
import { artUrl } from '../../utils/images';
import { Clock3, Play, Heart, Shuffle, Search, ArrowUpDown } from 'lucide-react';
import LikeButton from '../../components/LikeButton';
import { rowButtonProps } from '../../utils/a11y';
import MoreButton from '../../components/MoreButton';
import { Skeleton, SkeletonRows } from '../../components/Skeleton';
import { isSameTrack, isUnplayable, unplayableWhy } from '../../utils/spotifyUri';
import SelectionBar from '../../components/SelectionBar';

import { useLikedSongsView, SORTS, GRID } from './useLikedSongsView';

export default function LikedSongsView() {
  const {
    navigateToAlbum, isShuffled, currentTrack, isCurrentTrackPaused, trackData, visibleCount, sentinelRef, isFetchingMore, loadError, setReloadNonce, country, sortMode, setSortMode, find, setFind, needle, items, selection, selectedTracks, unlikeSelected, openRowMenu, handleTrackSelect, handleShufflePlay, formatDateAdded, totalRows, nextPageUrl, data, loadRestOfTracks
  } = useLikedSongsView();

  return (
    <div className="flex flex-col pb-8">
      {/* Header */}
      <div className="flex flex-row items-center md:items-end gap-4 md:gap-6 mb-4 md:mb-6 mt-2 md:mt-4 select-none">
        <div className="w-24 h-24 md:w-48 md:h-48 shrink-0 bg-gradient-to-br from-indigo-700 to-blue-500 flex items-center justify-center shadow-2xl rounded">
          <Heart className="w-10 h-10 md:w-16 md:h-16 fill-white text-white" />
        </div>
        <div className="min-w-0">
          <p className="hidden md:block text-xs font-bold text-neutral-400 uppercase tracking-widest mb-2">Playlist</p>
          <h1 className="text-2xl md:text-5xl lg:text-7xl font-extrabold text-white tracking-tighter mb-1 md:mb-4">Liked Songs</h1>
          {!trackData && <Skeleton className="h-4 w-24 mt-1" />}
          {trackData && <p className="text-neutral-400 text-sm font-medium">
            {data.items.length < data.total
              ? `${data.items.length.toLocaleString()} of ${data.total.toLocaleString()} songs loaded`
              : `${data.total.toLocaleString()} songs`}
          </p>}
          {loadError && (
            <p className="text-red-400 text-xs font-medium mt-2 flex items-center gap-3">
              {loadError}
              <button
                type="button"
                onClick={() => { if (!trackData) setReloadNonce((n) => n + 1); else if (data.next && !isFetchingMore.current) loadRestOfTracks(data.next); }}
                className="underline hover:text-white transition-colors"
              >
                Try again
              </button>
            </p>
          )}
        </div>
      </div>

      {/* Action Bar (Play & Shuffle) */}
      <div className="flex items-center space-x-4 mb-4 md:mb-8 pl-1 md:pl-4">
        <button onClick={() => (isShuffled ? handleShufflePlay() : handleTrackSelect(0))} aria-label="Play Liked Songs" className="w-12 h-12 md:w-14 md:h-14 bg-brand-gradient text-white rounded-full flex items-center justify-center hover:scale-105 transition-transform shadow-xl">
          <Play className="w-6 h-6 fill-current ml-1" />
        </button>
        <button onClick={handleShufflePlay} aria-label="Shuffle play" title="Shuffle play" className={`w-11 h-11 flex items-center justify-center hover:scale-110 transition-all ${isShuffled ? 'text-[var(--brand-mid)]' : 'text-neutral-400 hover:text-white'}`}>
          <Shuffle className="w-6 h-6" />
        </button>
      </div>

      {/* Find and sort, as Spotify's Liked Songs has */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4 px-1 md:px-4">
        <label className="relative flex-1 min-w-0 max-w-md">
          <Search className="w-4 h-4 text-neutral-500 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={find}
            onChange={(e) => setFind(e.target.value)}
            placeholder="Find in Liked Songs"
            aria-label="Find in Liked Songs"
            className="w-full bg-neutral-900 border border-white/10 rounded-full py-2 pl-11 pr-4 text-sm text-white placeholder:text-neutral-500 outline-none focus:border-[var(--brand-mid)]"
          />
        </label>
        <label className="flex items-center gap-2 rounded-full border border-white/10 bg-neutral-900 px-4 py-2 text-sm text-neutral-300 shrink-0 w-fit">
          <ArrowUpDown className="w-4 h-4 text-neutral-500" />
          <span className="sr-only">Sort</span>
          <select value={sortMode} onChange={(e) => setSortMode(e.target.value)} aria-label="Sort Liked Songs" className="bg-transparent text-white font-semibold outline-none">
            {SORTS.map((s) => <option key={s.id} value={s.id} className="bg-neutral-900">{s.label}</option>)}
          </select>
        </label>
        {needle && <p className="text-xs text-neutral-500">{items.length} match{items.length === 1 ? '' : 'es'}{trackData?.next ? ' so far' : ''}</p>}
      </div>

      {/* Tracklist Header */}
      <div className={`hidden md:grid ${GRID} gap-4 px-4 py-2 border-b border-neutral-800 text-neutral-400 text-sm mb-4 items-center select-none`}>
        <span>#</span><span /><span>Title</span><span>Album</span><span>Date Added</span><div className="flex justify-end pr-2"><Clock3 className="w-4 h-4" /></div>
      </div>

      {/* Tracklist */}
      <div className="flex flex-col">
        {!trackData && !loadError && <SkeletonRows count={8} />}
        {trackData && data.items.length === 0 && (
          <p className="py-10 text-center text-sm text-neutral-500">Songs you like will appear here. Tap the heart on any song.</p>
        )}
        {data.items.slice(0, visibleCount).map((item, index) => {
          const track = item.track;
          if (!track) return null;

          const isCurrentTrack = isSameTrack(track, currentTrack);
          const unplayable = isUnplayable(track, country);

          return (
            <div
              key={`${track.id}-${index}`}
              onClick={(e) => (selection.wantsSelect(e) && track.uri ? selection.toggle(track.uri, { range: e.shiftKey }) : handleTrackSelect(index))}
              {...rowButtonProps(() => handleTrackSelect(index))}
              onContextMenu={(e) => { e.preventDefault(); openRowMenu(e, track); }}
              aria-disabled={unplayable || undefined} data-tip={unplayable ? unplayableWhy(track, country) : undefined}
              aria-selected={selection.active ? selection.has(track.uri) : undefined}
              title={unplayable ? 'Not available on Spotify' : undefined}
              className={`grid ${GRID} gap-3 md:gap-4 px-2 md:px-4 py-2.5 md:py-3 hover:bg-neutral-800/50 rounded-md group text-sm items-center transition-colors cursor-pointer [content-visibility:auto] [contain-intrinsic-size:auto_72px] ${unplayable ? 'opacity-45' : ''} ${selection.has(track.uri) ? 'bg-white/10 ring-1 ring-inset ring-white/20' : ''}`}
            >
              <div className="text-neutral-400 w-4 h-4 hidden md:flex items-center justify-center">
                {isCurrentTrack && !isCurrentTrackPaused ? (
                  <span className="text-[var(--brand-mid)] font-bold animate-pulse">🔊</span>
                ) : (
                  <><span className={`group-hover:hidden ${isCurrentTrack ? 'text-brand-gradient font-bold' : ''}`}>{index + 1}</span><Play className="w-4 h-4 text-white hidden group-hover:block fill-current" /></>
                )}
              </div>
              <div className="w-10 h-10 md:w-12 md:h-12 rounded-md overflow-hidden flex-shrink-0">
                {track.album?.images?.[0]?.url ? (
                  <img src={artUrl(track.album.images, 48)} alt="" width="48" height="48" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-neutral-800 flex items-center justify-center">🎵</div>
                )}
              </div>
              <div className="flex flex-col truncate pr-4">
                <span className={`font-medium truncate ${isCurrentTrack ? 'text-brand-gradient' : 'text-white'}`}>{track.name}</span>
                <span className="text-neutral-400 text-xs truncate">{track.artists.map(a => a.name).join(', ')}</span>
              </div>
              <div className="hidden md:block truncate pr-4">
                {track.album?.id ? (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); navigateToAlbum(track.album.id); }}
                    className="text-neutral-400 hover:text-white hover:underline transition-colors text-left truncate block w-full"
                  >
                    {track.album.name}
                  </button>
                ) : (
                  <span className="text-neutral-400 truncate">{track.album?.name}</span>
                )}
              </div>
              <span className="hidden md:block text-neutral-400 text-xs truncate">{formatDateAdded(item.added_at)}</span>
              <div className="flex items-center justify-end space-x-4">
                <LikeButton trackId={track.id} />
                <span className="hidden md:inline text-neutral-400 w-8 text-right">{formatTime(track.duration_ms)}</span>
                <MoreButton onOpen={(e) => openRowMenu(e, track)} />
              </div>
            </div>
          );
        })}
        {(visibleCount < totalRows || nextPageUrl) && (
          <div ref={sentinelRef} className="py-6 text-center text-xs text-neutral-500">
            {Math.max(0, (data.total || totalRows) - Math.min(visibleCount, totalRows))} more…
          </div>
        )}
      </div>
      <SelectionBar count={selection.count} tracks={selectedTracks} onClear={selection.clear} onRemove={unlikeSelected} removeLabel="Remove from Liked" />
    </div>
  );
}