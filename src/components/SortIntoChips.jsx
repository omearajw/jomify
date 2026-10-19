import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader } from 'lucide-react';
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
        className={`ui-headword inline-block max-w-[11rem] shrink-0 truncate py-0.5 text-[12px] font-medium leading-tight disabled:opacity-40 ${top
          ? 'text-[var(--room-paper)] decoration-[var(--room-paper)]'
          : 'text-[var(--room-dim)] hover:text-[var(--room-paper)]'}`}
      >
        {target.name}
      </button>
    );
  };

  const picker = pickerOpen && createPortal(
    <div
      className={`fixed inset-0 z-[10000] flex bg-black/60 ${isMobile ? 'items-end' : 'items-center justify-center px-4 py-6'}`}
      onClick={(e) => { stop(e); setPickerOpen(false); }}
      onPointerDown={stop}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add to a playlist"
        onClick={stop}
        className={isMobile
          ? 'ui-plane flex max-h-[70dvh] w-full flex-col rounded-t-[10px] pb-[env(safe-area-inset-bottom)]'
          : 'ui-plane flex max-h-[70vh] w-full max-w-sm flex-col'}
      >
        <div className="flex items-center justify-between px-6 pb-3 pt-5">
          <h2 className="room-mono text-[var(--room-dim)]">Add to</h2>
          <button type="button" onClick={(e) => { stop(e); setPickerOpen(false); }} className="ui-word">Close</button>
        </div>
        <div className="custom-scrollbar overflow-y-auto px-6 pb-4">
          {targets.map((t) => {
            const suggested = suggestions.find((s) => s.id === t.id);
            return (
              <button
                key={t.id}
                type="button"
                onClick={(e) => { stop(e); setPickerOpen(false); onPick(t.id); }}
                className={`ui-row min-h-[44px] ${suggested ? 'text-[var(--room-paper)]' : ''}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{t.name}</span>
                  {suggested?.reason && <span className="block text-[11.5px] font-normal text-[var(--room-faint)]">{suggested.reason}</span>}
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
    <div className="flex items-center gap-x-4 gap-y-1 mt-1.5 overflow-x-auto md:overflow-visible md:flex-wrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" onClick={stop} onPointerDown={stop}>
      {busy && <Loader className="h-3.5 w-3.5 animate-spin text-[var(--room-faint)]" />}
      {!busy && suggestions.map(chip)}
      {!busy && (
        <button
          type="button"
          onClick={(e) => { stop(e); setPickerOpen(true); }}
          className="ui-word shrink-0"
        >
          {suggestions.length ? 'More…' : 'Add to…'}
        </button>
      )}
      {picker}
    </div>
  );
}
