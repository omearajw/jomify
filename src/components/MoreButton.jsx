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

// The same, for a card: sits over the artwork's top-right corner, visible on touch screens and
// on hover. The card needs `group` and the artwork wrapper `relative`.
export function CardMoreButton({ onOpen, label = 'More options' }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onOpen(e); }}
      onPointerDown={(e) => e.stopPropagation()}
      aria-label={label}
      className="absolute top-2 right-2 z-10 w-8 h-8 bg-black/60 hover:bg-black text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100 focus-visible:opacity-100 backdrop-blur-md transition-opacity"
    >
      <Ellipsis className="w-4 h-4" />
    </button>
  );
}
