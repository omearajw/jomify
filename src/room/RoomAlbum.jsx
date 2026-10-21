import { useEffect } from 'react';
import { Play } from 'lucide-react';
import { getBlurredBackdrop } from '../utils/blurBackdrop';
import { useRoomStore } from './roomStore';
import { useAlbumView, ALBUM_KIND, formatReleaseDate } from '../views/Album/useAlbumView';
import { useUserStore } from '../store/userStore';
import LikeButton from '../components/LikeButton';
import { formatTime } from '../utils/formatTime';
import { rowButtonProps } from '../utils/a11y';
import { isSameTrack, isUnplayable, unplayableWhy, TRACK_DRAG_TYPE } from '../utils/spotifyUri';
import Artists from './Artists';
import { ShuffleToggle } from './ModeToggles';

// An album on the room's language: the record-sleeve head of the open playlist (RoomPlaylist.jsx)
// with the album's facts, then its songs on hairlines, split by disc where it has several, and
// the label's lines at the foot. The logic is useAlbumView, shared with the old page.

const Mono = ({ children, className = '' }) => <span className={`room-mono ${className}`}>{children}</span>;
const Word = ({ onClick, disabled, lit, tip, children }) => <button type="button" onClick={onClick} disabled={disabled} data-tip={tip} aria-pressed={lit || undefined} className="ui-word">{children}</button>;

// Spotify's copyright texts sometimes carry their own mark and sometimes not
const withMark = ({ text, type }) => (/^(©|℗|\([cp]\))/i.test(text.trim()) ? text : `${type === 'P' ? '℗' : '©'} ${text}`);

export default function RoomAlbum() {
  const {
    currentPlayingTrack, isCurrentTrackPaused, country, album, shown, tracks, loading, error, restError, retry, totalLength, discCount,
    handleTrackPlay, playAlbum, openTrackMenu, isSaved, saving, handleToggleSave
  } = useAlbumView();
  const heartsAlways = useUserStore((s) => (s.playbackSettings?.rowHearts || 'always') === 'always');

  const coverUrl = shown?.images?.[0]?.url || '';
  // The cover's light is drawn by the layer from Zen's pre-blurred copy, as for a playlist
  // (see RoomPlaylist.jsx for why it is not a CSS blur)
  const setLight = useRoomStore((s) => s.setLight);
  useEffect(() => {
    let gone = false;
    getBlurredBackdrop(coverUrl).then((url) => { if (!gone) setLight(url || null); });
    return () => { gone = true; setLight(null); };
  }, [coverUrl, setLight]);

  if (loading && !shown) return <p className="room-mono pt-6 text-[var(--room-faint)]" style={{ fontFamily: 'var(--font-room)' }}>Loading</p>;
  if (!shown) {
    return (
      <div className="max-w-xl pt-6" style={{ fontFamily: 'var(--font-room)' }}>
        <Mono className="text-[var(--room-faint)]">Album</Mono>
        <p className="mt-3 text-[13px] text-[var(--room-dim)]">{error || 'Album not found'}</p>
        {error !== 'Album not found' && <p className="mt-5"><Word onClick={retry}>Try again</Word></p>}
      </div>
    );
  }

  const count = shown.total_tracks || tracks.length;
  const facts = [
    ALBUM_KIND[shown.album_type] || 'Album',
    shown.release_date ? shown.release_date.slice(0, 4) : null,
    count ? `${count.toLocaleString()} ${count === 1 ? 'song' : 'songs'}` : null,
    totalLength || null
  ].filter(Boolean).join(' · ');
  const released = shown.release_date ? formatReleaseDate(shown.release_date, shown.release_date_precision) : '';
  const copyrights = (album?.copyrights || []).filter((c) => c?.text);

  return (
    <div className="relative min-h-full pb-10" style={{ fontFamily: 'var(--font-room)' }}>

      <header className="relative flex items-end gap-7 pt-4 @max-md:flex-col @max-md:items-start @max-md:gap-4">
        <div className="h-[168px] w-[168px] shrink-0 overflow-hidden rounded-[5px] @max-md:h-[132px] @max-md:w-[132px] bg-white/5 shadow-[0_40px_80px_-30px_rgba(0,0,0,0.8)]">
          {coverUrl && <img src={coverUrl} alt="" className="h-full w-full object-cover" draggable="false" />}
        </div>
        <div className="min-w-0 flex-1 pb-1">
          <Mono className="text-[var(--room-faint)]">{facts}</Mono>
          <h1 className="mt-2 text-[34px] @max-md:text-[26px] font-semibold leading-[1.05] tracking-[-0.025em] text-[var(--room-paper)] [text-wrap:balance] line-clamp-2">{shown.name}</h1>
          <Artists artists={shown.artists} className="mt-2 block text-[14px] text-[var(--room-dim)]" />
          {restError && <p className="room-mono mt-2 flex items-center gap-3 text-amber-300/80">{restError}<Word onClick={retry}>Try again</Word></p>}
          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
            <button type="button" onClick={playAlbum} aria-label={`Play ${shown.name}`} className="grid h-[46px] w-[46px] place-items-center rounded-full bg-[var(--room-paper)] text-[#0a0810] transition-transform hover:scale-105 active:scale-95">
              <Play className="ml-0.5 h-[18px] w-[18px] fill-current" />
            </button>
            <ShuffleToggle />
            <span className="ml-1 flex flex-wrap items-center gap-x-4 gap-y-2">
              <Word onClick={handleToggleSave} disabled={saving} lit={isSaved} tip={isSaved ? 'In your library. Press to remove it' : 'Save to your library'}>{isSaved ? 'Saved' : 'Save'}</Word>
            </span>
          </div>
        </div>
      </header>

      <div className="mt-8 border-b border-[var(--room-hair)] @max-md:mt-6" />

      <div className="room-rise-list mt-1">
        {loading && tracks.length === 0 && <p className="room-mono py-6 text-[var(--room-faint)]">Loading the songs</p>}
        {tracks.map((track, index) => {
          const current = isSameTrack(track, currentPlayingTrack);
          const unplayable = isUnplayable(track, country);
          const disc = track.disc_number || 1;
          const startsDisc = discCount > 1 && (index === 0 || (tracks[index - 1].disc_number || 1) !== disc);
          const number = discCount > 1 ? (track.track_number || index + 1) : index + 1;
          return (
            <div key={`${track.id}-${index}`} className="contents">
              {startsDisc && <p className={`room-mono pb-2 text-[var(--room-faint)] ${index === 0 ? 'pt-3' : 'pt-7'}`}>Disc {disc}</p>}
              <div
                onClick={() => handleTrackPlay(track.uri)}
                {...rowButtonProps(() => handleTrackPlay(track.uri))}
                onContextMenu={(e) => { e.preventDefault(); openTrackMenu(e, track); }}
                aria-disabled={unplayable || undefined} data-tip={unplayable ? unplayableWhy(track, country) : undefined}
                title={unplayable ? 'Not available on Spotify' : undefined}
                draggable
                onDragStart={(e) => { e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData(TRACK_DRAG_TYPE, track.uri); e.dataTransfer.setData('text/plain', track.uri); }}
                className={`group grid cursor-pointer grid-cols-[28px_minmax(0,1fr)_24px_44px] @max-md:grid-cols-[22px_minmax(0,1fr)_36px] @max-md:gap-2.5 items-center gap-3 py-[9px] text-[13px] transition-colors [content-visibility:auto] [contain-intrinsic-size:auto_50px] hover:bg-white/[0.03] ${unplayable ? 'opacity-40' : ''}`}
                style={{ borderTop: '1px solid var(--room-hair)', transitionDuration: 'var(--room-mid)' }}
              >
                <span className="room-mono flex items-center justify-center text-[var(--room-faint)]">
                  {current && !isCurrentTrackPaused ? <span className="h-1.5 w-1.5 rounded-full bg-[var(--room-paper)] animate-pulse" aria-label="Playing" />
                    : <><span className="group-hover:hidden">{number}</span><Play className="hidden h-3 w-3 fill-current text-[var(--room-paper)] group-hover:block" /></>}
                </span>
                <span className="min-w-0 pr-3">
                  <span className={`block truncate ${current ? 'font-semibold text-[var(--room-paper)]' : 'font-medium text-[var(--room-paper)]/90'}`}>{track.name}</span>
                  <Artists artists={track.artists} inRow className="block truncate text-[11.5px] text-[var(--room-dim)]" />
                </span>
                <span className={`flex items-center justify-center [&_svg]:h-4 [&_svg]:w-4 room-like ${heartsAlways ? '' : 'opacity-0 transition-opacity group-hover:opacity-100 pointer-coarse:opacity-100'}`}><LikeButton trackId={track.id} /></span>
                <Mono className="text-right text-[var(--room-faint)] @max-md:hidden">{formatTime(track.duration_ms)}</Mono>
              </div>
            </div>
          );
        })}
      </div>

      {(released || copyrights.length > 0 || album?.label) && (
        <div className="mt-10 space-y-1 text-[11px] leading-relaxed text-[var(--room-faint)]">
          {released && <p>Released {released}</p>}
          {copyrights.map((c, k) => <p key={k}>{withMark(c)}</p>)}
          {album?.label && <p>{album.label}</p>}
        </div>
      )}
    </div>
  );
}
