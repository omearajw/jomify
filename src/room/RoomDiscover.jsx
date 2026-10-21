import { useEffect, useRef, useState } from 'react';
import { Play, ChevronLeft, ChevronRight } from 'lucide-react';
import { useUserStore } from '../store/userStore';
import { useSlice, usePlaybackSummary } from '../store/selectors';
import { useDiscoverStore } from '../discover/discoverStore';
import { SECTIONS } from '../discover/sections';
import { startPlaying } from '../queue/play';
import { playContext, playUris, followArtists, unfollowArtists } from '../services/spotify/api';
import { toast } from '../store/toastStore';
import LikeButton from '../components/LikeButton';
import Artists from './Artists';
import { artUrl } from '../utils/images';
import { rowButtonProps } from '../utils/a11y';
import { isSameTrack } from '../utils/spotifyUri';

// Discover (DESIGN.md §11's language; look B, chosen 21 Oct): every section a shelf that scrolls
// sideways, records, songs and artists alike as tiles. What each section is and how it is found is
// src/discover/sections.js; loading and the day's keeping, discoverStore.js. A shelf that found
// nothing is left out rather than shown empty.

const TILE = 150;
const Mono = ({ children, className = '' }) => <p className={`room-mono ${className}`}>{children}</p>;
const Word = ({ onClick, children, disabled, label }) => <button type="button" onClick={onClick} disabled={disabled} aria-label={label} className="ui-word">{children}</button>;

const ago = (date) => {
  const d = Math.round((Date.now() - Date.parse(date)) / 86400000);
  if (Number.isNaN(d)) return '';
  return d <= 0 ? 'Today' : d === 1 ? 'Yesterday' : d < 7 ? `${d} days ago` : d < 60 ? `${Math.round(d / 7)} wk ago` : String(date).slice(0, 4);
};

// The ‹ › are for a mouse with no sideways scroll (Windows); touch screens swipe instead
function Shelf({ id, title, right, children }) {
  const ref = useRef(null);
  const by = (dir) => ref.current?.scrollBy({ left: dir * Math.max(TILE * 2, ref.current.clientWidth - TILE), behavior: 'smooth' });
  return (
    <section id={id} className="scroll-mt-4">
      <div className="mt-9 flex items-center justify-between gap-4">
        <h2 className="min-w-0 truncate text-[17px] font-semibold tracking-[-0.01em] text-[var(--room-paper)]">{title}</h2>
        <span className="flex shrink-0 items-center gap-4">
          {right}
          <span className="flex items-center gap-1 pointer-coarse:hidden">
            <button type="button" onClick={() => by(-1)} aria-label={`Back along ${title}`} className="room-press grid h-7 w-7 place-items-center text-[var(--room-faint)] hover:text-[var(--room-paper)]"><ChevronLeft className="h-4 w-4" /></button>
            <button type="button" onClick={() => by(1)} aria-label={`On along ${title}`} className="room-press grid h-7 w-7 place-items-center text-[var(--room-faint)] hover:text-[var(--room-paper)]"><ChevronRight className="h-4 w-4" /></button>
          </span>
        </span>
      </div>
      <div ref={ref} className="-mx-1 mt-3 flex snap-x gap-4 overflow-x-auto px-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:snap-start">{children}</div>
    </section>
  );
}

const Waiting = () => Array.from({ length: 6 }, (_, k) => <span key={k} className="aspect-square shrink-0 rounded-[4px] bg-white/[0.04]" style={{ width: TILE }} />);

function Tile({ images, onOpen, onPlay, onMenu, playLabel, playing, children }) {
  return (
    <div className="group min-w-0 shrink-0 cursor-pointer" style={{ width: TILE }} onClick={onOpen} {...rowButtonProps(onOpen)} onContextMenu={onMenu}>
      <div className="relative aspect-square w-full overflow-hidden rounded-[4px] bg-white/5">
        {images?.length ? <img src={artUrl(images, TILE)} alt="" loading="lazy" decoding="async" draggable="false" className="h-full w-full object-cover" /> : null}
        {onPlay && (
          <button type="button" onClick={(e) => { e.stopPropagation(); onPlay(); }} aria-label={playLabel}
            className={`absolute bottom-2 right-2 grid h-9 w-9 place-items-center rounded-full bg-[var(--room-paper)] text-[#0a0810] transition-opacity group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100 ${playing ? 'opacity-100' : 'opacity-0'}`} style={{ transitionDuration: 'var(--room-mid)' }}>
            {playing ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#0a0810]" aria-label="Playing" /> : <Play className="ml-0.5 h-4 w-4 fill-current" />}
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

export default function RoomDiscover() {
  const { token, profile, navigateToAlbum, navigateToArtist, setContextMenu, followedArtists, addFollowedArtist, removeFollowedArtist } = useSlice(useUserStore, ['token', 'profile', 'navigateToAlbum', 'navigateToArtist', 'setContextMenu', 'followedArtists', 'addFollowedArtist', 'removeFollowedArtist']);
  const { currentPlayingTrack, isCurrentTrackPaused } = usePlaybackSummary();
  const { sections, liked, running, start, ask, focus, setFocus } = useSlice(useDiscoverStore, ['sections', 'liked', 'running', 'start', 'ask', 'focus', 'setFocus']);
  const [busy, setBusy] = useState(null);

  useEffect(() => { if (token && profile?.id) start(); }, [token, profile?.id, start]);
  // a shelf picked in the column: brought into view once the layer has opened out
  useEffect(() => {
    if (!focus) return undefined;
    const id = setTimeout(() => { document.getElementById(`shelf-${focus}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); setFocus(null); }, 450);
    return () => clearTimeout(id);
  }, [focus, setFocus]);

  const playAlbum = (album) => startPlaying({ uri: `spotify:album:${album.id}`, kind: 'album', name: album.name }, (deviceId) => playContext(token, deviceId, `spotify:album:${album.id}`));
  const playSongs = (name, tracks, index) => {
    const uris = tracks.map((t) => t.uri).filter(Boolean);
    if (!token || !uris.length) return;
    startPlaying({ kind: 'list', name, tracks, start: index, track: tracks[index] }, (deviceId) => playUris(token, deviceId, uris.slice(0, 100), Math.min(index, 99)));
  };
  const following = new Set((followedArtists || []).map((a) => a.id));
  const follow = async (artist) => {
    if (!token || busy) return;
    setBusy(artist.id);
    try {
      await followArtists(token, [artist.id]);
      addFollowedArtist(artist);
      toast(`Following ${artist.name}`, { action: { label: 'Undo', onClick: async () => { try { await unfollowArtists(token, [artist.id]); removeFollowedArtist(artist.id); } catch { toast("Couldn't undo that", { tone: 'error' }); } } } });
    } catch {
      toast(`Couldn't follow ${artist.name}`, { tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const shelfOf = (def) => {
    const s = sections[def.key] || { status: 'loading', items: [] };
    const title = s.label || def.label;
    if (def.onDemand && s.status === 'idle') {
      return (
        <section key={def.key} id={`shelf-${def.key}`} className="scroll-mt-4">
          <div className="mt-9"><h2 className="truncate text-[17px] font-semibold tracking-[-0.01em] text-[var(--room-paper)]">{title}</h2></div>
          <div className="py-3"><Word onClick={() => ask(def.key)}>Find them</Word><p className="mt-2 max-w-md text-[12px] text-[var(--room-faint)]">{def.note?.({ followed: followedArtists || [] })}</p></div>
        </section>
      );
    }
    if (s.status === 'loading') {
      const note = def.needsLiked && liked ? `Reading your Liked Songs${liked.total ? ` · ${liked.have.toLocaleString()} of ${liked.total.toLocaleString()}` : ''}` : null;
      return <Shelf key={def.key} id={`shelf-${def.key}`} title={title} right={note ? <Mono className="text-[var(--room-faint)]">{note}</Mono> : null}><Waiting /></Shelf>;
    }
    if (s.status === 'failed' || !s.items?.length) return null;
    if (def.type === 'records') {
      return (
        <Shelf key={def.key} id={`shelf-${def.key}`} title={title}>
          {s.items.map((r) => (
            <Tile key={r.id} images={r.images} onOpen={() => navigateToAlbum(r.id)} onPlay={() => playAlbum(r)} playLabel={`Play ${r.name}`}
              onMenu={(e) => { e.preventDefault(); setContextMenu({ type: 'album', x: e.pageX, y: e.pageY, albumId: r.id, album: r }); }}>
              <p className="mt-2 truncate text-[13px] font-medium text-[var(--room-paper)]/90">{r.name}</p>
              <Artists artists={r.artists} inRow className="block truncate text-[12px] text-[var(--room-dim)]" />
              <Mono className="mt-0.5 truncate text-[var(--room-faint)]">{def.meta === 'dipped' ? `${r.liked} of ${r.total} liked` : ago(r.release_date)}</Mono>
            </Tile>
          ))}
        </Shelf>
      );
    }
    if (def.type === 'artists') {
      return (
        <Shelf key={def.key} id={`shelf-${def.key}`} title={title}>
          {s.items.map((a) => (
            <div key={a.id} className="min-w-0 shrink-0 text-center" style={{ width: 130 }}>
              <button type="button" onClick={() => navigateToArtist(a.id)} aria-label={`Open ${a.name}`} className="block w-full">
                <span className="block aspect-square w-full overflow-hidden rounded-full bg-white/5">{a.images?.length ? <img src={artUrl(a.images, 130)} alt="" loading="lazy" draggable="false" className="h-full w-full object-cover" /> : null}</span>
                <span className="mt-2 block truncate text-[13px] font-medium text-[var(--room-paper)]/90">{a.name}</span>
              </button>
              <Mono className="mt-0.5 truncate text-[var(--room-faint)]">{a.liked} liked</Mono>
              <div className="mt-2">{following.has(a.id) ? <Mono className="text-[var(--room-dim)]">Following</Mono> : <Word onClick={() => follow(a)} disabled={busy === a.id} label={`Follow ${a.name}`}>Follow</Word>}</div>
            </div>
          ))}
        </Shelf>
      );
    }
    return (
      <Shelf key={def.key} id={`shelf-${def.key}`} title={title} right={<Word onClick={() => playSongs(title, s.items, 0)} label={`Play all of ${title}`}>Play all</Word>}>
        {s.items.map((t, i) => (
          <Tile key={t.id} images={t.album?.images} onOpen={() => playSongs(title, s.items, i)} onPlay={() => playSongs(title, s.items, i)} playLabel={`Play ${t.name}`}
            playing={isSameTrack(t, currentPlayingTrack) && !isCurrentTrackPaused}
            onMenu={(e) => { e.preventDefault(); setContextMenu({ type: 'track', x: e.pageX, y: e.pageY, track: t }); }}>
            <span className="mt-2 flex items-start gap-1">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-[var(--room-paper)]/90">{t.name}</span>
                <Artists artists={t.artists} inRow className="block truncate text-[12px] text-[var(--room-dim)]" />
              </span>
              <span className="room-like -mr-1 shrink-0 [&_svg]:h-4 [&_svg]:w-4" onClick={(e) => e.stopPropagation()}><LikeButton trackId={t.id} /></span>
            </span>
            {t.friend && <Mono className="mt-0.5 truncate text-[var(--room-faint)]">{t.friend.name} · {t.playlist}</Mono>}
          </Tile>
        ))}
      </Shelf>
    );
  };

  const shown = SECTIONS.map(shelfOf).filter(Boolean);
  const settled = !running && SECTIONS.every((d) => d.onDemand || ['ready', 'failed'].includes(sections[d.key]?.status));
  return (
    <div className="relative min-h-full pb-12" style={{ fontFamily: 'var(--font-room)' }}>
      <header className="flex items-end justify-between gap-4 pt-4">
        <div className="min-w-0">
          <Mono className="text-[var(--room-faint)]">Discover</Mono>
          <h1 className="mt-2 text-[34px] font-semibold leading-[1.05] tracking-[-0.025em] text-[var(--room-paper)] @max-md:text-[26px]">For you this week</h1>
        </div>
        <Word onClick={() => start({ refresh: true })} disabled={running}>{running ? 'Finding' : 'Refresh'}</Word>
      </header>
      {shown}
      {settled && shown.length <= 1 && <p className="mt-8 max-w-md text-[13px] text-[var(--room-faint)]">Spotify didn't give much back this time. Try Refresh in a while.</p>}
    </div>
  );
}
