import { useEffect } from 'react';
import { useUserStore } from '../store/userStore';

// The bar that appears once rows are selected: act on all of them, or let go. `onRemove` does
// the removing itself (the bar's button); `onRemovedMany` only drops rows the menu has removed.
export default function SelectionBar({ count, tracks, onClear, onRemove, onRemovedMany, removeLabel = 'Remove', sourcePlaylistId = null }) {
  const setContextMenu = useUserStore((s) => s.setContextMenu);
  useEffect(() => {
    if (!count) return undefined;
    // Capture phase, so an open menu is still open when this looks: the first Escape closes
    // the menu, the next one lets the selection go
    // ...and it takes the key for itself: the selection is the topmost thing, so nothing under
    // it (the room's layer) should step on the same press
    const onKey = (e) => { if (e.key === 'Escape' && !useUserStore.getState().contextMenu) { e.stopPropagation(); onClear(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [count, onClear]);
  if (!count) return null;
  const openMenu = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    setContextMenu({ type: 'tracks', tracks, x: r.left, y: r.top - 8, sourcePlaylistId, onRemovedMany, onDone: onClear });
  };
  return (
    <div className="ui-plane fixed left-1/2 -translate-x-1/2 bottom-[calc(7.5rem+env(safe-area-inset-bottom))] md:bottom-16 z-[8990] flex max-w-[95vw] items-center gap-6 px-6 py-3 animate-fade-in">
      <span className="room-mono text-[var(--room-paper)] tabular-nums">{count} selected</span>
      <button type="button" onClick={openMenu} className="ui-word">Add to playlist</button>
      <button type="button" onClick={openMenu} className="ui-word">Queue</button>
      {onRemove && <button type="button" onClick={() => onRemove(tracks)} className="ui-word ui-row-danger">{removeLabel}</button>}
      <button type="button" onClick={onClear} className="ui-word">Done</button>
    </div>
  );
}
