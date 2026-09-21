import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Star, Plus, X, Loader } from 'lucide-react';
import { useIsMobile } from '../hooks/useMediaQuery';

// The row of "sort into" chips under a track in Unadded Songs: the top pick, two more that fit,
// and "More" for any other check playlist. Every click stops at the chip so the row underneath
// doesn't start playing the song.
export default function SortIntoChips({ suggestions, targets, busy, onPick }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const isMobile = useIsMobile();
  if (!targets.length) return null;

  const stop = (e) => { e.stopPropagation(); e.preventDefault(); };
  const chip = (target, index) => {
    const top = index === 0;
    return (
      <button
        key={target.id}
        type="button"
        disabled={busy}
        title={target.reason ? `${target.reason}` : `Add to ${target.name}`}
        onClick={(e) => { stop(e); onPick(target.id); }}
        onPointerDown={stop}
        className={`inline-flex items-center gap-1 max-w-[11rem] shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold leading-none transition-colors disabled:opacity-50 ${top
          ? 'border-[var(--brand-mid)]/60 bg-[var(--brand-mid)]/15 text-white hover:bg-[var(--brand-mid)]/30'
          : 'border-white/10 bg-white/5 text-neutral-300 hover:bg-white/10 hover:text-white'}`}
      >
        {top ? <Star className="w-3 h-3 fill-current text-[var(--brand-mid)] shrink-0" /> : <Plus className="w-3 h-3 shrink-0" />}
        <span className="truncate">{target.name}</span>
      </button>
    );
  };

  const picker = pickerOpen && createPortal(
    <div
      className={`fixed inset-0 z-[10000] flex bg-black/70 backdrop-blur-sm ${isMobile ? 'items-end' : 'items-center justify-center px-4 py-6'}`}
      onClick={(e) => { stop(e); setPickerOpen(false); }}
      onPointerDown={stop}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add to a playlist"
        onClick={stop}
        className={isMobile
          ? 'w-full max-h-[70dvh] rounded-t-3xl bg-neutral-950 border-t border-white/10 shadow-2xl flex flex-col pb-[env(safe-area-inset-bottom)]'
          : 'w-full max-w-sm rounded-3xl bg-neutral-950 border border-white/10 shadow-2xl flex flex-col max-h-[70vh]'}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <h2 className="text-lg font-bold text-white">Add to</h2>
          <button type="button" onClick={(e) => { stop(e); setPickerOpen(false); }} aria-label="Close" className="text-neutral-400 hover:text-white p-2">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="overflow-y-auto p-2">
          {targets.map((t) => {
            const suggested = suggestions.find((s) => s.id === t.id);
            return (
              <button
                key={t.id}
                type="button"
                onClick={(e) => { stop(e); setPickerOpen(false); onPick(t.id); }}
                className="w-full flex items-center gap-3 rounded-2xl px-4 py-3 text-left text-neutral-200 hover:bg-white/5 active:bg-white/10"
              >
                {suggested ? <Star className="w-4 h-4 fill-current text-[var(--brand-mid)] shrink-0" /> : <Plus className="w-4 h-4 text-neutral-500 shrink-0" />}
                <span className="flex-1 min-w-0">
                  <span className="block font-semibold truncate">{t.name}</span>
                  {suggested?.reason && <span className="block text-xs text-neutral-500">{suggested.reason}</span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>,
    document.body
  );

  return (
    <div className="flex items-center gap-1.5 mt-1.5 overflow-x-auto md:overflow-visible md:flex-wrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" onClick={stop} onPointerDown={stop}>
      {busy && <Loader className="w-3.5 h-3.5 animate-spin text-neutral-400" />}
      {!busy && suggestions.map(chip)}
      {!busy && (
        <button
          type="button"
          onClick={(e) => { stop(e); setPickerOpen(true); }}
          className="inline-flex items-center shrink-0 rounded-full border border-dashed border-white/15 px-2.5 py-1 text-[11px] font-semibold leading-none text-neutral-400 hover:text-white hover:border-white/30"
        >
          {suggestions.length ? 'More…' : 'Add to…'}
        </button>
      )}
      {picker}
    </div>
  );
}
