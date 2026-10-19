import { useEffect } from 'react';
import { Play, Shuffle, ArrowUp, ArrowDown, Undo2, X, Check, RefreshCw } from 'lucide-react';
import { getBlurredBackdrop } from '../utils/blurBackdrop';
import { useRoomStore } from './roomStore';
import { usePlaylistView, UNDO_MS } from '../views/Library/usePlaylistView';
import { useUserStore } from '../store/userStore';
import SortIntoChips from '../components/SortIntoChips';
import PlaylistFormDialog from '../components/PlaylistFormDialog';
import ConfirmDialog from '../components/ConfirmDialog';
import SelectionBar from '../components/SelectionBar';
import LikeButton from '../components/LikeButton';
import UserChip from '../components/UserChip';
import { fromSpotifyText } from '../utils/strings';
import { formatTime } from '../utils/formatTime';
import { artUrl } from '../utils/images';
import { rowButtonProps } from '../utils/a11y';
import { isSameTrack, isUnplayable, unplayableWhy, TRACK_DRAG_TYPE } from '../utils/spotifyUri';
import { TRACKS_DRAG_TYPE } from './LibraryTree';

// The open playlist, on the room's language (DESIGN.md §6, §11): the record-sleeve head, cover,
// name, a facts line, the white Play disc, then rows on hairlines with the playing row alone in
// full white, with the cover's light behind the head. The logic is usePlaylistView, shared with
// the old page; this file is only the surface.

const SORTS = [
  { id: 'custom', label: 'Custom' },
  { id: 'title', label: 'Title' },
  { id: 'artist', label: 'Artist' },
  { id: 'album', label: 'Album' },
  { id: 'date_added', label: 'Added' },
  { id: 'duration', label: 'Length' }
];

const Mono = ({ children, className = '' }) => <span className={`room-mono ${className}`}>{children}</span>;

// A word that does something: the language's button for anything that is not Play or Send
const Word = ({ onClick, disabled, lit, children, title }) => (
  <button type="button" onClick={onClick} disabled={disabled} title={title} aria-pressed={lit || undefined}
    className={`room-mono whitespace-nowrap transition-colors disabled:opacity-40 ${lit ? 'text-[var(--room-paper)]' : 'text-[var(--room-dim)] hover:text-[var(--room-paper)]'}`} style={{ transitionDuration: 'var(--room-mid)' }}>
    {children}
  </button>
);

function LoadError({ playlistId, name, status, reason, isSpotifyOwned, onRetry }) {
  const blocked = isSpotifyOwned && (status === 403 || status === 404);
  const explanation = reason === 'rate-limited' ? 'Spotify is rate-limiting Jomify right now.' : reason === 'network' ? "Couldn't reach Spotify. Check your connection." : `Couldn't load this playlist (Spotify answered ${status}).`;
  return (
    <div className="max-w-xl pt-6">
      <Mono className="text-[var(--room-faint)]">{blocked ? 'Made by Spotify' : 'Playlist'}</Mono>
      <h1 className="mt-2 text-[28px] font-semibold leading-tight tracking-[-0.02em] text-[var(--room-paper)]">{name || 'This playlist'}</h1>
      <p className="mt-4 text-[13px] leading-relaxed text-[var(--room-dim)]">
        {blocked ? "Spotify blocks this one for Jomify. Since November 2024 its API refuses Spotify's own playlists to apps without extended quota, and Jomify hasn't got it. The playlist still works in Spotify itself." : explanation}
      </p>
      <p className="mt-5 flex gap-5">
        {!blocked && onRetry && <Word onClick={onRetry}>Try again</Word>}
        <a href={`https://open.spotify.com/playlist/${encodeURIComponent(playlistId)}`} target="_blank" rel="noreferrer" className="room-mono text-[var(--room-dim)] hover:text-[var(--room-paper)]">Open in Spotify ↗</a>
      </p>
    </div>
  );
}

export default function RoomPlaylist() {
  const {
    activePlaylistId, playlists, playlist, view, loadError, retryLoad, isCollaborative, collaboratorIds, collaborators, totalLength,
    isUnaddedSongsPlaylist, configModalOpen, setConfigModalOpen, isSyncing, syncStatusText, selectedCheckPlaylistIds, runUnaddedSongsSync,
    ownsPlaylist, editDialogOpen, setEditDialogOpen, toggleSaved, savingPlaylist, inLibrary,
    nextPageUrl, suggestionsByTrack,
    pickerQuery, setPickerQuery, pickerError, userPlaylists, pickerList, togglePlaylistSelection,
    isShuffled, handleShufflePlay, handleTrackSelect, sortBy, sortOrder, updateSortSettings, sortedTracks,
    find, setFind, needle, rows, totalRows, visibleCount, sentinelRef,
    unaddedPlan, setUnaddedPlan, applyUnaddedPlan, handleUpdatePlaylist, isUpdatingPlaylist, setCurrentView,
    currentPlayingTrack, isCurrentTrackPaused, country, sortedAway, undoSort, selection, selectedTracks, removeSelected, markRemovedMany,
    canReorder, dragRow, dropAt, setDropAt, reorderTo, setDraggedItem, handleRightClick, sortTargets, sortingUri, sortTrackInto,
    navigateToArtist, navigateToAlbum, formatDateAdded, addQuery, setAddQuery, addSearching, shownAddResults, addFound
  } = usePlaylistView();

  const coverUrl = view?.images?.[0]?.url || '';
  // The cover's light behind the column is drawn by the layer (Layer.jsx) from Zen's
  // pre-blurred copy of the cover. Not a CSS blur: WebKit drops large blur filters and drew
  // the raw cover as a hard dark box in Safari.
  const setLight = useRoomStore((s) => s.setLight);
  useEffect(() => {
    let gone = false;
    getBlurredBackdrop(coverUrl).then((url) => { if (!gone) setLight(url || null); });
    return () => { gone = true; setLight(null); };
  }, [coverUrl, setLight]);
  const heartsAlways = useUserStore((s) => (s.playbackSettings?.rowHearts || 'always') === 'always');

  if (!playlist && loadError?.id === activePlaylistId) {
    const summary = playlists.find((p) => p.id === activePlaylistId);
    return <LoadError playlistId={activePlaylistId} name={summary?.name} status={loadError.status} reason={loadError.reason} isSpotifyOwned={summary?.owner?.id === 'spotify'} onRetry={retryLoad} />;
  }
  if (!view) return <p className="room-mono pt-6 text-[var(--room-faint)]">Loading</p>;

  const description = fromSpotifyText(view.description);
  const facts = [
    isCollaborative ? 'Collaborative' : 'Playlist',
    view.owner?.display_name ? `by ${view.owner.display_name}` : null,
    isCollaborative && collaboratorIds.length > 1 ? `${collaboratorIds.length} people` : null,
    `${playlist || view.tracks.total > 0 ? view.tracks.total.toLocaleString() : '…'} songs${totalLength ? `, ${totalLength}` : ''}`,
    view.followers?.total > 0 ? `${view.followers.total.toLocaleString()} ${view.followers.total === 1 ? 'save' : 'saves'}` : null
  ].filter(Boolean).join(' · ');

  const cols = isCollaborative
    ? 'grid-cols-[28px_34px_minmax(0,1.3fr)_minmax(0,1fr)_92px_120px_24px_44px]'
    : 'grid-cols-[28px_34px_minmax(0,1.3fr)_minmax(0,1fr)_92px_24px_44px]';

  return (
    <div className="relative min-h-full pb-10" style={{ fontFamily: 'var(--font-room)' }}>

      {/* the head */}
      <header className="relative flex items-end gap-7 pt-4 @max-md:flex-col @max-md:items-start @max-md:gap-4">
        <div className="h-[168px] w-[168px] shrink-0 overflow-hidden rounded-[5px] @max-md:h-[132px] @max-md:w-[132px] bg-white/5 shadow-[0_40px_80px_-30px_rgba(0,0,0,0.8)]">
          {coverUrl && <img src={coverUrl} alt="" className="h-full w-full object-cover" draggable="false" />}
        </div>
        <div className="min-w-0 flex-1 pb-1">
          <Mono className="text-[var(--room-faint)]">{facts}</Mono>
          <h1 className="mt-2 text-[34px] @max-md:text-[26px] font-semibold leading-[1.05] tracking-[-0.025em] text-[var(--room-paper)] [text-wrap:balance] line-clamp-2">{view.name}</h1>
          {description && <p className="mt-2 max-w-xl text-[13px] text-[var(--room-dim)] line-clamp-2">{description}</p>}
          {isCollaborative && collaboratorIds.length > 0 && (
            <div className="mt-3 flex items-center gap-2" aria-label="Collaborators">
              <div className="flex -space-x-1.5">{collaboratorIds.slice(0, 6).map((id) => <UserChip key={id} userId={id} fallbackName={collaborators[id]?.display_name || id} size="sm" showName={false} className="ring-2 ring-[#0c0c12] rounded-full" />)}</div>
            </div>
          )}
          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
            <button type="button" onClick={() => (isShuffled ? handleShufflePlay() : handleTrackSelect(0))} aria-label={`Play ${view.name}`} className="grid h-[46px] w-[46px] place-items-center rounded-full bg-[var(--room-paper)] text-[#0a0810] transition-transform hover:scale-105 active:scale-95">
              <Play className="ml-0.5 h-[18px] w-[18px] fill-current" />
            </button>
            <button type="button" onClick={handleShufflePlay} aria-label="Shuffle play" title="Shuffle play" className={`transition-colors ${isShuffled ? 'text-[var(--room-paper)]' : 'text-[var(--room-faint)] hover:text-[var(--room-dim)]'}`}><Shuffle className="h-[18px] w-[18px]" /></button>
            <span className="ml-1 flex flex-wrap items-center gap-x-4 gap-y-2">
              {ownsPlaylist ? <Word onClick={() => setEditDialogOpen(true)}>Edit</Word>
                : <Word onClick={toggleSaved} disabled={savingPlaylist} lit={inLibrary}>{inLibrary ? 'In your library' : 'Save to library'}</Word>}
              {isUnaddedSongsPlaylist && <>
                <Word onClick={() => setConfigModalOpen(true)} disabled={isSyncing}>Check playlists · {selectedCheckPlaylistIds.length}</Word>
                <Word onClick={runUnaddedSongsSync} disabled={isSyncing || selectedCheckPlaylistIds.length === 0} title={selectedCheckPlaylistIds.length === 0 ? 'Pick playlists to check against first' : undefined}>{isSyncing ? (syncStatusText || 'Checking…') : 'Run the check'}</Word>
                <Word onClick={() => setCurrentView('unadded')} disabled={isSyncing || selectedCheckPlaylistIds.length === 0}>Sort songs</Word>
              </>}
            </span>
          </div>
        </div>
      </header>

      {/* find and sort, on one hairline */}
      <div className="mt-8 flex items-center gap-6 border-b border-[var(--room-hair)] pb-3 @max-md:mt-6 @max-md:flex-wrap @max-md:gap-y-2">
        {playlist && sortedTracks.length > 8 && (
          <input type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find in playlist" aria-label="Find in playlist"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--room-paper)] outline-none placeholder:text-[var(--room-faint)] [&::-webkit-search-cancel-button]:hidden" />
        )}
        {needle && <Mono className="text-[var(--room-faint)]">{rows.length} match{rows.length === 1 ? '' : 'es'}</Mono>}
        <span className="ml-auto flex items-center gap-4 @max-md:ml-0 @max-md:w-full @max-md:overflow-x-auto @max-md:pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {SORTS.map((o) => <Word key={o.id} lit={sortBy === o.id} onClick={() => updateSortSettings(o.id, sortOrder)}>{o.label}</Word>)}
          {sortBy !== 'custom' && (
            <button type="button" onClick={() => updateSortSettings(sortBy, sortOrder === 'asc' ? 'desc' : 'asc')} aria-label={sortOrder === 'asc' ? 'Ascending; switch to descending' : 'Descending; switch to ascending'} className="text-[var(--room-dim)] hover:text-[var(--room-paper)]">
              {sortOrder === 'asc' ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
            </button>
          )}
        </span>
      </div>

      {configModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setConfigModalOpen(false)}>
          <div className="room-plane relative flex max-h-[80vh] w-full max-w-md flex-col p-7" onClick={(e) => e.stopPropagation()} style={{ fontFamily: 'var(--font-room)' }}>
            <p className="room-mono flex justify-between text-[var(--room-dim)]"><span>Playlists to check against</span><button type="button" onClick={() => setConfigModalOpen(false)} aria-label="Close"><X className="h-4 w-4" /></button></p>
            <input type="search" value={pickerQuery} onChange={(e) => setPickerQuery(e.target.value)} placeholder="Filter" aria-label="Filter playlists" autoFocus className="mt-4 w-full border-b border-[var(--room-hair)] bg-transparent pb-2 text-[13px] text-[var(--room-paper)] outline-none placeholder:text-[var(--room-faint)]" />
            {pickerError && <p className="room-mono mt-2 text-amber-300/80">{pickerError}</p>}
            {!userPlaylists && !pickerError && <p className="room-mono mt-2 flex items-center gap-2 text-[var(--room-faint)]"><RefreshCw className="h-3 w-3 animate-spin" /> Loading the full list</p>}
            <div className="mt-2 min-h-0 flex-1 overflow-y-auto">
              {pickerList.length === 0 && <p className="py-8 text-center text-[13px] text-[var(--room-faint)]">{pickerQuery ? 'No playlists match.' : 'No playlists yet.'}</p>}
              {pickerList.map((p) => {
                const on = selectedCheckPlaylistIds.includes(p.id);
                return (
                  <button key={p.id} type="button" onClick={() => togglePlaylistSelection(p.id)} aria-pressed={on} className={`flex w-full items-center gap-3 py-2 text-left text-[13px] ${on ? 'text-[var(--room-paper)]' : 'text-[var(--room-dim)] hover:text-[var(--room-paper)]'}`} style={{ borderTop: '1px solid var(--room-hair)' }}>
                    <span className="h-7 w-7 shrink-0 overflow-hidden rounded-[3px] bg-white/5">{p.images?.[0]?.url && <img src={artUrl(p.images, 28)} alt="" className="h-full w-full object-cover" />}</span>
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    {on && <Check className="h-3.5 w-3.5" />}
                  </button>
                );
              })}
            </div>
            <p className="mt-4 text-right"><Word onClick={() => setConfigModalOpen(false)} lit>Done</Word></p>
          </div>
        </div>
      )}

      <ConfirmDialog open={Boolean(unaddedPlan)} tone="neutral" title="Apply these changes?" confirmLabel="Apply" cancelLabel="Keep as is" onConfirm={applyUnaddedPlan} onCancel={() => setUnaddedPlan(null)}
        message={unaddedPlan ? [unaddedPlan.remove.length ? `Remove ${unaddedPlan.remove.length} song${unaddedPlan.remove.length === 1 ? '' : 's'}` : null, unaddedPlan.add.length ? `add ${unaddedPlan.add.length} liked song${unaddedPlan.add.length === 1 ? '' : 's'} not in any check playlist` : null].filter(Boolean).join(', ') + '.' : ''}>
        {unaddedPlan && (
          <div className="space-y-4 text-sm">
            {unaddedPlan.remove.length > 0 && <div><p className="room-mono mb-2 text-red-300/80">Removing</p><ul className="space-y-1">{unaddedPlan.remove.map((t) => <li key={t.uri} className="flex justify-between gap-3 text-neutral-300"><span className="truncate"><span className="text-white">{t.name}</span>{t.artist && <span className="text-neutral-500"> · {t.artist}</span>}</span><span className="shrink-0 text-xs text-neutral-500">{t.reason === 'unliked' ? 'unliked' : 'now in a playlist'}</span></li>)}</ul></div>}
            {unaddedPlan.add.length > 0 && <div><p className="room-mono mb-2 text-[var(--room-dim)]">Adding</p><ul className="space-y-1">{unaddedPlan.add.map((t) => <li key={t.uri} className="truncate text-neutral-300"><span className="text-white">{t.name}</span>{t.artist && <span className="text-neutral-500"> · {t.artist}</span>}</li>)}</ul></div>}
          </div>
        )}
      </ConfirmDialog>
      <PlaylistFormDialog open={editDialogOpen} title="Edit playlist" submitLabel="Save changes" initialName={view.name} initialDescription={description} initialImageUrl={coverUrl} initialPublic={Boolean(view.public)} initialCollaborative={Boolean(view.collaborative)} onSubmit={handleUpdatePlaylist} onCancel={() => setEditDialogOpen(false)} isSubmitting={isUpdatingPlaylist} />

      {/* the rows */}
      <div className="mt-1">
        {!playlist && <p className="room-mono py-6 text-[var(--room-faint)]">Loading the songs</p>}
        {playlist && totalRows === 0 && (
          <div className="py-14">
            <p className="text-[15px] font-semibold text-[var(--room-paper)]">Nothing here yet</p>
            <p className="mt-1 text-[13px] text-[var(--room-dim)]">{ownsPlaylist ? 'Drag songs in from another playlist, or find some to add below.' : 'This playlist has no songs.'}</p>
            {ownsPlaylist && <p className="mt-3"><Word onClick={() => setCurrentView('browse')}>Search Spotify</Word></p>}
          </div>
        )}
        {rows.slice(0, visibleCount).map(({ item, i: index }) => {
          if (!item?.track) return null;
          const track = item.track;
          const current = isSameTrack(track, currentPlayingTrack);
          const unplayable = isUnplayable(track, country);
          const adderId = item.added_by?.id;
          const away = sortedAway[track.uri];
          if (away) {
            return (
              <div key={`${track.id}-${index}-away`} className="relative flex items-center gap-4 overflow-hidden py-3 text-[13px]" style={{ borderTop: '1px solid var(--room-hair)' }}>
                <span className="min-w-0 flex-1 truncate text-[var(--room-dim)]"><span className="text-[var(--room-paper)]">{track.name}</span>{away.removed ? ' removed' : <> moved to <span className="text-[var(--room-paper)]">{away.playlistName}</span></>}</span>
                <button type="button" onClick={() => undoSort(item)} className="room-mono flex shrink-0 items-center gap-1.5 text-[var(--room-dim)] hover:text-[var(--room-paper)]"><Undo2 className="h-3.5 w-3.5" /> Undo</button>
                <div key={away.expiresAt} className="absolute bottom-0 left-0 h-px bg-[var(--room-paper)]/40 animate-[undo-drain_linear_forwards]" style={{ animationDuration: `${UNDO_MS}ms` }} />
              </div>
            );
          }
          const selected = selection.has(track.uri);
          return (
            <div
              key={`${track.id}-${index}`}
              onClick={(e) => (selection.wantsSelect(e) && track.uri ? selection.toggle(track.uri, { range: e.shiftKey }) : handleTrackSelect(index))}
              {...rowButtonProps(() => handleTrackSelect(index))}
              onContextMenu={(e) => handleRightClick(e, track, item)}
              aria-selected={selection.active ? selected : undefined}
              aria-disabled={unplayable || undefined} data-tip={unplayable ? unplayableWhy(track, country) : undefined}
              title={unplayable ? 'Not available on Spotify' : undefined}
              draggable
              onDragStart={(e) => {
                // a row drags out to the tree always (a selection takes every selected song);
                // within your own playlist in custom order it also carries its index to reorder
                e.dataTransfer.effectAllowed = 'all';
                e.dataTransfer.setData(TRACK_DRAG_TYPE, track.uri);
                e.dataTransfer.setData('text/plain', track.uri);
                if (selected && selectedTracks.length > 1) e.dataTransfer.setData(TRACKS_DRAG_TYPE, JSON.stringify(selectedTracks.map((t) => t.uri)));
                if (canReorder && !selection.active) { dragRow.current = index; e.dataTransfer.setData('application/x-jomify-row', String(index)); }
                setTimeout(() => setDraggedItem({ type: 'track', uri: track.uri }), 0);
              }}
              onDragOver={canReorder ? (e) => { if (dragRow.current === null) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; const r = e.currentTarget.getBoundingClientRect(); setDropAt(e.clientY < r.top + r.height / 2 ? index : index + 1); } : undefined}
              onDrop={canReorder ? (e) => { if (dragRow.current === null) return; e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); reorderTo(dragRow.current, e.clientY < r.top + r.height / 2 ? index : index + 1); dragRow.current = null; setDropAt(null); } : undefined}
              onDragEnd={() => { dragRow.current = null; setDropAt(null); setDraggedItem(null); }}
              className={`group grid ${cols} @max-md:grid-cols-[22px_36px_minmax(0,1fr)_36px] @max-md:gap-2.5 cursor-pointer items-center gap-3 py-[9px] text-[13px] transition-colors [content-visibility:auto] [contain-intrinsic-size:auto_54px] ${unplayable ? 'opacity-40' : ''} ${selected ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'}`}
              style={{ borderTop: dropAt === index ? '1px solid var(--room-paper)' : '1px solid var(--room-hair)', borderBottom: dropAt === index + 1 && index === totalRows - 1 ? '1px solid var(--room-paper)' : undefined, transitionDuration: 'var(--room-mid)' }}
            >
              <span className="room-mono flex items-center justify-center text-[var(--room-faint)]">
                {current && !isCurrentTrackPaused ? <span className="h-1.5 w-1.5 rounded-full bg-[var(--room-paper)] animate-pulse" aria-label="Playing" />
                  : <><span className="group-hover:hidden">{index + 1}</span><Play className="hidden h-3 w-3 fill-current text-[var(--room-paper)] group-hover:block" /></>}
              </span>
              <span className="h-[34px] w-[34px] overflow-hidden rounded-[3px] bg-white/5">{track.album?.images?.[0]?.url && <img src={artUrl(track.album.images, 34)} alt="" width="34" height="34" loading="lazy" decoding="async" draggable="false" className="h-full w-full object-cover" />}</span>
              <span className="min-w-0 pr-3">
                <span className={`block truncate ${current ? 'font-semibold text-[var(--room-paper)]' : 'font-medium text-[var(--room-paper)]/90'}`}>{track.name}</span>
                <span className="block truncate text-[11.5px] text-[var(--room-dim)]">
                  {track.artists.map((a, k) => <span key={a.id || k}><button type="button" onClick={(e) => { e.stopPropagation(); if (a.id) navigateToArtist(a.id); }} className="hover:text-[var(--room-paper)] pointer-coarse:pointer-events-none">{a.name}</button>{k < track.artists.length - 1 ? ', ' : ''}</span>)}
                </span>
                {isUnaddedSongsPlaylist && <SortIntoChips suggestions={suggestionsByTrack.get(track.id) || []} targets={sortTargets} busy={sortingUri === track.uri} onPick={(playlistId) => sortTrackInto(item, playlistId)} />}
              </span>
              <span className="min-w-0 truncate pr-3 text-[var(--room-dim)] @max-md:hidden">
                {track.album?.id ? <button type="button" onClick={(e) => { e.stopPropagation(); navigateToAlbum(track.album.id); }} className="block w-full truncate text-left hover:text-[var(--room-paper)]">{track.album.name}</button> : track.album?.name}
              </span>
              <Mono className="truncate text-[var(--room-faint)] @max-md:hidden">{formatDateAdded(item.added_at)}</Mono>
              {isCollaborative && <span className="min-w-0 truncate @max-md:hidden"><UserChip userId={adderId} fallbackName={collaborators[adderId]?.display_name || adderId} size="sm" /></span>}
              <span className={`flex items-center justify-center [&_svg]:h-4 [&_svg]:w-4 room-like ${heartsAlways ? '' : 'opacity-0 transition-opacity group-hover:opacity-100 pointer-coarse:opacity-100'}`}><LikeButton trackId={track.id} /></span>
              <Mono className="text-right text-[var(--room-faint)] @max-md:hidden">{formatTime(track.duration_ms)}</Mono>
            </div>
          );
        })}
        {(visibleCount < totalRows || nextPageUrl) && <p ref={sentinelRef} className="room-mono py-5 text-center text-[var(--room-faint)]">{Math.max(0, (view.tracks.total || totalRows) - Math.min(visibleCount, totalRows))} more</p>}
        {needle && rows.length === 0 && <p className="py-10 text-center text-[13px] text-[var(--room-faint)]">Nothing here matches "{find.trim()}".</p>}
      </div>

      {ownsPlaylist && playlist && (
        <div className="mt-12 max-w-xl">
          <Mono className="text-[var(--room-faint)]">Find something to add</Mono>
          <input type="search" value={addQuery} onChange={(e) => setAddQuery(e.target.value)} placeholder="Songs or artists, straight into this playlist" aria-label="Find something to add" className="mt-2 w-full border-b border-[var(--room-hair)] bg-transparent pb-2 text-[13px] text-[var(--room-paper)] outline-none placeholder:text-[var(--room-faint)] [&::-webkit-search-cancel-button]:hidden" />
          {addSearching && <p className="room-mono mt-3 text-[var(--room-faint)]">Searching</p>}
          {shownAddResults && !addSearching && shownAddResults.length === 0 && <p className="room-mono mt-3 text-[var(--room-faint)]">Nothing found</p>}
          {shownAddResults && shownAddResults.length > 0 && shownAddResults.slice(0, 10).map((t) => {
            const already = (playlist.tracks?.items || []).some((it) => it.track?.uri === t.uri);
            return (
              <div key={t.id} className="flex items-center gap-3 py-2 text-[13px]" style={{ borderTop: '1px solid var(--room-hair)' }}>
                <span className="h-[30px] w-[30px] shrink-0 overflow-hidden rounded-[3px] bg-white/5"><img src={artUrl(t.album?.images, 30)} alt="" width="30" height="30" loading="lazy" decoding="async" className="h-full w-full object-cover" /></span>
                <span className="min-w-0 flex-1"><span className="block truncate text-[var(--room-paper)]">{t.name}</span><span className="block truncate text-[11.5px] text-[var(--room-dim)]">{(t.artists || []).map((a) => a.name).join(', ')} · {t.album?.name}</span></span>
                <Word onClick={() => addFound(t)} disabled={already} lit={already}>{already ? 'Added' : 'Add'}</Word>
              </div>
            );
          })}
        </div>
      )}
      <SelectionBar count={selection.count} tracks={selectedTracks} onClear={selection.clear} onRemove={ownsPlaylist ? removeSelected : undefined} onRemovedMany={markRemovedMany} sourcePlaylistId={activePlaylistId} />
    </div>
  );
}
