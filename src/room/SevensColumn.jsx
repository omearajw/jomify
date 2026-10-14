import { useUserStore } from '../store/userStore';
import { useSlice } from '../store/selectors';
import { artUrl } from '../utils/images';

// The Sevens layer's left column (DESIGN.md §7): every Seven as a row, with whom and whose turn,
// the one Sevens fact that matters when you are not in Sevens. A row opens that Seven's
// workspace on the right; Active / Finished is settled here; set-up is on the Sevens page.

export default function SevensColumn({ onExpand }) {
  const { sevens, sevenTurns, playlists, currentView, activePlaylistId, navigateToPlaylist, setCurrentView, updateSeven } = useSlice(useUserStore, [
    'sevens', 'sevenTurns', 'playlists', 'currentView', 'activePlaylistId', 'navigateToPlaylist', 'setCurrentView', 'updateSeven'
  ]);
  const yours = new Set((sevenTurns || []).map((t) => t.id));
  const active = sevens.filter((s) => s.active);
  const finished = sevens.filter((s) => !s.active);

  const row = (seven) => {
    const playlist = playlists.find((p) => p.id === seven.playlistId);
    const lit = currentView === 'playlist' && activePlaylistId === seven.playlistId;
    const turn = !seven.active ? 'finished' : yours.has(seven.playlistId) ? 'your turn' : seven.partnerName ? `${seven.partnerName}'s turn` : 'their turn';
    return (
      <div key={seven.playlistId} className="group flex items-center gap-3 py-[9px]" style={{ borderTop: '1px solid var(--room-hair)' }}>
        <button type="button" onClick={() => { navigateToPlaylist(seven.playlistId); onExpand?.(); }} aria-current={lit ? 'true' : undefined} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <span className="h-[30px] w-[30px] shrink-0 overflow-hidden rounded-[3px] bg-white/5">
            {playlist?.images?.[0] && <img src={artUrl(playlist.images, 30)} alt="" width="30" height="30" loading="lazy" decoding="async" draggable="false" className="h-full w-full object-cover" />}
          </span>
          <span className="min-w-0 flex-1">
            <b className={`block truncate text-[13px] ${lit || yours.has(seven.playlistId) ? 'font-semibold text-[var(--room-paper)]' : seven.active ? 'font-medium text-[var(--room-dim)] group-hover:text-[var(--room-paper)]' : 'font-medium text-[var(--room-faint)]'}`} style={{ transition: 'color var(--room-mid)' }}>{playlist?.name || 'A Seven'}</b>
            <i className={`room-mono block truncate not-italic ${yours.has(seven.playlistId) && seven.active ? 'text-[var(--room-paper)]' : 'text-[var(--room-faint)]'}`}>{seven.partnerName ? `with ${seven.partnerName} · ` : ''}{turn}</i>
          </span>
        </button>
        <button type="button" onClick={() => updateSeven(seven.playlistId, { active: !seven.active })} className="room-mono shrink-0 text-[var(--room-faint)] opacity-0 transition-opacity hover:text-[var(--room-paper)] focus:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100" style={{ transitionDuration: 'var(--room-mid)' }}>
          {seven.active ? 'Finish' : 'Resume'}
        </button>
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ fontFamily: 'var(--font-room)' }}>
      <p className="room-mono flex justify-between border-b border-[var(--room-hair)] pb-3 text-[var(--room-dim)]">
        <span>Sevens</span>
        <button type="button" onClick={() => { setCurrentView('sevens'); onExpand?.(); }} aria-current={currentView === 'sevens' ? 'page' : undefined} className={`transition-colors ${currentView === 'sevens' ? 'text-[var(--room-paper)]' : 'text-[var(--room-faint)] hover:text-[var(--room-paper)]'}`}>Set up</button>
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain pr-1 pt-4 [scrollbar-width:thin]">
        {sevens.length === 0 && <p className="text-[13px] text-[var(--room-faint)]">No Sevens yet. Set one up to start trading batches.</p>}
        {active.map(row)}
        {finished.length > 0 && <>
          <p className="room-mono mb-1 mt-6 text-[var(--room-faint)]">Finished</p>
          {finished.map(row)}
        </>}
      </div>
    </div>
  );
}
