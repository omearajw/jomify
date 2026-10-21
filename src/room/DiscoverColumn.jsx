import { useEffect } from 'react';
import { useUserStore } from '../store/userStore';
import { useSlice } from '../store/selectors';
import { useDiscoverStore } from '../discover/discoverStore';
import { SECTIONS } from '../discover/sections';
import { startPlaying } from '../queue/play';
import { playUris } from '../services/spotify/api';
import { artUrl } from '../utils/images';

// Discover's left column (Jack, 21 Oct: Discover had no half-size panel): every shelf as a row,
// with its first picture and how much it found. A row opens the page at full on that shelf; a
// song shelf plays from here too.

const NOUN = { songs: ['song', 'songs'], records: ['record', 'records'], artists: ['artist', 'artists'] };

export default function DiscoverColumn({ onExpand }) {
  const { token, profile, currentView, setCurrentView } = useSlice(useUserStore, ['token', 'profile', 'currentView', 'setCurrentView']);
  const { sections, start, setFocus } = useSlice(useDiscoverStore, ['sections', 'start', 'setFocus']);
  useEffect(() => { if (token && profile?.id) start(); }, [token, profile?.id, start]);

  const open = (key) => { setFocus(key); if (currentView !== 'discover') setCurrentView('discover'); onExpand?.(); };
  const play = (title, tracks) => {
    const uris = tracks.map((t) => t.uri).filter(Boolean);
    if (!token || !uris.length) return;
    startPlaying({ kind: 'list', name: title, tracks, start: 0, track: tracks[0] }, (deviceId) => playUris(token, deviceId, uris.slice(0, 100), 0));
  };

  const row = (def) => {
    const s = sections[def.key] || { status: 'loading', items: [] };
    if (s.status === 'failed' || (s.status === 'ready' && !s.items?.length)) return null;
    const title = s.label || def.label;
    const first = s.items?.[0];
    const images = first?.album?.images || first?.images;
    const [one, many] = NOUN[def.type] || ['', ''];
    const facts = s.status === 'idle' ? 'waits to be asked' : s.status === 'loading' ? 'finding' : `${s.items.length} ${s.items.length === 1 ? one : many}`;
    return (
      <div key={def.key} className="group flex items-center gap-3 py-[9px]" style={{ borderTop: '1px solid var(--room-hair)' }}>
        <button type="button" onClick={() => open(def.key)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <span className={`h-[30px] w-[30px] shrink-0 overflow-hidden bg-white/5 ${def.type === 'artists' ? 'rounded-full' : 'rounded-[3px]'}`}>
            {images?.length ? <img src={artUrl(images, 30)} alt="" width="30" height="30" loading="lazy" decoding="async" draggable="false" className="h-full w-full object-cover" /> : null}
          </span>
          <span className="min-w-0 flex-1">
            <b className="block truncate text-[13px] font-medium text-[var(--room-dim)] group-hover:text-[var(--room-paper)]">{title}</b>
            <i className="room-mono block truncate not-italic text-[var(--room-faint)]">{facts}</i>
          </span>
        </button>
        {def.type === 'songs' && s.status === 'ready' && (
          <button type="button" onClick={() => play(title, s.items)} aria-label={`Play ${title}`} className="room-mono shrink-0 text-[var(--room-faint)] opacity-0 transition-opacity hover:text-[var(--room-paper)] focus-visible:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100">
            Play
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ fontFamily: 'var(--font-room)' }}>
      <p className="room-mono flex justify-between border-b border-[var(--room-hair)] pb-3 text-[var(--room-dim)]">
        <span>Discover</span>
        <button type="button" onClick={() => { if (currentView !== 'discover') setCurrentView('discover'); onExpand?.(); }} aria-current={currentView === 'discover' ? 'page' : undefined} className={`ui-headword transition-colors ${currentView === 'discover' ? 'text-[var(--room-paper)]' : 'text-[var(--room-faint)] hover:text-[var(--room-paper)]'}`}>For you</button>
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain pr-1 pt-4 [scrollbar-width:thin]">
        {SECTIONS.map(row)}
      </div>
    </div>
  );
}
