import { Ellipsis } from 'lucide-react';

// A visible way into the right-click menu on touch screens, where there is no right click and
// hover-revealed buttons never appear. Hidden on fine-pointer devices, where hover and
// right-click already cover it. `onOpen` gets the click event, so the menu positions itself
// from pageX/pageY exactly as it does for a right-click.
export default function MoreButton({ onOpen, label = 'More options', className = '' }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onOpen(e); }}
      onPointerDown={(e) => e.stopPropagation()}
      aria-label={label}
      className={`hidden pointer-coarse:flex items-center justify-center w-10 h-10 -mr-2 rounded-full text-neutral-400 active:bg-white/10 shrink-0 ${className}`}
    >
      <Ellipsis className="w-5 h-5" />
    </button>
  );
}
