import { artUrl } from '../../utils/images';
import MoreButton, { CardMoreButton } from '../../components/MoreButton';
import { formatTime } from '../../utils/formatTime';
import { Play, UserPlus, UserCheck, Loader2, Share2, Heart, Shuffle } from 'lucide-react';
import LikeButton from '../../components/LikeButton';
import { SkeletonHeader, SkeletonRows, SkeletonCards } from '../../components/Skeleton';
import { rowButtonProps } from '../../utils/a11y';
import { isSameTrack } from '../../utils/spotifyUri';
import { useArtistView } from './useArtistView';

export default function Artist() {
  const {
    setContextMenu, navigateToAlbum, currentPlayingTrack, artist, topTracks, albums, albumsOnly, singles, shownAlbums, tab, pickTab, tabLoading,
    likedHere, likedProgress, loadLikedHere, playLikedHere, loading, error, retry,
    isFollowed, followBusy, toggleFollow, openArtistMenu, handleTrackPlay, playArtist, shufflePlay, share
  } = useArtistView();

  // Back navigation is the global button in MainLayout; this view used to render a second one
  // 64px below it doing the identical thing.
  if (!artist) {
    return (
      <div className="flex flex-col pb-8">
        {loading.artist ? (
          <>
            <SkeletonHeader round />
            <SkeletonRows count={6} />
          </>
        ) : (
          <div className="mt-8 max-w-xl rounded-3xl border border-white/10 bg-neutral-900/60 p-8 animate-fade-in">
            <p className="text-xs font-bold uppercase tracking-widest text-neutral-400 mb-2">Artist</p>
            <p className="text-neutral-300 text-sm">{error || "Couldn't load this artist."}</p>
            <button type="button" onClick={retry} className="mt-4 inline-flex items-center rounded-full border border-white/15 px-5 py-2 text-sm font-bold text-white hover:bg-white/5 transition-colors">
              Try again
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col pb-8">
      {/* Artist Header */}
      <div className="flex flex-row items-center md:items-end gap-4 md:gap-6 mb-6 md:mb-12">
        <div className="w-24 h-24 md:w-48 md:h-48 bg-neutral-700 rounded-full overflow-hidden shadow-2xl flex-shrink-0">
          {artist.images?.[0]?.url && (
            <img src={artist.images[0].url} alt={artist.name} className="w-full h-full object-cover" />
          )}
        </div>
        <div className="min-w-0">
          <p className="hidden md:block text-sm font-bold text-neutral-400 uppercase tracking-widest mb-2">Artist</p>
          <h1 className="text-2xl md:text-6xl font-extrabold text-white tracking-tighter mb-1 md:mb-4 break-words line-clamp-2 md:line-clamp-none">{artist.name}</h1>
          {/* Spotify no longer sends follower counts to apps like Jomify; shown only if present */}
          {artist.followers?.total != null && (
            <p className="text-sm md:text-base text-neutral-400 font-medium mb-2 md:mb-4">
              {artist.followers.total.toLocaleString()} followers
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 md:gap-3 mb-3 md:mb-4">
            <button
              type="button"
              onClick={playArtist}
              aria-label={`Play ${artist.name}`}
              className="w-11 h-11 md:w-12 md:h-12 bg-brand-gradient text-white rounded-full flex items-center justify-center hover:scale-105 active:scale-95 transition-transform shadow-xl shrink-0"
            >
              <Play className="w-5 h-5 fill-current ml-0.5" />
            </button>
            <button type="button" onClick={shufflePlay} aria-label="Shuffle play" title="Shuffle play" className="w-10 h-10 rounded-full border border-white/10 flex items-center justify-center text-neutral-300 hover:text-white hover:bg-white/10 transition-colors">
              <Shuffle className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={toggleFollow}
              disabled={followBusy}
              aria-pressed={isFollowed}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold transition-all disabled:opacity-60 ${isFollowed ? 'bg-white/10 border border-white/15 text-white hover:bg-white/15' : 'border border-white/20 text-white hover:bg-white/10'}`}
            >
              {followBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : isFollowed ? <UserCheck className="w-4 h-4 text-[var(--brand-mid)]" /> : <UserPlus className="w-4 h-4" />}
              {isFollowed ? 'Following' : 'Follow'}
            </button>
            <button type="button" onClick={share} aria-label="Share" title="Share" className="w-10 h-10 rounded-full border border-white/10 flex items-center justify-center text-neutral-300 hover:text-white hover:bg-white/10 transition-colors">
              <Share2 className="w-4 h-4" />
            </button>
            <MoreButton onOpen={openArtistMenu} label={`Options for ${artist.name}`} className="!flex" />
          </div>
          {artist.genres?.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {artist.genres.slice(0, 5).map((genre) => (
                <span key={genre} className="px-2.5 py-0.5 md:px-3 md:py-1 rounded-full bg-white/5 border border-white/10 text-brand-gradient text-xs md:text-sm font-semibold">
                  {genre}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Top Tracks */}
      {loading.tracks && <div className="mb-12"><SkeletonRows count={5} /></div>}
      {topTracks.length > 0 && (
        <div className="mb-12">
          <h2 className="text-xl md:text-2xl font-bold text-white mb-3 md:mb-6">Popular Tracks</h2>
          <div className="flex flex-col space-y-1">
            {topTracks.slice(0, 10).map((track) => {
              const isCurrentTrack = isSameTrack(track, currentPlayingTrack);

                return (
                  <div
                    key={track.id}
                    onClick={() => handleTrackPlay(track.uri)}
                    {...rowButtonProps(() => handleTrackPlay(track.uri))}
                    onContextMenu={(e) => { e.preventDefault(); setContextMenu({ type: 'track', x: e.pageX, y: e.pageY, track }); }}
                    className="flex items-center justify-between px-4 py-3 hover:bg-neutral-800/50 rounded-md group text-sm cursor-pointer transition-colors"
                  >
                  <div className="flex items-center space-x-4 truncate pr-4">
                    <div className="relative w-12 h-12 bg-neutral-800 rounded flex-shrink-0 flex items-center justify-center">
                      <img src={artUrl(track.album.images, 48)} alt="" width="48" height="48" loading="lazy" decoding="async" className="w-full h-full object-cover rounded" />
                      <div className="absolute inset-0 bg-black/40 hidden group-hover:flex items-center justify-center rounded">
                        <Play className="w-4 h-4 text-white fill-current" />
                      </div>
                    </div>
                    <div className="truncate">
                      <p className={`font-medium truncate ${isCurrentTrack ? 'text-brand-gradient' : 'text-white'}`}>
                        {track.name}
                      </p>
                      <p className="text-neutral-400 text-xs truncate">
                        {track.album.name}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-4">
                    <LikeButton trackId={track.id} />
                    <span className="hidden md:inline text-neutral-400 text-xs w-8 text-right">{formatTime(track.duration_ms)}</span>
                    <MoreButton onOpen={(e) => setContextMenu({ type: 'track', x: e.pageX, y: e.pageY, track })} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Your liked songs by this artist: Spotify doesn't offer it, so it is Jomify's own */}
      {!loading.tracks && (
        <div className="mb-12">
          <div className="flex items-center justify-between gap-4 mb-3 md:mb-6">
            <h2 className="text-xl md:text-2xl font-bold text-white flex items-center gap-2"><Heart className="w-5 h-5 fill-[var(--brand-mid)] text-[var(--brand-mid)]" /> Your liked songs by {artist.name}</h2>
            {likedHere && likedHere.length > 0 && (
              <button type="button" onClick={() => playLikedHere(0)} className="text-sm font-bold text-neutral-300 hover:text-white">Play all {likedHere.length}</button>
            )}
          </div>
          {likedHere === null ? (
            likedProgress ? (
              <p className="text-sm text-neutral-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Reading your liked songs… {likedProgress.total ? `${likedProgress.have.toLocaleString()} of ${likedProgress.total.toLocaleString()}` : ''}</p>
            ) : (
              <button type="button" onClick={loadLikedHere} className="rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-white hover:bg-white/5">
                Find them
                <span className="block text-xs font-normal text-neutral-500">Reads your whole Liked Songs once this session</span>
              </button>
            )
          ) : likedHere.length === 0 ? (
            <p className="text-sm text-neutral-500">None yet.</p>
          ) : (
            <div className="flex flex-col space-y-1">
              {likedHere.slice(0, 50).map((track, index) => (
                <div
                  key={track.id}
                  onClick={() => playLikedHere(index)}
                  {...rowButtonProps(() => playLikedHere(index))}
                  onContextMenu={(e) => { e.preventDefault(); setContextMenu({ type: 'track', x: e.pageX, y: e.pageY, track }); }}
                  className="flex items-center justify-between px-4 py-2.5 hover:bg-neutral-800/50 rounded-md group text-sm cursor-pointer transition-colors"
                >
                  <div className="flex items-center space-x-4 truncate pr-4">
                    <div className="w-10 h-10 bg-neutral-800 rounded flex-shrink-0 overflow-hidden">
                      {track.album?.images?.[0]?.url && <img src={artUrl(track.album.images, 48)} alt="" width="40" height="40" loading="lazy" decoding="async" className="w-full h-full object-cover" />}
                    </div>
                    <div className="truncate">
                      <p className={`font-medium truncate ${isSameTrack(track, currentPlayingTrack) ? 'text-brand-gradient' : 'text-white'}`}>{track.name}</p>
                      <p className="text-neutral-400 text-xs truncate">{track.album?.name}</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-4">
                    <LikeButton trackId={track.id} />
                    <span className="hidden md:inline text-neutral-400 text-xs w-8 text-right">{formatTime(track.duration_ms)}</span>
                    <MoreButton onOpen={(e) => setContextMenu({ type: 'track', x: e.pageX, y: e.pageY, track })} />
                  </div>
                </div>
              ))}
              {likedHere.length > 50 && <p className="px-4 py-2 text-xs text-neutral-500">{likedHere.length - 50} more</p>}
            </div>
          )}
        </div>
      )}

      {/* Discography */}
      {loading.albums && !loading.tracks && (
        <div>
          <h2 className="text-2xl font-bold text-white mb-6">Albums</h2>
          <SkeletonCards count={5} gridClass="grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4" />
        </div>
      )}
      {albums.length > 0 && (
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-6">
            <h2 className="text-2xl font-bold text-white mr-2">Discography</h2>
            {[['album', 'Albums', albumsOnly.length], ['single', 'Singles and EPs', singles.length], ['appears_on', 'Appears on', null], ['compilation', 'Compilations', null]].map(([id, label, count]) => (
              (count === null || count > 0) && (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => pickTab(id)}
                  className={`px-3.5 py-1.5 rounded-full text-sm font-semibold transition-colors ${tab === id ? 'bg-white text-black' : 'bg-white/5 border border-white/10 text-neutral-300 hover:bg-white/10'}`}
                >
                  {label}{count ? ` ${count}` : ''}
                </button>
              )
            ))}
          </div>
          {tabLoading && <SkeletonCards count={5} gridClass="grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4" />}
          {!tabLoading && shownAlbums.length === 0 && <p className="text-sm text-neutral-500">Nothing in this group.</p>}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {shownAlbums.map((album) => (
              <div 
                key={album.id}
                onClick={() => navigateToAlbum(album.id)}
                {...rowButtonProps(() => navigateToAlbum(album.id))}
                onContextMenu={(e) => { e.preventDefault(); setContextMenu({ type: 'album', x: e.pageX, y: e.pageY, albumId: album.id, album }); }}
                className="bg-neutral-800/30 p-4 rounded-xl cursor-pointer hover:bg-neutral-800/60 transition-colors group"
              >
                <div className="relative aspect-square bg-neutral-700 rounded-md mb-3 overflow-hidden shadow-md">
                  {album.images?.[0]?.url && (
                    <img src={artUrl(album.images, 300)} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                  )}
                  <CardMoreButton label={`Options for ${album.name}`} onOpen={(e) => setContextMenu({ type: 'album', x: e.pageX, y: e.pageY, albumId: album.id, album })} />
                </div>
                <p className="text-white text-sm font-bold truncate w-full">{album.name}</p>
                <p className="text-neutral-400 text-xs truncate w-full mt-0.5">{album.release_date?.split('-')[0]}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
