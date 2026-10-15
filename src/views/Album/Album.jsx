import MoreButton from '../../components/MoreButton';
import { SkeletonHeader, SkeletonRows } from '../../components/Skeleton';
import { formatTime } from '../../utils/formatTime';
import { Plus, Check, Loader2, Disc3, Play, Shuffle } from 'lucide-react';
import LikeButton from '../../components/LikeButton';
import TrackArtists from '../../components/TrackArtists';
import { rowButtonProps } from '../../utils/a11y';
import { isSameTrack, isUnplayable, unplayableWhy } from '../../utils/spotifyUri';
import { useAlbumView, ALBUM_KIND, formatReleaseDate } from './useAlbumView';

export default function Album() {
  const {
    currentAlbumId, setContextMenu, currentPlayingTrack, country, shown, tracks, loading, error, restError, retry,
    totalLength, discCount, handleTrackPlay, playAlbum, shuffleAlbum, isSaved, saving, handleToggleSave
  } = useAlbumView();

  if (loading && !shown) {
    return (
      <div className="flex flex-col pb-8">
        <SkeletonHeader />
        <SkeletonRows count={8} art={false} />
      </div>
    );
  }

  // Back navigation is the global button in MainLayout; this view used to render a second one
  // 64px below it doing the identical thing.
  if (!shown) {
    return (
      <div className="flex flex-col pb-8">
        <p className="text-neutral-400">{error || 'Album not found'}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col pb-8">
      {/* Album Header */}
      <div className="flex flex-row items-center md:items-end gap-4 md:gap-6 mb-6 md:mb-12">
        <div className="w-24 h-24 md:w-48 md:h-48 bg-neutral-700 rounded-lg overflow-hidden shadow-2xl flex-shrink-0">
          {shown.images?.[0]?.url && (
            <img src={shown.images[0].url} alt={shown.name} className="w-full h-full object-cover" />
          )}
        </div>
        <div className="min-w-0">
          <p className="hidden md:block text-sm font-bold text-neutral-400 uppercase tracking-widest mb-2">{ALBUM_KIND[shown.album_type] || 'Album'}</p>
          <h1 className="text-2xl md:text-6xl font-extrabold text-white tracking-tighter mb-1 md:mb-4 break-words line-clamp-2 md:line-clamp-none">{shown.name}</h1>
          <div className="text-sm md:text-base text-neutral-400 font-medium md:mb-4">
            <p>
              By{' '}
              <TrackArtists artists={shown.artists} className="text-white" linkClassName="hover:underline" />
            </p>
            <p className="mt-0.5 md:mt-2">
              <span className="md:hidden">{ALBUM_KIND[shown.album_type] || 'Album'} • </span>
              {shown.release_date ? `${formatReleaseDate(shown.release_date, shown.release_date_precision)} • ` : ''}
              {shown.total_tracks} {shown.total_tracks === 1 ? 'song' : 'songs'}
              {totalLength && `, ${totalLength}`}
            </p>
            <div className="mt-3 md:mt-4 flex flex-wrap items-center gap-2 md:gap-3">
            <button
              type="button"
              onClick={playAlbum}
              aria-label={`Play ${shown.name}`}
              className="w-11 h-11 md:w-12 md:h-12 bg-brand-gradient text-white rounded-full flex items-center justify-center hover:scale-105 active:scale-95 transition-transform shadow-xl shrink-0"
            >
              <Play className="w-5 h-5 fill-current ml-0.5" />
            </button>
            <button
              type="button"
              onClick={shuffleAlbum}
              aria-label="Shuffle play"
              title="Shuffle play"
              className="w-10 h-10 rounded-full border border-white/10 flex items-center justify-center text-neutral-300 hover:text-white hover:bg-white/10 transition-colors"
            >
              <Shuffle className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleToggleSave}
              disabled={saving}
              aria-pressed={isSaved}
              className={`inline-flex items-center gap-2 px-3 py-1.5 md:px-4 md:py-2 rounded-full text-xs md:text-sm font-bold transition-all disabled:opacity-60 ${
                isSaved
                  ? 'bg-white/10 border border-white/15 text-white hover:bg-white/15'
                  : 'bg-brand-gradient text-white shadow-brand-glow hover:scale-105'
              }`}
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : isSaved ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              {isSaved ? 'In your library' : 'Save to library'}
            </button>
            </div>
          </div>
        </div>
      </div>

      {/* Album Tracks */}
      {loading && (
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-white mb-3 md:mb-6">Tracks</h2>
          <SkeletonRows count={8} art={false} />
        </div>
      )}
      {tracks.length > 0 && (
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-white mb-3 md:mb-6">Tracks</h2>
          {restError && (
            <p className="text-red-400 text-xs font-medium mb-3 flex items-center gap-3">
              {restError}
              <button type="button" onClick={retry} className="underline hover:text-white transition-colors">Try again</button>
            </p>
          )}
          <div className="flex flex-col space-y-1">
            {tracks.map((track, index) => {
              const isCurrentTrack = isSameTrack(track, currentPlayingTrack);
              const unplayable = isUnplayable(track, country);
              // Multi-disc albums get a heading where each disc starts, numbered per disc
              const disc = track.disc_number || 1;
              const startsDisc = discCount > 1 && (index === 0 || (tracks[index - 1].disc_number || 1) !== disc);
              const number = discCount > 1 ? (track.track_number || index + 1) : index + 1;

              return (
                <div key={track.id} className="contents">
                {startsDisc && (
                  <p className="flex items-center gap-2 px-4 pt-4 pb-2 text-xs font-bold uppercase tracking-widest text-neutral-400">
                    <Disc3 className="w-4 h-4" /> Disc {disc}
                  </p>
                )}
                <div
                  onClick={() => handleTrackPlay(track.uri)}
                  {...rowButtonProps(() => handleTrackPlay(track.uri))}
                  onContextMenu={(e) => { e.preventDefault(); setContextMenu({ type: 'track', x: e.pageX, y: e.pageY, track, sourceAlbumId: currentAlbumId }); }}
                  aria-disabled={unplayable || undefined} data-tip={unplayable ? unplayableWhy(track, country) : undefined}
                  title={unplayable ? 'Not available on Spotify' : undefined}
                  className={`flex items-center justify-between px-4 py-3 hover:bg-neutral-800/50 rounded-md group text-sm cursor-pointer transition-colors ${unplayable ? 'opacity-45' : ''}`}
                >
                  <div className="flex items-center space-x-4 truncate pr-4">
                    <span className="text-neutral-400 w-8 text-right">{number}</span>
                    <div className="truncate">
                      <p className={`font-medium truncate ${isCurrentTrack ? 'text-brand-gradient' : 'text-white'}`}>
                        {track.name}
                      </p>
                      <TrackArtists
                        artists={track.artists}
                        className="block text-neutral-400 text-xs truncate"
                        linkClassName="hover:underline hover:text-white pointer-coarse:pointer-events-none"
                      />
                    </div>
                  </div>
                  <div className="flex items-center space-x-4">
                    <LikeButton trackId={track.id} />
                    <span className="hidden md:inline text-neutral-400 text-xs w-8 text-right">{formatTime(track.duration_ms)}</span>
                    <MoreButton onOpen={(e) => setContextMenu({ type: 'track', x: e.pageX, y: e.pageY, track, sourceAlbumId: currentAlbumId })} />
                  </div>
                </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
