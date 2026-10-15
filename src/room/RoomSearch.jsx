import { useEffect } from 'react';
import { Play } from 'lucide-react';
import { useBrowse, albumMeta } from '../views/Browse/useBrowse';
import { useUserStore } from '../store/userStore';
import { useSlice } from '../store/selectors';
import { useRoomStore } from './roomStore';
import LikeButton from '../components/LikeButton';
import { artUrl } from '../utils/images';
import { formatTime } from '../utils/formatTime';
import { rowButtonProps } from '../utils/a11y';
import { isSameTrack, isUnplayable, unplayableWhy, TRACK_DRAG_TYPE } from '../utils/spotifyUri';

// Search on the room's language (DESIGN.md §6): the tree's field is the field, so there is none
// here. Results are one list: "In your library" first, then songs as rows on hairlines, then
// playlists, albums and artists as covers, each with "All" to open the lot. Before anything is
// typed, the recent searches as words.

const Mono = ({ children, className = '' }) => <p className={`room-mono ${className}`}>{children}</p>;
const Word = ({ onClick, children, lit }) => <button type="button" onClick={onClick} aria-pressed={lit || undefined} className="ui-word">{children}</button>;
const Head = ({ children, count, action, onAction, first }) => (
  <div className={`mb-3 flex items-center justify-between border-b border-[var(--room-hair)] pb-2 ${first ? '' : 'mt-9'}`}>
    <Mono className="text-[var(--room-faint)]">{children}{count ? ` · ${count}` : ''}</Mono>
    {action && <Word onClick={onAction}>{action}</Word>}
  </div>
);

function Cover({ item, kind, onOpen, onPlay, onMenu, meta }) {
  return (
    <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }} onContextMenu={onMenu} className="group min-w-0 cursor-pointer">
      <div className={`relative aspect-square w-full overflow-hidden bg-white/5 ${kind === 'artist' ? 'rounded-full' : 'rounded-[4px]'}`}>
        {item.images?.[0]?.url && <img src={artUrl(item.images, 300)} alt="" loading="lazy" decoding="async" draggable="false" className="h-full w-full object-cover" />}
        {onPlay && (
          <button type="button" onClick={(e) => { e.stopPropagation(); onPlay(); }} aria-label={`Play ${item.name}`} className="absolute bottom-2 right-2 grid h-9 w-9 place-items-center rounded-full bg-[var(--room-paper)] text-[#0a0810] opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100" style={{ transitionDuration: 'var(--room-mid)' }}>
            <Play className="ml-0.5 h-4 w-4 fill-current" />
          </button>
        )}
      </div>
      <p className="mt-2 truncate text-[13px] font-medium text-[var(--room-paper)]/90">{item.name}</p>
      <Mono className="mt-0.5 truncate text-[var(--room-faint)]">{meta}</Mono>
    </div>
  );
}

export default function RoomSearch() {
  const {
    query, setQuery, recent, forgetSearch, clearRecent, results, expandedSection, setExpandedSection, paginationUrls, loadingMore, sentinelRef,
    searching, searchError, retrySearch, country, handleTrackPlay, handleContextPlay, currentPlayingTrack, token,
    navigateToArtist, navigateToAlbum, navigateToPlaylist, setContextMenu, setDraggedItem
  } = useBrowse();
  const { playlists, albums, followedArtists } = useSlice(useUserStore, ['playlists', 'albums', 'followedArtists']);

  // the tree's field drives the search while this is open
  const roomQuery = useRoomStore((s) => s.searchQuery);
  useEffect(() => { if (roomQuery !== query) setQuery(roomQuery); }, [roomQuery]); // eslint-disable-line react-hooks/exhaustive-deps
  // an open section ("All albums") is a step of its own: Back returns to the summary first
  const setBack = useRoomStore((s) => s.setBack);
  const setPageSuffix = useRoomStore((s) => s.setPageSuffix);
  useEffect(() => {
    setBack(expandedSection ? { name: 'Search', go: () => setExpandedSection(null) } : null);
    setPageSuffix(expandedSection || '');
    return () => { setBack(null); setPageSuffix(''); };
  }, [expandedSection, setBack, setPageSuffix, setExpandedSection]);

  const q = query.trim().toLowerCase();
  const hit = (name) => q && (name || '').toLowerCase().includes(q);
  const mine = [
    ...playlists.filter((p) => hit(p.name)).map((p) => ({ ...p, kind: 'playlist' })),
    ...(albums || []).filter((a) => hit(a.name)).map((a) => ({ ...a, kind: 'album' })),
    ...(followedArtists || []).filter((a) => hit(a.name)).map((a) => ({ ...a, kind: 'artist' }))
  ].slice(0, 6);
  const openMine = (it) => { if (it.kind === 'playlist') navigateToPlaylist(it.id); else if (it.kind === 'album') navigateToAlbum(it.id); else navigateToArtist(it.id); };

  // Spotify's search pads its lists with nulls (playlists it will not show); drop them
  const tracks = (results?.tracks?.items || []).filter(Boolean);
  const playlistHits = (results?.playlists?.items || []).filter(Boolean);
  const albumHits = (results?.albums?.items || []).filter(Boolean);
  const artistHits = (results?.artists?.items || []).filter(Boolean);
  const nothing = results && !tracks.length && !playlistHits.length && !albumHits.length && !artistHits.length;

  const trackMenu = (e, track) => { e.preventDefault(); setContextMenu({ type: 'track', x: e.pageX, y: e.pageY, track }); };
  const trackRow = (track, i) => {
    const current = isSameTrack(track, currentPlayingTrack);
    const unplayable = isUnplayable(track, country);
    return (
      <div
        key={`${track.id}-${i}`}
        onClick={() => handleTrackPlay(track)}
        {...rowButtonProps(() => handleTrackPlay(track))}
        onContextMenu={(e) => trackMenu(e, track)}
        draggable
        onDragStart={(e) => { e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData(TRACK_DRAG_TYPE, track.uri); e.dataTransfer.setData('text/plain', track.uri); setTimeout(() => setDraggedItem({ type: 'track', uri: track.uri }), 0); }}
        onDragEnd={() => setDraggedItem(null)}
        aria-disabled={unplayable || undefined} data-tip={unplayable ? unplayableWhy(track, country) : undefined}
        title={unplayable ? 'Not available on Spotify' : undefined}
        className={`group grid cursor-pointer grid-cols-[28px_34px_minmax(0,1.3fr)_minmax(0,1fr)_24px_44px] @max-md:grid-cols-[22px_36px_minmax(0,1fr)_36px] @max-md:gap-2.5 items-center gap-3 py-[9px] text-[13px] transition-colors hover:bg-white/[0.03] ${unplayable ? 'opacity-40' : ''}`}
        style={{ borderTop: '1px solid var(--room-hair)', transitionDuration: 'var(--room-mid)' }}
      >
        <span className="room-mono flex items-center justify-center text-[var(--room-faint)]">
          {current ? <span className="h-1.5 w-1.5 rounded-full bg-[var(--room-paper)] animate-pulse" aria-label="Playing" /> : <><span className="group-hover:hidden">{i + 1}</span><Play className="hidden h-3 w-3 fill-current text-[var(--room-paper)] group-hover:block" /></>}
        </span>
        <span className="h-[34px] w-[34px] overflow-hidden rounded-[3px] bg-white/5">{track.album?.images?.[0]?.url && <img src={artUrl(track.album.images, 34)} alt="" width="34" height="34" loading="lazy" decoding="async" draggable="false" className="h-full w-full object-cover" />}</span>
        <span className="min-w-0 pr-3">
          <span className={`block truncate ${current ? 'font-semibold text-[var(--room-paper)]' : 'font-medium text-[var(--room-paper)]/90'}`}>{track.name}</span>
          <span className="block truncate text-[11.5px] text-[var(--room-dim)]">
            {(track.artists || []).map((a, k) => <span key={a.id || k}><button type="button" onClick={(e) => { e.stopPropagation(); if (a.id) navigateToArtist(a.id); }} className="hover:text-[var(--room-paper)] pointer-coarse:pointer-events-none">{a.name}</button>{k < track.artists.length - 1 ? ', ' : ''}</span>)}
          </span>
        </span>
        <span className="min-w-0 truncate pr-3 text-[var(--room-dim)] @max-md:hidden">
          {track.album?.id ? <button type="button" onClick={(e) => { e.stopPropagation(); navigateToAlbum(track.album.id); }} className="block w-full truncate text-left hover:text-[var(--room-paper)]">{track.album.name}</button> : track.album?.name}
        </span>
        <span className="room-like flex items-center justify-center [&_svg]:h-4 [&_svg]:w-4"><LikeButton trackId={track.id} /></span>
        <Mono className="text-right text-[var(--room-faint)] @max-md:hidden">{formatTime(track.duration_ms)}</Mono>
      </div>
    );
  };
  const covers = (items, kind) => (
    <div className="grid gap-x-5 gap-y-6" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))' }}>
      {items.map((it) => (
        <Cover
          key={it.id}
          item={it}
          kind={kind}
          meta={kind === 'album' ? albumMeta(it) : kind === 'artist' ? 'Artist' : (it.owner?.display_name ? `By ${it.owner.display_name}` : 'Playlist')}
          onOpen={() => (kind === 'playlist' ? navigateToPlaylist(it.id) : kind === 'album' ? navigateToAlbum(it.id) : navigateToArtist(it.id))}
          onPlay={() => handleContextPlay(`spotify:${kind}:${it.id}`)}
          onMenu={(e) => { e.preventDefault(); setContextMenu(kind === 'artist' ? { type: 'artist', artistId: it.id, artist: it, x: e.pageX, y: e.pageY } : { type: kind, playlistId: kind === 'playlist' ? it.id : null, albumId: kind === 'album' ? it.id : null, x: e.pageX, y: e.pageY }); }}
        />
      ))}
    </div>
  );

  // plain functions, not components: they close over this render's state
  const section = ({ id, title, items, first = false, render, preview }) => {
    if (!items.length) return null;
    const open = expandedSection === id;
    const shown = open ? items : items.slice(0, preview);
    return (
      <div key={id}>
        <Head first={first} count={open ? items.length : undefined} action={items.length > preview ? (open ? 'Fewer' : `All ${title.toLowerCase()}`) : undefined} onAction={() => setExpandedSection(open ? null : id)}>{title}</Head>
        {render(shown)}
        {open && paginationUrls[id] && <p ref={sentinelRef} className="room-mono py-5 text-center text-[var(--room-faint)]">{loadingMore ? 'Loading' : 'More'}</p>}
      </div>
    );
  };

  // one open section is the whole page
  if (expandedSection && results) {
    const map = { tracks: ['Songs', tracks, (items) => <div>{items.map(trackRow)}</div>], playlists: ['Playlists', playlistHits, (items) => covers(items, 'playlist')], albums: ['Albums', albumHits, (items) => covers(items, 'album')], artists: ['Artists', artistHits, (items) => covers(items, 'artist')] };
    const [title, items, render] = map[expandedSection] || map.tracks;
    return (
      <div className="pb-12" style={{ fontFamily: 'var(--font-room)' }}>
        {section({ id: expandedSection, title, items, first: true, preview: 0, render })}
      </div>
    );
  }

  return (
    <div className="pb-12" style={{ fontFamily: 'var(--font-room)' }}>
      {!q && (
        <div>
          <Head first action={recent.length ? 'Clear' : undefined} onAction={clearRecent}>Search</Head>
          {recent.length ? (
            <div className="flex flex-wrap gap-x-5 gap-y-3">
              {recent.map((r) => (
                <span key={r} className="group flex items-center gap-2">
                  <button type="button" onClick={() => useRoomStore.getState().setSearchQuery(r)} className="text-[13px] text-[var(--room-dim)] hover:text-[var(--room-paper)]">{r}</button>
                  <button type="button" onClick={() => forgetSearch(r)} aria-label={`Forget ${r}`} className="room-mono text-[var(--room-faint)] opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100">×</button>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-[13px] text-[var(--room-faint)]">Type in the field <span className="@max-md:hidden">on the left</span><span className="hidden @max-md:inline">above</span>. Your library comes first, then Spotify.</p>
          )}
        </div>
      )}
      {q && (
        <>
          {mine.length > 0 && (
            <div>
              <Head first>In your library</Head>
              {mine.map((it) => (
                <button key={`${it.kind}-${it.id}`} type="button" onClick={() => openMine(it)} className="flex w-full items-center gap-3 py-2 text-left text-[13px] text-[var(--room-dim)] hover:text-[var(--room-paper)]" style={{ borderTop: '1px solid var(--room-hair)' }}>
                  <span className={`h-[30px] w-[30px] shrink-0 overflow-hidden bg-white/5 ${it.kind === 'artist' ? 'rounded-full' : 'rounded-[3px]'}`}>{it.images?.[0]?.url && <img src={artUrl(it.images, 30)} alt="" className="h-full w-full object-cover" draggable="false" />}</span>
                  <span className="min-w-0 flex-1 truncate">{it.name}</span>
                  <Mono className="text-[var(--room-faint)]">{it.kind}</Mono>
                </button>
              ))}
            </div>
          )}
          {searching && !results && <Mono className="pt-6 text-[var(--room-faint)]">Searching Spotify</Mono>}
          {searchError && <p className="pt-6 text-[13px] text-[var(--room-dim)]">{searchError} <Word onClick={retrySearch}>Try again</Word></p>}
          {nothing && !searching && <p className="pt-6 text-[13px] text-[var(--room-faint)]">Nothing on Spotify for "{query.trim()}".</p>}
          {results && (
            <>
              {section({ id: 'tracks', title: 'Songs', items: tracks, first: !mine.length, preview: 5, render: (items) => <div>{items.map(trackRow)}</div> })}
              {section({ id: 'playlists', title: 'Playlists', items: playlistHits, preview: 6, render: (items) => covers(items, 'playlist') })}
              {section({ id: 'albums', title: 'Albums', items: albumHits, preview: 6, render: (items) => covers(items, 'album') })}
              {section({ id: 'artists', title: 'Artists', items: artistHits, preview: 6, render: (items) => covers(items, 'artist') })}
            </>
          )}
          {!token && <Mono className="pt-6 text-[var(--room-faint)]">Sign in to search Spotify</Mono>}
        </>
      )}
    </div>
  );
}
