import MoreButton from '../../components/MoreButton';
import SortIntoChips from '../../components/SortIntoChips';
import SortMode from './SortMode';
import { SkeletonHeader, SkeletonRows } from '../../components/Skeleton';
import { fromSpotifyText } from '../../utils/strings';
import { formatTime } from '../../utils/formatTime';
import { Clock3, Play, Shuffle, RefreshCw, ListFilter, Check, X, ArrowUpDown, ArrowUp, ArrowDown, Users, ExternalLink, Undo2, Pencil, Layers, BookmarkPlus, Search } from 'lucide-react';
import UserChip from '../../components/UserChip';
import LikeButton from '../../components/LikeButton';
import PlaylistFormDialog from '../../components/PlaylistFormDialog';
import ConfirmDialog from '../../components/ConfirmDialog';
import { collaboratorStyleFor } from '../../utils/collaboratorStyle';
import { rowButtonProps } from '../../utils/a11y';
import { artUrl } from '../../utils/images';
import { isSameTrack, isUnplayable, unplayableWhy, TRACK_DRAG_TYPE } from '../../utils/spotifyUri';
import SelectionBar from '../../components/SelectionBar';

import { usePlaylistView, UNDO_MS } from './usePlaylistView';

// Shown instead of a blank page when Spotify refuses the playlist. Since November 2024 Spotify
// blocks its own playlists (Discover Weekly, Blend, Daily Mix, Release Radar, Your Top Songs)
// for apps in development mode, which Jomify is.
function PlaylistLoadError({ playlistId, name, status, reason, isSpotifyOwned, onRetry }) {
  const blocked = isSpotifyOwned && (status === 403 || status === 404);
  const explanation = reason === 'rate-limited'
    ? 'Spotify is rate-limiting Jomify right now.'
    : reason === 'network'
      ? "Couldn't reach Spotify. Check your connection."
      : `Couldn't load this playlist (Spotify answered ${status}).`;
  return (
    <div className="mt-8 max-w-xl rounded-3xl border border-white/10 bg-neutral-900/60 p-8 animate-fade-in">
      <p className="text-xs font-bold uppercase tracking-widest text-neutral-400 mb-2">{blocked ? 'Made by Spotify' : 'Playlist'}</p>
      <h1 className="text-3xl font-extrabold text-white tracking-tight mb-4 break-words">{name || 'This playlist'}</h1>
      {blocked ? (
        <p className="text-neutral-300 text-sm leading-relaxed">
          Spotify blocks this one for Jomify. Since November 2024 Spotify's API refuses its own playlists
          (Discover Weekly, Blend, Daily Mix, Release Radar, Your Top Songs) to apps that haven't been
          granted extended quota, and Jomify hasn't. The playlist still works in Spotify itself.
        </p>
      ) : (
        <p className="text-neutral-300 text-sm">{explanation}</p>
      )}
      {!blocked && onRetry && (
        <button type="button" onClick={onRetry} className="mt-4 mr-3 inline-flex items-center rounded-full border border-white/15 px-5 py-2 text-sm font-bold text-white hover:bg-white/5 transition-colors">
          Try again
        </button>
      )}
      <a
        href={`https://open.spotify.com/playlist/${encodeURIComponent(playlistId)}`}
        target="_blank"
        rel="noreferrer"
        className="mt-6 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2 text-sm font-bold text-black hover:bg-neutral-200 transition-colors"
      >
        <ExternalLink className="w-4 h-4" /> Open in Spotify
      </a>
    </div>
  );
}

export default function PlaylistView() {
  const {
    playlists, activePlaylistId, setDraggedItem, navigateToArtist, navigateToAlbum, setCurrentView, currentPlayingTrack, isCurrentTrackPaused, isShuffled, playlist, view, loadError, retryLoad, visibleCount, sentinelRef, collaborators, sortDropdownOpen, setSortDropdownOpen, sortMenuRef, sortBy, sortOrder, updateSortSettings, fetchingMore, editDialogOpen, setEditDialogOpen, inLibrary, savingPlaylist, toggleSaved, isUpdatingPlaylist, isSyncing, syncStatusText, configModalOpen, setConfigModalOpen, userPlaylists, pickerError, pickerQuery, setPickerQuery, selectedCheckPlaylistIds, isUnaddedSongsPlaylist, sortQueue, setSortQueue, suggestionsByTrack, sortTargets, suggestionStatus, sortModeTargets, openSortMode, sortingUri, removeRow, restoreRow, sortedAway, sortTrackInto, markRemovedMany, undoSort, pickerList, togglePlaylistSelection, unaddedPlan, setUnaddedPlan, runUnaddedSongsSync, applyUnaddedPlan, isCollaborative, handleTrackSelect, handleUpdatePlaylist, handleRightClick, formatDateAdded, sortedTracks, ownsPlaylist, collaboratorIds, find, setFind, needle, rows, totalRows, selection, selectedTracks, removeSelected, dragRow, dropAt, setDropAt, canReorder, reorderTo, addQuery, setAddQuery, addSearching, shownAddResults, addFound, nextPageUrl, totalLength, country, handleShufflePlay
  } = usePlaylistView();

  if (!playlist) {
    if (loadError?.id === activePlaylistId) {
      const summary = playlists.find(p => p.id === activePlaylistId);
      return (
        <PlaylistLoadError
          playlistId={activePlaylistId}
          name={summary?.name}
          status={loadError.status}
          reason={loadError.reason}
          isSpotifyOwned={summary?.owner?.id === 'spotify'}
          onRetry={retryLoad}
        />
      );
    }
    if (!view) {
      return (
        <div className="flex flex-col pb-8 mt-2 md:mt-4">
          <SkeletonHeader />
          <SkeletonRows count={8} />
        </div>
      );
    }
  }

  // Phone: art, title/artists, like + duration + menu. Desktop keeps the full table.
  const gridColumns = isCollaborative
    ? "grid-cols-[40px_minmax(0,1fr)_auto] md:grid-cols-[16px_48px_minmax(0,1.2fr)_minmax(0,1fr)_120px_140px_80px]"
    : "grid-cols-[40px_minmax(0,1fr)_auto] md:grid-cols-[16px_48px_minmax(0,1.2fr)_minmax(0,1fr)_140px_80px]";

  return (
    <div className="flex flex-col pb-8">
      {/* Playlist Header */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between @max-3xl:flex-col @max-3xl:items-start mb-4 md:mb-8 mt-2 md:mt-4 select-none gap-4 md:gap-6">
        <div className="flex flex-row items-center md:items-end gap-4 md:gap-6 min-w-0">
          {view.images?.length > 0 ? (
            <img src={view.images[0].url} alt={view.name} className="w-24 h-24 md:w-48 md:h-48 shadow-2xl shadow-black/50 rounded shrink-0" />
          ) : (
            <div className="w-24 h-24 md:w-48 md:h-48 bg-neutral-800 flex items-center justify-center text-4xl shadow-2xl rounded shrink-0"> 🎵 </div>
          )}
          <div className="min-w-0">
            <p className="hidden md:flex text-xs font-bold text-neutral-400 uppercase tracking-widest mb-2 items-center gap-2">
              Playlist
              {isCollaborative && (
                <span className="bg-[var(--brand-mid)]/20 text-[var(--brand-mid)] border border-[var(--brand-mid)]/30 px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1.5 shadow-sm">
                  <Users className="w-3 h-3" />
                  Collaborative
                </span>
              )}
            </p>
            <h1 className="text-2xl md:text-5xl lg:text-7xl @max-3xl:text-4xl font-extrabold text-white tracking-tighter mb-1 md:mb-4 break-words line-clamp-2 md:line-clamp-none">{view.name}</h1>
            {isCollaborative && collaboratorIds.length > 0 && (
              <div className="flex items-center gap-2 mb-2" aria-label="Collaborators">
                <div className="flex -space-x-2">
                  {collaboratorIds.slice(0, 6).map((id) => (
                    <UserChip key={id} userId={id} fallbackName={collaborators[id]?.display_name || id} size="sm" showName={false} className="ring-2 ring-black rounded-full" />
                  ))}
                </div>
                <span className="text-xs text-neutral-400">
                  {collaboratorIds.length === 1 ? collaborators[collaboratorIds[0]]?.display_name || collaboratorIds[0] : `${collaboratorIds.length} people`}{collaboratorIds.length > 6 ? ` · +${collaboratorIds.length - 6}` : ''}
                </span>
              </div>
            )}
            <p className="text-neutral-400 text-sm font-medium">
              {fromSpotifyText(view.description) && <span className="mr-2 hidden md:inline">{fromSpotifyText(view.description)} •</span>}
              {isCollaborative && <span className="md:hidden">Collaborative • </span>}
              {view.owner.display_name}
              {view.followers?.total > 0 && ` • ${view.followers.total.toLocaleString()} ${view.followers.total === 1 ? 'save' : 'saves'}`}
              {' • '}{playlist || view.tracks.total > 0 ? view.tracks.total.toLocaleString() : '…'} songs
              {totalLength && `, ${totalLength}`}
            </p>
            {fromSpotifyText(view.description) && <p className="md:hidden text-neutral-500 text-xs mt-1 line-clamp-1">{fromSpotifyText(view.description)}</p>}
          </div>
        </div>
        <div className="hidden md:flex flex-wrap items-center gap-3">
          {isUnaddedSongsPlaylist && (
            <>
              <button
                type="button"
                onClick={() => setConfigModalOpen(true)}
                disabled={isSyncing}
                className="flex items-center gap-2 rounded-full bg-neutral-800 border border-neutral-700 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-700 transition-colors disabled:opacity-50"
              >
                <ListFilter className="w-4 h-4" />
                Select Playlists ({selectedCheckPlaylistIds.length})
              </button>
              <button
                type="button"
                onClick={runUnaddedSongsSync}
                // With no check playlists selected, every liked song would count as "unadded"
                // and be pushed into this playlist.
                disabled={isSyncing || selectedCheckPlaylistIds.length === 0}
                title={selectedCheckPlaylistIds.length === 0 ? 'Select at least one playlist to check against first' : undefined}
                className="flex items-center gap-2 rounded-full bg-brand-gradient px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition-opacity shadow-brand-glow disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
                {isSyncing ? (syncStatusText || 'Syncing...') : 'Run Unadded Check'}
              </button>
              <button
                type="button"
                onClick={openSortMode}
                disabled={isSyncing || selectedCheckPlaylistIds.length === 0}
                title={selectedCheckPlaylistIds.length === 0 ? 'Select at least one playlist to check against first' : 'Sort songs one at a time'}
                className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-neutral-200 transition-colors disabled:opacity-50"
              >
                <Layers className="w-4 h-4" />
                Sort songs
              </button>
            </>
          )}
          {ownsPlaylist ? (
            <button
              type="button"
              onClick={() => setEditDialogOpen(true)}
              className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-neutral-200 transition-colors"
            >
              Edit playlist
            </button>
          ) : (
            <button
              type="button"
              onClick={toggleSaved}
              disabled={savingPlaylist}
              aria-pressed={inLibrary}
              className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-all disabled:opacity-60 ${inLibrary ? 'bg-white/10 border border-white/15 text-white hover:bg-white/15' : 'bg-brand-gradient text-white shadow-brand-glow hover:scale-105'}`}
            >
              {inLibrary ? <Check className="w-4 h-4" /> : <BookmarkPlus className="w-4 h-4" />}
              {inLibrary ? 'In your library' : 'Save to library'}
            </button>
          )}
        </div>
      </div>

      {sortQueue && (
        <SortMode
          items={sortQueue}
          total={view.tracks.total}
          loadingMore={Boolean(nextPageUrl) && fetchingMore}
          suggestionsByTrack={suggestionsByTrack}
          suggestionsReady={suggestionStatus === 'ready' || suggestionStatus === 'error'}
          targets={sortModeTargets}
          sourcePlaylistId={activePlaylistId}
          onRemovedFromSource={removeRow}
          onRestoredToSource={restoreRow}
          onClose={() => setSortQueue(null)}
        />
      )}

      {/* Check Playlists Selection Modal */}
      {configModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between pb-4 border-b border-neutral-800">
              <h3 className="text-xl font-bold text-white">Select Playlists to Check Against</h3>
              <button 
                onClick={() => setConfigModalOpen(false)}
                className="text-neutral-400 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-neutral-400 py-3">
              Choose which playlists Jomify should verify your liked songs against when running the Unadded Check.
            </p>
            <input
              type="search"
              value={pickerQuery}
              onChange={(e) => setPickerQuery(e.target.value)}
              placeholder="Filter playlists"
              aria-label="Filter playlists"
              autoFocus
              className="w-full bg-neutral-800 border border-neutral-700 rounded-full px-4 py-2 text-sm text-white placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-[#f91362] mb-2"
            />
            {pickerError && <p className="text-xs text-amber-300 mb-2">{pickerError}</p>}
            {!userPlaylists && !pickerError && (
              <p className="text-xs text-neutral-500 mb-2 flex items-center gap-2"><RefreshCw className="w-3 h-3 animate-spin" /> Loading the full list…</p>
            )}
            <div className="flex-1 overflow-y-auto space-y-2 pr-2 my-2">
              {pickerList.length === 0 && (
                <p className="py-8 text-center text-sm text-neutral-500">{pickerQuery ? 'No playlists match.' : 'No playlists yet.'}</p>
              )}
              {pickerList.map((p) => {
                const isSelected = selectedCheckPlaylistIds.includes(p.id);
                return (
                  <div
                    key={p.id}
                    onClick={() => togglePlaylistSelection(p.id)}
                    className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all ${isSelected ? 'bg-white/10 border-white/20 text-white' : 'bg-neutral-800/40 border-neutral-800 text-neutral-300 hover:bg-neutral-800'}`}
                  >
                    <div className="flex items-center space-x-3 truncate">
                      {p.images?.[0]?.url ? (
                        <img src={p.images[0].url} alt="" className="w-10 h-10 rounded object-cover flex-shrink-0" />
                      ) : (
                        <div className="w-10 h-10 rounded bg-neutral-800 flex items-center justify-center text-xs flex-shrink-0">🎵</div>
                      )}
                      <span className="font-medium truncate">{p.name}</span>
                    </div>
                    <div className={`w-5 h-5 rounded flex items-center justify-center border ${isSelected ? 'bg-[var(--brand-mid)] border-[var(--brand-mid)] text-white' : 'border-neutral-600'}`}>
                      {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="pt-4 border-t border-neutral-800 flex justify-end">
              <button
                onClick={() => setConfigModalOpen(false)}
                className="rounded-full bg-white px-6 py-2 text-sm font-semibold text-black hover:bg-neutral-200 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FILTER & SORT CONTROLS BAR */}
      {/* Play / Shuffle: same on desktop and phone */}
      <div ref={sortMenuRef} className="relative mb-4 md:mb-6 px-1 md:px-4 select-none">
      <div className="flex items-center gap-2 md:gap-4">
        <button
          type="button"
          onClick={() => (isShuffled ? handleShufflePlay() : handleTrackSelect(0))}
          aria-label={`Play ${view.name}`}
          className="w-12 h-12 md:w-14 md:h-14 bg-brand-gradient text-white rounded-full flex items-center justify-center hover:scale-105 active:scale-95 transition-transform shadow-xl shrink-0"
        >
          <Play className="w-6 h-6 fill-current ml-1" />
        </button>
        <button
          type="button"
          onClick={handleShufflePlay}
          aria-label="Shuffle play"
          title="Shuffle play"
          className={`w-11 h-11 flex items-center justify-center rounded-full hover:scale-110 active:scale-95 transition-all ${isShuffled ? 'text-[var(--brand-mid)]' : 'text-neutral-400 hover:text-white'}`}
        >
          <Shuffle className="w-6 h-6" />
        </button>
        <div className="ml-auto flex items-center gap-1.5 md:hidden">
          {isUnaddedSongsPlaylist && (
            <>
              <button
                type="button"
                onClick={() => setConfigModalOpen(true)}
                disabled={isSyncing}
                aria-label={`Select playlists to check against (${selectedCheckPlaylistIds.length} selected)`}
                className="relative w-11 h-11 rounded-full bg-neutral-800 border border-neutral-700 flex items-center justify-center text-white disabled:opacity-50"
              >
                <ListFilter className="w-5 h-5" />
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--brand-mid)] text-[10px] font-bold text-white flex items-center justify-center">{selectedCheckPlaylistIds.length}</span>
              </button>
              <button
                type="button"
                onClick={runUnaddedSongsSync}
                disabled={isSyncing || selectedCheckPlaylistIds.length === 0}
                className="flex items-center gap-1.5 rounded-full bg-brand-gradient px-3 h-11 text-xs font-semibold text-white whitespace-nowrap shadow-brand-glow disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
                {isSyncing ? 'Syncing' : 'Run check'}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setSortDropdownOpen(!sortDropdownOpen)}
            aria-haspopup="menu"
            aria-expanded={sortDropdownOpen}
            aria-label={sortBy === 'custom' ? 'Sort by custom order' : `Sort by ${sortBy.replace('_', ' ')}, ${sortOrder === 'asc' ? 'ascending' : 'descending'}`}
            className={`w-11 h-11 rounded-full border flex items-center justify-center transition-colors ${sortBy !== 'custom' ? 'border-[var(--brand-mid)]/50 bg-[var(--brand-mid)]/15 text-white' : 'border-white/10 bg-neutral-900 text-neutral-300'}`}
          >
            <ArrowUpDown className="w-5 h-5" />
          </button>
          {ownsPlaylist ? (
            <button
              type="button"
              onClick={() => setEditDialogOpen(true)}
              aria-label="Edit playlist"
              className="w-11 h-11 rounded-full border border-white/10 bg-neutral-900 flex items-center justify-center text-neutral-300"
            >
              <Pencil className="w-5 h-5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={toggleSaved}
              disabled={savingPlaylist}
              aria-label={inLibrary ? 'Remove from your library' : 'Save to your library'}
              aria-pressed={inLibrary}
              className={`w-11 h-11 rounded-full border flex items-center justify-center transition-colors ${inLibrary ? 'border-[var(--brand-mid)]/50 bg-[var(--brand-mid)]/15 text-white' : 'border-white/10 bg-neutral-900 text-neutral-300'}`}
            >
              {inLibrary ? <Check className="w-5 h-5" /> : <BookmarkPlus className="w-5 h-5" />}
            </button>
          )}
        </div>
      </div>
      {isUnaddedSongsPlaylist && isSyncing && syncStatusText && (
        <p className="md:hidden text-xs text-neutral-400 mt-2 px-1">{syncStatusText}</p>
      )}
      {isUnaddedSongsPlaylist && (
        <button
          type="button"
          onClick={openSortMode}
          disabled={isSyncing || selectedCheckPlaylistIds.length === 0}
          className="md:hidden mt-3 w-full flex items-center justify-center gap-2 rounded-full bg-white text-black h-11 text-sm font-bold disabled:opacity-50"
        >
          <Layers className="w-4 h-4" /> Sort songs one by one
        </button>
      )}

      <div className="hidden md:flex items-center justify-end mt-6">
        <div>
          <button
            onClick={() => setSortDropdownOpen(!sortDropdownOpen)}
            aria-haspopup="menu"
            aria-expanded={sortDropdownOpen}
            className="flex items-center gap-2 bg-neutral-900 border border-neutral-800 hover:border-neutral-700 px-4 py-2 rounded-xl text-sm font-medium text-white transition-colors"
          >
            <ArrowUpDown className="w-4 h-4 text-neutral-400" />
            <span>Sort by: <strong className="text-white capitalize">{sortBy.replace('_', ' ')}</strong>{sortBy !== 'custom' && ` (${sortOrder.toUpperCase()})`}</span>
          </button>

        </div>
      </div>
      {sortDropdownOpen && (
        <div className="absolute right-1 md:right-4 top-full mt-2 w-56 bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl z-30 p-2 flex flex-col space-y-1">
          {[
            { id: 'custom', label: 'Custom Order' },
            { id: 'title', label: 'Alphabetical (Title)' },
            { id: 'artist', label: 'Alphabetical (Artist)' },
            { id: 'album', label: 'Alphabetical (Album)' },
            { id: 'date_added', label: 'Date Added' },
            { id: 'duration', label: 'Duration' },
          ].map((option) => (
            <button
              key={option.id}
              onClick={() => {
                updateSortSettings(option.id, sortOrder);
                setSortDropdownOpen(false);
              }}
              className={`flex items-center justify-between px-3 py-2 rounded-xl text-sm text-left transition-colors ${sortBy === option.id ? 'bg-white/10 text-white font-semibold' : 'text-neutral-400 hover:text-white hover:bg-neutral-800'}`}
            >
              <span>{option.label}</span>
              {sortBy === option.id && <Check className="w-4 h-4 text-[var(--brand-mid)]" />}
            </button>
          ))}

          {/* Direction means nothing in custom order, where the toggle used to change its label and nothing else */}
          {sortBy !== 'custom' && (
            <>
              <div className="my-1 border-t border-neutral-800" />
              <button
                onClick={() => updateSortSettings(sortBy, sortOrder === 'asc' ? 'desc' : 'asc')}
                className="flex items-center justify-between px-3 py-2 rounded-xl text-sm text-neutral-300 hover:bg-neutral-800 transition-colors"
              >
                <span>Direction</span>
                <span className="flex items-center gap-1 text-xs font-bold uppercase text-[var(--brand-mid)]">
                  {sortOrder === 'asc' ? <><ArrowUp className="w-3.5 h-3.5" /> Ascending</> : <><ArrowDown className="w-3.5 h-3.5" /> Descending</>}
                </span>
              </button>
            </>
          )}
        </div>
      )}
      </div>

      {/* Find in playlist */}
      {playlist && sortedTracks.length > 8 && (
        <div className="flex items-center gap-3 mb-4 px-1 md:px-4">
          <label className="relative flex-1 min-w-0 max-w-md">
            <ListFilter className="w-4 h-4 text-neutral-500 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={find}
              onChange={(e) => setFind(e.target.value)}
              placeholder="Find in playlist"
              aria-label="Find in playlist"
              className="w-full bg-neutral-900 border border-white/10 rounded-full py-2 pl-11 pr-4 text-sm text-white placeholder:text-neutral-500 outline-none focus:border-[var(--brand-mid)]"
            />
          </label>
          {needle && <p className="text-xs text-neutral-500">{rows.length} match{rows.length === 1 ? '' : 'es'}</p>}
        </div>
      )}

      {/* Tracklist Header */}
      <div className={`hidden md:grid ${gridColumns} gap-4 px-4 py-2 border-b border-neutral-800 text-neutral-400 text-sm mb-4 items-center select-none`}>
        <span>#</span>
        <span />
        <span>Title</span>
        <span>Album</span>
        <span>Date Added</span>
        {isCollaborative && <span>Added By</span>}
        <div className="flex justify-end pr-2"><Clock3 className="w-4 h-4" /></div>
      </div>

      {/* Tracklist */}
      <div className="flex flex-col">
        <ConfirmDialog
          open={Boolean(unaddedPlan)}
          tone="neutral"
          title="Apply these changes?"
          message={unaddedPlan ? [
            unaddedPlan.remove.length ? `Remove ${unaddedPlan.remove.length} song${unaddedPlan.remove.length === 1 ? '' : 's'}` : null,
            unaddedPlan.add.length ? `add ${unaddedPlan.add.length} liked song${unaddedPlan.add.length === 1 ? '' : 's'} not in any check playlist` : null
          ].filter(Boolean).join(', ') + '.' : ''}
          confirmLabel="Apply"
          cancelLabel="Keep as is"
          onConfirm={applyUnaddedPlan}
          onCancel={() => setUnaddedPlan(null)}
        >
          {unaddedPlan && (
            <div className="space-y-4 text-sm">
              {unaddedPlan.remove.length > 0 && (
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-red-400 mb-2">Removing</p>
                  <ul className="space-y-1">
                    {unaddedPlan.remove.map((t) => (
                      <li key={t.uri} className="flex justify-between gap-3 text-neutral-300">
                        <span className="truncate"><span className="text-white">{t.name}</span>{t.artist && <span className="text-neutral-500"> · {t.artist}</span>}</span>
                        <span className="shrink-0 text-xs text-neutral-500">{t.reason === 'unliked' ? 'unliked' : 'now in a playlist'}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {unaddedPlan.add.length > 0 && (
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-[var(--brand-light)] mb-2">Adding</p>
                  <ul className="space-y-1">
                    {unaddedPlan.add.map((t) => (
                      <li key={t.uri} className="truncate text-neutral-300">
                        <span className="text-white">{t.name}</span>{t.artist && <span className="text-neutral-500"> · {t.artist}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </ConfirmDialog>
        <PlaylistFormDialog
          open={editDialogOpen}
          title="Edit playlist"
          submitLabel="Save changes"
          initialName={view.name}
          initialDescription={fromSpotifyText(view.description)}
          initialImageUrl={view.images?.[0]?.url || ''}
          initialPublic={Boolean(view.public)}
          initialCollaborative={Boolean(view.collaborative)}
          onSubmit={handleUpdatePlaylist}
          onCancel={() => setEditDialogOpen(false)}
          isSubmitting={isUpdatingPlaylist}
        />
        {!playlist && <SkeletonRows count={8} />}
        {playlist && totalRows === 0 && (
          <div className="py-16 text-center">
            <p className="text-white font-bold text-lg">Nothing here yet</p>
            <p className="text-neutral-400 text-sm mt-1">
              {ownsPlaylist
                ? 'Drag songs in from another playlist, or find some to add.'
                : 'This playlist has no songs.'}
            </p>
            {ownsPlaylist && (
              <button
                type="button"
                onClick={() => setCurrentView('browse')}
                className="mt-4 px-5 py-2 rounded-full bg-white text-black text-sm font-bold hover:scale-105 transition-transform"
              >
                Find songs
              </button>
            )}
          </div>
        )}
        {rows.slice(0, visibleCount).map(({ item, i: index }) => {
          if (!item || !item.track) return null;
          const track = item.track;

          const isCurrentTrack = isSameTrack(track, currentPlayingTrack);
          const unplayable = isUnplayable(track, country);

          // Advanced Group Adjacency Logic for the Seamless Glow Effect
          const adderId = item.added_by?.id;
          let isFirstInGroup = true;
          let isLastInGroup = true;

          if (isCollaborative) {
            const prevItem = sortedTracks[index - 1];
            const nextItem = sortedTracks[index + 1];
            
            const prevAdderId = prevItem?.track ? prevItem.added_by?.id : null;
            const nextAdderId = nextItem?.track ? nextItem.added_by?.id : null;

            isFirstInGroup = adderId !== prevAdderId;
            isLastInGroup = adderId !== nextAdderId;
          }

          const collaboratorProfile = collaborators[adderId];

          const bgHoverClass = isCollaborative 
            ? 'bg-[hsla(var(--track-hue),40%,40%,0.02)] hover:bg-[hsla(var(--track-hue),40%,40%,0.06)]'
            : 'hover:bg-neutral-800/50';

          let radiusClass = 'rounded-md';
          let marginClass = '';
          
          if (isCollaborative) {
            if (isFirstInGroup && isLastInGroup) {
              radiusClass = 'rounded-lg';
              marginClass = 'my-1.5';
            } else if (isFirstInGroup) {
              radiusClass = 'rounded-t-lg rounded-b-none';
              marginClass = 'mt-1.5';
            } else if (isLastInGroup) {
              radiusClass = 'rounded-b-lg rounded-t-none';
              marginClass = 'mb-1.5';
            } else {
              radiusClass = 'rounded-none';
              marginClass = '';
            }
          }

          const away = sortedAway[track.uri];
          if (away) {
            return (
              <div key={`${track.id}-${index}-away`} className="relative overflow-hidden rounded-md bg-white/5 px-4 py-3 my-0.5 flex items-center gap-4 text-sm animate-fade-in">
                <div className="flex-1 min-w-0 text-neutral-300 truncate">
                  <span className="text-white font-medium">{track.name}</span>
                  {away.removed ? ' removed' : <> moved to <span className="text-white font-medium">{away.playlistName}</span></>}
                </div>
                <button
                  type="button"
                  onClick={() => undoSort(item)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10 shrink-0"
                >
                  <Undo2 className="w-3.5 h-3.5" /> Undo
                </button>
                <div
                  key={away.expiresAt}
                  className="absolute left-0 bottom-0 h-0.5 bg-[var(--brand-mid)] animate-[undo-drain_linear_forwards]"
                  style={{ animationDuration: `${UNDO_MS}ms` }}
                />
              </div>
            );
          }

          return (
            <div
              key={`${track.id}-${index}`}
              onClick={(e) => (selection.wantsSelect(e) && track.uri ? selection.toggle(track.uri, { range: e.shiftKey }) : handleTrackSelect(index))}
              {...rowButtonProps(() => handleTrackSelect(index))}
              onContextMenu={(e) => handleRightClick(e, track, item)}
              aria-selected={selection.active ? selection.has(track.uri) : undefined}
              draggable={canReorder && !selection.active}
              onDragStart={canReorder ? (e) => {
                dragRow.current = index;
                e.dataTransfer.effectAllowed = 'all';
                e.dataTransfer.setData('application/x-jomify-row', String(index));
                e.dataTransfer.setData(TRACK_DRAG_TYPE, track.uri);
                e.dataTransfer.setData('text/plain', track.uri);
                setTimeout(() => setDraggedItem({ type: 'track', uri: track.uri }), 0);
              } : undefined}
              onDragOver={canReorder ? (e) => {
                if (dragRow.current === null) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                const r = e.currentTarget.getBoundingClientRect();
                setDropAt(e.clientY < r.top + r.height / 2 ? index : index + 1);
              } : undefined}
              onDrop={canReorder ? (e) => {
                if (dragRow.current === null) return;
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                reorderTo(dragRow.current, e.clientY < r.top + r.height / 2 ? index : index + 1);
                dragRow.current = null; setDropAt(null);
              } : undefined}
              onDragEnd={canReorder ? () => { dragRow.current = null; setDropAt(null); setDraggedItem(null); } : undefined}
              style={collaboratorStyleFor(adderId, isCollaborative, isFirstInGroup, isLastInGroup)}
              aria-disabled={unplayable || undefined} data-tip={unplayable ? unplayableWhy(track, country) : undefined}
              title={unplayable ? 'Not available on Spotify' : undefined}
              className={`grid ${gridColumns} gap-3 md:gap-4 px-2 md:px-4 py-2.5 md:py-3 group text-sm items-center transition-colors cursor-pointer [content-visibility:auto] [contain-intrinsic-size:auto_72px] ${bgHoverClass} ${radiusClass} ${marginClass} ${unplayable ? 'opacity-45' : ''} ${selection.has(track.uri) ? 'bg-white/10 ring-1 ring-inset ring-white/20' : ''} ${dropAt === index ? 'shadow-[inset_0_2px_0_var(--brand-mid)]' : ''} ${dropAt === index + 1 && index === totalRows - 1 ? 'shadow-[inset_0_-2px_0_var(--brand-mid)]' : ''}`}
            >
              <div className="text-neutral-400 w-4 h-4 hidden md:flex items-center justify-center">
                {isCurrentTrack && !isCurrentTrackPaused ? (
                  <span className="text-[var(--brand-mid)] font-bold animate-pulse">🔊</span>
                ) : (
                  <>
                    <span className={`group-hover:hidden ${isCurrentTrack ? 'text-brand-gradient font-bold' : ''}`}>
                      {index + 1}
                    </span>
                    <Play className="w-4 h-4 text-white hidden group-hover:block fill-current" />
                  </>
                )}
              </div>
              
              <div className="w-10 h-10 md:w-12 md:h-12 rounded-md overflow-hidden flex-shrink-0">
                {track.album?.images?.[0]?.url ? (
                  <img src={artUrl(track.album.images, 48)} alt={track.name} width="48" height="48" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-neutral-800 flex items-center justify-center">🎵</div>
                )}
              </div>

              <div className="flex flex-col truncate pr-4">
                <span className={`font-medium truncate ${isCurrentTrack ? 'text-brand-gradient' : 'text-white'}`}>
                  {track.name}
                </span>
                <div className="text-neutral-400 text-xs truncate flex items-center gap-1">
                  {track.artists.map((artist, aIdx) => (
                    <span key={artist.id || aIdx} className="inline-flex items-center">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (artist.id) {
                            navigateToArtist(artist.id);
                          }
                        }}
                        className="hover:underline hover:text-white transition-colors text-left truncate pointer-coarse:pointer-events-none"
                      >
                        {artist.name}
                      </button>
                      {aIdx < track.artists.length - 1 && <span className="mr-1">,</span>}
                    </span>
                  ))}
                </div>
                {isUnaddedSongsPlaylist && (
                  <SortIntoChips
                    suggestions={suggestionsByTrack.get(track.id) || []}
                    targets={sortTargets}
                    busy={sortingUri === track.uri}
                    onPick={(playlistId) => sortTrackInto(item, playlistId)}
                  />
                )}
              </div>
              
              <div className="hidden md:block truncate pr-4">
                {track.album?.id ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigateToAlbum(track.album.id);
                    }}
                    className="text-neutral-400 hover:text-white hover:underline transition-colors text-left truncate block w-full"
                  >
                    {track.album.name}
                  </button>
                ) : (
                  <span className="text-neutral-400 truncate">{track.album?.name}</span>
                )}
              </div>

              <div className="hidden md:block text-neutral-400 text-xs truncate">
                {formatDateAdded(item.added_at)}
              </div>

              {/* Collborator Tag Column */}
              {isCollaborative && (
                <div className="hidden md:flex items-center truncate pr-4">
                  <UserChip userId={adderId} fallbackName={collaboratorProfile?.display_name || adderId} size="sm" />
                </div>
              )}
              
              <div 
                key={track.id}
                draggable="true"
                onDragStart={(e) => {
                  e.stopPropagation();
                  e.dataTransfer.effectAllowed = 'all'; 
                  e.dataTransfer.setData('text/plain', track.uri);
                  setTimeout(() => setDraggedItem({ type: 'track', uri: track.uri }), 0);
                }}
                onDragEnd={() => setDraggedItem(null)}
                onContextMenu={(e) => {
                  // The same menu as the rest of the row; this cell used to open one without
                  // the reorder entries
                  e.stopPropagation();
                  handleRightClick(e, track, item);
                }}
                className="flex items-center justify-between gap-2 md:gap-4 w-full h-full"
              >
                <LikeButton trackId={track.id} />
                <span className="hidden md:inline text-neutral-400 w-8 text-right">{formatTime(track.duration_ms)}</span>
                <MoreButton onOpen={(e) => handleRightClick(e, track, item)} />
              </div>
            </div>
          );
        })}
        {(visibleCount < totalRows || nextPageUrl) && (
          <div ref={sentinelRef} className="py-6 text-center text-xs text-neutral-500">
            {Math.max(0, (view.tracks.total || totalRows) - Math.min(visibleCount, totalRows))} more…
          </div>
        )}
        {needle && rows.length === 0 && <p className="py-10 text-center text-sm text-neutral-500">Nothing in this playlist matches "{find.trim()}".</p>}
      </div>

      {/* Find something to add: your own playlists, as Spotify's "Let's find something for your playlist" */}
      {ownsPlaylist && playlist && (
        <div className="mt-10 px-1 md:px-4 max-w-2xl">
          <h3 className="text-lg font-bold text-white mb-1">Find something to add</h3>
          <p className="text-sm text-neutral-500 mb-3">Search Spotify and add straight into this playlist.</p>
          <label className="relative block">
            <Search className="w-4 h-4 text-neutral-500 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={addQuery}
              onChange={(e) => setAddQuery(e.target.value)}
              placeholder="Songs or artists"
              aria-label="Find something to add"
              className="w-full bg-neutral-900 border border-white/10 rounded-full py-2.5 pl-11 pr-4 text-sm text-white placeholder:text-neutral-500 outline-none focus:border-[var(--brand-mid)]"
            />
          </label>
          {addSearching && <p className="mt-3 text-xs text-neutral-500">Searching…</p>}
          {shownAddResults && !addSearching && shownAddResults.length === 0 && <p className="mt-3 text-xs text-neutral-500">Nothing found.</p>}
          {shownAddResults && shownAddResults.length > 0 && (
            <ul className="mt-3 divide-y divide-white/5 rounded-2xl border border-white/10 overflow-hidden">
              {shownAddResults.slice(0, 10).map((t) => {
                const already = (playlist.tracks?.items || []).some((it) => it.track?.uri === t.uri);
                return (
                  <li key={t.id} className="flex items-center gap-3 px-3 py-2 bg-neutral-900/60">
                    <img src={artUrl(t.album?.images, 40)} alt="" width="40" height="40" loading="lazy" decoding="async" className="w-10 h-10 rounded object-cover bg-neutral-800" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-white truncate">{t.name}</p>
                      <p className="text-xs text-neutral-400 truncate">{(t.artists || []).map((a) => a.name).join(', ')} · {t.album?.name}</p>
                    </div>
                    <button type="button" onClick={() => addFound(t)} disabled={already} className="rounded-full border border-white/15 px-3 py-1.5 text-xs font-bold text-white hover:bg-white/10 disabled:opacity-50 disabled:cursor-default">
                      {already ? 'Added' : 'Add'}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      <SelectionBar
        count={selection.count}
        tracks={selectedTracks}
        onClear={selection.clear}
        onRemove={ownsPlaylist ? removeSelected : undefined}
        onRemovedMany={markRemovedMany}
        sourcePlaylistId={activePlaylistId}
      />
    </div>
  );
}