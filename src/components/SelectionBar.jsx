import { useEffect } from 'react';
import { ListPlus, Plus, Trash2, X } from 'lucide-react';
import { useUserStore } from '../store/userStore';

// The bar that appears once rows are selected: act on all of them, or let go. `onRemove` does
// the removing itself (the bar's button); `onRemovedMany` only drops rows the menu has removed.
export default function SelectionBar({ count, tracks, onClear, onRemove, onRemovedMany, removeLabel = 'Remove', sourcePlaylistId = null }) {
  const setContextMenu = useUserStore((s) => s.setContextMenu);
  useEffect(() => {
    if (!count) return undefined;
    // Capture phase, so an open menu is still open when this looks: the first Escape closes
    // the menu, the next one lets the selection go
    const onKey = (e) => { if (e.key === 'Escape' && !useUserStore.getState().contextMenu) onClear(); };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [count, onClear]);
  if (!count) return null;
  const openMenu = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    setContextMenu({ type: 'tracks', tracks, x: r.left, y: r.top - 8, sourcePlaylistId, onRemovedMany, onDone: onClear });
  };
  return (
    <div className="fixed left-1/2 -translate-x-1/2 bottom-[calc(7.5rem+env(safe-area-inset-bottom))] md:bottom-28 z-[8990] flex items-center gap-2 px-3 py-2 rounded-full bg-neutral-900/95 border border-white/10 shadow-2xl backdrop-blur-xl text-sm text-white animate-fade-in max-w-[95vw]">
      <span className="font-bold px-2 tabular-nums">{count} selected</span>
      <button type="button" onClick={openMenu} className="flex items-center gap-1.5 rounded-full px-3 py-1.5 hover:bg-white/10 font-semibold"><Plus className="w-4 h-4" /> <span className="hidden sm:inline">Add to</span> playlist</button>
      <button type="button" onClick={openMenu} className="flex items-center gap-1.5 rounded-full px-3 py-1.5 hover:bg-white/10 font-semibold"><ListPlus className="w-4 h-4" /> Queue</button>
      {onRemove && (
        <button type="button" onClick={() => onRemove(tracks)} className="flex items-center gap-1.5 rounded-full px-3 py-1.5 hover:bg-red-500/15 text-red-300 font-semibold"><Trash2 className="w-4 h-4" /> {removeLabel}</button>
      )}
      <button type="button" onClick={onClear} aria-label="Clear selection" className="w-8 h-8 rounded-full flex items-center justify-center text-neutral-400 hover:text-white hover:bg-white/10"><X className="w-4 h-4" /></button>
    </div>
  );
}
