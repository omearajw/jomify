import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import { getBlurredBackdrop } from '../utils/blurBackdrop';
import { useRoomStore } from './roomStore';
import { useUserStore } from '../store/userStore';
import { useArtistView } from '../views/Artist/useArtistView';
import LikeButton from '../components/LikeButton';
import { formatTime } from '../utils/formatTime';
import { artUrl } from '../utils/images';
import { rowButtonProps } from '../utils/a11y';
import { isSameTrack, TRACK_DRAG_TYPE } from '../utils/spotifyUri';
import Artists from './Artists';
import { showPicture } from './picture';
import { ShuffleToggle } from './ModeToggles';

// An artist on the room's language (DESIGN.md §6, §11): the record-sleeve head with the artist
// round, as artists are everywhere in the room, then popular songs and your liked songs by them
// as rows on hairlines, then the discography as bare covers under group words. The logic is
// useArtistView, shared with the old page; this file is only the surface.

const Mono = ({ children, className = '' }) => <p className={`room-mono ${className}`}>{children}</p>;
const Word = ({ onClick, children, lit, disabled, title }) => <button type="button" onClick={onClick} disabled={disabled} title={title} aria-pressed={lit || undefined} className="ui-word">{children}</button>;
const Head = ({ children, right }) => (
  <div className="mt-10 mb-1 flex items-center justify-between gap-4 border-b border-[var(--room-hair)] pb-2 @max-md:mt-8">
    <Mono className="min-w-0 truncate text-[var(--room-faint)]">{children}</Mono>
    {right}
  </div>
);

// Its height eases to what is inside, so a shorter group draws the page up gently rather than
// snapping the scroll (the scroller clamps a frame at a time as this shrinks)
// The time grows with the distance: a phone's 3000px shrink in the time of a short one dragged the
// page past at ~230px a frame.
function EaseHeight({ children }) {
  const inner = useRef(null);
  const [box, setBox] = useState({ height: null, ms: 0 });
  useLayoutEffect(() => {
    const el = inner.current;
    const ro = new ResizeObserver(() => setBox((b) => {
      const height = el.offsetHeight;
      return b.height === height ? b : { height, ms: b.height === null ? 0 : Math.min(1000, 380 + Math.abs(height - b.height) * 0.2) };
    }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return <div className="room-ease-height overflow-hidden" style={{ height: box.height ?? 'auto', transitionDuration: `${box.ms}ms` }}><div ref={inner}>{children}</div></div>;
}

const KIND = { album: 'Album', single: 'Single', compilation: 'Compilation', appears_on: 'Appears on' };
const GROUPS = [['album', 'Albums'], ['single', 'Singles and EPs'], ['appears_on', 'Appears on'], ['compilation', 'Compilations']];

export default function RoomArtist() {
  const {
    setDraggedItem, navigateToAlbum, currentPlayingTrack, isCurrentTrackPaused, artist, topTracks, albums, albumsOnly, singles, shownAlbums, tab, pickTab, tabLoading,
    likedHere, likedProgress, loadLikedHere, playLikedHere, loading, error, retry,
    isFollowed, followBusy, toggleFollow, openArtistMenu, openTrackMenu, openAlbumMenu, handleTrackPlay, playArtist, playAlbum, share
  } = useArtistView();

  const imageUrl = artist?.images?.[0]?.url || '';
  // the artist's light behind the column, drawn by the layer as for a playlist's cover
  const setLight = useRoomStore((s) => s.setLight);
  useEffect(() => {
    let gone = false;
    getBlurredBackdrop(imageUrl).then((url) => { if (!gone) setLight(url || null); });
    return () => { gone = true; setLight(null); };
  }, [imageUrl, setLight]);
  const heartsAlways = useUserStore((s) => (s.playbackSettings?.rowHearts || 'always') === 'always');
  // The covers on screen. A group that is still loading keeps the last one up, dimmed, so the page
  // holds its place until there is something to show (Jack, 20 Oct: the grid emptied, the page
  // shrank and the scroll jumped up before the new group arrived)
  const shownKey = `${tab}:${shownAlbums.map((a) => a.id).join(',')}`;
  const [held, setHeld] = useState({ key: shownKey, list: shownAlbums });
  if (!tabLoading && held.key !== shownKey) setHeld({ key: shownKey, list: shownAlbums });
  const grid = tabLoading ? held.list : shownAlbums;
  // the covers rise in after a tab is picked, not when the page opens
  const [picked, setPicked] = useState(false);

  if (!artist) {
    if (loading.artist) return <Mono className="pt-6 text-[var(--room-faint)]">Loading</Mono>;
    return (
      <div className="max-w-xl pt-6" style={{ fontFamily: 'var(--font-room)' }}>
        <Mono className="text-[var(--room-faint)]">Artist</Mono>
        <p className="mt-3 text-[13px] leading-relaxed text-[var(--room-dim)]">{error || "Couldn't load this artist."}</p>
        <p className="mt-5"><Word onClick={retry}>Try again</Word></p>
      </div>
    );
  }

  // Spotify no longer sends follower counts to apps like Jomify; shown only if present
  const facts = ['Artist', artist.followers?.total != null ? `${artist.followers.total.toLocaleString()} followers` : null].filter(Boolean).join(' · ');
  const genres = (artist.genres || []).slice(0, 5);

  const row = (track, index, onPlay) => {
    const current = isSameTrack(track, currentPlayingTrack);
    return (
      <div
        key={`${track.id}-${index}`}
        onClick={onPlay}
        {...rowButtonProps(onPlay)}
        onContextMenu={(e) => { e.preventDefault(); openTrackMenu(e, track); }}
        draggable
        onDragStart={(e) => { e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData(TRACK_DRAG_TYPE, track.uri); e.dataTransfer.setData('text/plain', track.uri); setTimeout(() => setDraggedItem({ type: 'track', uri: track.uri }), 0); }}
        onDragEnd={() => setDraggedItem(null)}
        className="group grid cursor-pointer grid-cols-[28px_34px_minmax(0,1.3fr)_minmax(0,1fr)_24px_44px] @max-md:grid-cols-[22px_36px_minmax(0,1fr)_36px] @max-md:gap-2.5 items-center gap-3 py-[9px] text-[13px] transition-colors hover:bg-white/[0.03]"
        style={{ borderTop: index === 0 ? undefined : '1px solid var(--room-hair)', transitionDuration: 'var(--room-mid)' }}
      >
        <span className="room-mono flex items-center justify-center text-[var(--room-faint)]">
          {current && !isCurrentTrackPaused ? <span className="h-1.5 w-1.5 rounded-full bg-[var(--room-paper)] animate-pulse" aria-label="Playing" />
            : <><span className="group-hover:hidden">{index + 1}</span><Play className="hidden h-3 w-3 fill-current text-[var(--room-paper)] group-hover:block" /></>}
        </span>
        <span className="h-[34px] w-[34px] overflow-hidden rounded-[3px] bg-white/5">{track.album?.images?.[0]?.url && <img src={artUrl(track.album.images, 34)} alt="" width="34" height="34" loading="lazy" decoding="async" draggable="false" className="h-full w-full object-cover" />}</span>
        <span className="min-w-0 pr-3">
          <span className={`block truncate ${current ? 'font-semibold text-[var(--room-paper)]' : 'font-medium text-[var(--room-paper)]/90'}`}>{track.name}</span>
          <Artists artists={track.artists} inRow className="block truncate text-[11.5px] text-[var(--room-dim)]" />
        </span>
        <span className="min-w-0 truncate pr-3 text-[var(--room-dim)] @max-md:hidden">
          {track.album?.id ? <button type="button" onClick={(e) => { e.stopPropagation(); navigateToAlbum(track.album.id); }} className="block w-full truncate text-left hover:text-[var(--room-paper)]">{track.album.name}</button> : track.album?.name}
        </span>
        <span className={`room-like flex items-center justify-center [&_svg]:h-4 [&_svg]:w-4 ${heartsAlways ? '' : 'opacity-0 transition-opacity group-hover:opacity-100 pointer-coarse:opacity-100'}`}><LikeButton trackId={track.id} /></span>
        <Mono className="text-right text-[var(--room-faint)] @max-md:hidden">{formatTime(track.duration_ms)}</Mono>
      </div>
    );
  };

  const counts = { album: albumsOnly.length, single: singles.length, appears_on: null, compilation: null };

  return (
    <div className="relative min-h-full pb-10" style={{ fontFamily: 'var(--font-room)' }}>

      <header className="relative flex items-end gap-7 pt-4 @max-md:flex-col @max-md:items-start @max-md:gap-4">
        <button type="button" onClick={(e) => showPicture(e.currentTarget, artist.images, artist.name)} disabled={!imageUrl} aria-label={`See ${artist.name}'s picture`} className="h-[168px] w-[168px] shrink-0 cursor-zoom-in overflow-hidden rounded-full bg-white/5 shadow-[0_40px_80px_-30px_rgba(0,0,0,0.8)] transition-transform hover:scale-[1.02] active:scale-[0.98] disabled:cursor-default disabled:hover:scale-100 @max-md:h-[132px] @max-md:w-[132px]" style={{ transitionDuration: 'var(--room-mid)' }}>
          {imageUrl && <img src={imageUrl} alt="" className="h-full w-full object-cover" draggable="false" />}
        </button>
        <div className="min-w-0 flex-1 pb-1">
          <Mono className="text-[var(--room-faint)]">{facts}</Mono>
          <h1 className="mt-2 text-[34px] @max-md:text-[26px] font-semibold leading-[1.05] tracking-[-0.025em] text-[var(--room-paper)] [text-wrap:balance] line-clamp-2">{artist.name}</h1>
          {genres.length > 0 && <p className="mt-2 max-w-xl text-[13px] text-[var(--room-dim)] line-clamp-2">{genres.join(', ')}</p>}
          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
            <button type="button" onClick={playArtist} aria-label={`Play ${artist.name}`} className="grid h-[46px] w-[46px] place-items-center rounded-full bg-[var(--room-paper)] text-[#0a0810] transition-transform hover:scale-105 active:scale-95">
              <Play className="ml-0.5 h-[18px] w-[18px] fill-current" />
            </button>
            <ShuffleToggle />
            <span className="ml-1 flex flex-wrap items-center gap-x-4 gap-y-2">
              <Word onClick={toggleFollow} disabled={followBusy} lit={isFollowed}>{isFollowed ? 'Following' : 'Follow'}</Word>
              <Word onClick={share}>Share</Word>
              <Word onClick={openArtistMenu} title={`Options for ${artist.name}`}>More</Word>
            </span>
          </div>
        </div>
      </header>

      {loading.tracks && <Mono className="pt-8 text-[var(--room-faint)]">Loading the songs</Mono>}
      {topTracks.length > 0 && (
        <section>
          <Head>Popular</Head>
          {topTracks.slice(0, 10).map((track, i) => row(track, i, () => handleTrackPlay(track.uri)))}
        </section>
      )}

      {/* Spotify doesn't offer this, so it is Jomify's own */}
      {!loading.tracks && (
        <section>
          <Head right={likedHere?.length > 0 ? <Word onClick={() => playLikedHere(0)}>Play all {likedHere.length}</Word> : null}>
            Your liked songs by {artist.name}
          </Head>
          {likedHere === null ? (
            likedProgress ? (
              <Mono className="py-4 text-[var(--room-faint)]">Reading your liked songs{likedProgress.total ? ` · ${likedProgress.have.toLocaleString()} of ${likedProgress.total.toLocaleString()}` : ''}</Mono>
            ) : (
              <div className="py-4">
                <Word onClick={loadLikedHere}>Find them</Word>
                <p className="mt-2 text-[12px] text-[var(--room-faint)]">Reads your whole Liked Songs once this session.</p>
              </div>
            )
          ) : likedHere.length === 0 ? (
            <p className="py-4 text-[13px] text-[var(--room-faint)]">None yet.</p>
          ) : (
            <>
              {likedHere.slice(0, 50).map((track, i) => row(track, i, () => playLikedHere(i)))}
              {likedHere.length > 50 && <Mono className="py-4 text-center text-[var(--room-faint)]">{likedHere.length - 50} more</Mono>}
            </>
          )}
        </section>
      )}

      {loading.albums && !loading.tracks && <Mono className="pt-8 text-[var(--room-faint)]">Loading the records</Mono>}
      {albums.length > 0 && (
        <section>
          <div className="mt-10 mb-4 flex items-center gap-6 border-b border-[var(--room-hair)] pb-2 @max-md:mt-8 @max-md:flex-wrap @max-md:gap-y-2">
            <Mono className="text-[var(--room-faint)]">Discography{tabLoading ? ' · Loading' : ''}</Mono>
            <span role="tablist" className="ml-auto flex items-center gap-4 @max-md:ml-0 @max-md:w-full @max-md:overflow-x-auto @max-md:pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {GROUPS.map(([id, label]) => (counts[id] === null || counts[id] > 0) && (
                <button key={id} type="button" role="tab" aria-selected={tab === id} aria-pressed={tab === id || undefined} onClick={() => { setPicked(true); pickTab(id); }} className="ui-word">
                  {label}{counts[id] ? ` · ${counts[id]}` : ''}
                </button>
              ))}
            </span>
          </div>
          <EaseHeight>
          {!tabLoading && grid.length === 0 && <p className="py-4 text-[13px] text-[var(--room-faint)]">Nothing in this group.</p>}
          <div key={held.key} aria-busy={tabLoading || undefined} className={`grid gap-x-5 gap-y-6 transition-opacity @max-md:gap-x-4 ${picked ? 'room-rise-list' : ''}`} style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))', opacity: tabLoading ? 0.35 : 1, transitionDuration: 'var(--room-mid)' }}>
            {grid.map((album) => (
              <div
                key={album.id}
                onClick={() => navigateToAlbum(album.id)}
                {...rowButtonProps(() => navigateToAlbum(album.id))}
                onContextMenu={(e) => { e.preventDefault(); openAlbumMenu(e, album); }}
                className="group min-w-0 cursor-pointer"
              >
                <div className="relative aspect-square w-full overflow-hidden rounded-[4px] bg-white/5">
                  {album.images?.[0]?.url && <img src={artUrl(album.images, 300)} alt="" loading="lazy" decoding="async" draggable="false" className="h-full w-full object-cover" />}
                  <button type="button" onClick={(e) => { e.stopPropagation(); playAlbum(album.id); }} aria-label={`Play ${album.name}`} className="absolute bottom-2 right-2 grid h-9 w-9 place-items-center rounded-full bg-[var(--room-paper)] text-[#0a0810] opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100" style={{ transitionDuration: 'var(--room-mid)' }}>
                    <Play className="ml-0.5 h-4 w-4 fill-current" />
                  </button>
                </div>
                <p className="mt-2 truncate text-[13px] font-medium text-[var(--room-paper)]/90">{album.name}</p>
                <Mono className="mt-0.5 truncate text-[var(--room-faint)]">{[KIND[album.album_group] || KIND[album.album_type], album.release_date?.split('-')[0]].filter(Boolean).join(' · ')}</Mono>
              </div>
            ))}
          </div>
          </EaseHeight>
        </section>
      )}
    </div>
  );
}
