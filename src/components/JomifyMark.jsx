// Jack's mark, drawn in the room's off-white rather than the old orange-to-purple gradient (which
// the new look has otherwise dropped): the PNG's own shape is the mask, so the files stay as made.
// The fill is opaque and the strength comes from opacity (--room-mark, the rail words' grey), so
// overlapping shapes in UnfoldingMark never add up to a brighter patch.
const ICON = '/Jomify-Icon.png'; // 1000 × 1000
const WORD = '/Jomify-Logo.png'; // 880 × 475

const masked = (src) => ({
  background: 'var(--room-paper)',
  WebkitMaskImage: `url(${src})`, maskImage: `url(${src})`,
  WebkitMaskSize: '100% 100%', maskSize: '100% 100%',
  WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat'
});

export default function JomifyMark({ word = false, size = 20, className = '', title = 'Jomify' }) {
  const ratio = word ? 880 / 475 : 1;
  return (
    <span role="img" aria-label={title} className={`inline-block shrink-0 ${className}`}
      style={{ width: Math.round(size * ratio), height: size, opacity: 'var(--room-mark)', ...masked(word ? WORD : ICON) }} />
  );
}

// The rail's mark. Closed, the J stands upright like the rail's words; when the library opens it
// turns a quarter clockwise and "omify" appears in its hook. The wordmark's J is the icon's J
// turned 90° clockwise at the same scale (measured 15 Oct: with the icon turned about its
// centre, the wordmark's corner sits 72 px right of and 202 px below the icon's box), so the
// turned icon lies exactly on the wordmark's J and only the letters fade in. Change either PNG and these numbers move.
const H = 24;                  // the wordmark's height when open, px: 44 wide, inside the 58 px rail
const S = H / 475;             // px per image pixel
const BOX = 1000 * S;          // the icon's box
const WORD_X = 72 * S;         // the wordmark within the icon's box
const WORD_Y = 202 * S;

// Closed it is half the size, centred on the rail (29 px). The size itself moves, not a scale:
// a browser draws a scaled element once at its starting size and stretches that while it moves,
// so the mark went blocky as it grew and only sharpened when it stopped (Jack, 20 Oct).
const pct = (v) => `${(v / BOX) * 100}%`;

export function UnfoldingMark({ open, left, top }) {
  const ease = 'var(--room-ease)';
  const side = open ? BOX : BOX / 2;
  return (
    <span role="img" aria-label="Jomify" className="pointer-events-none absolute motion-reduce:!transition-none [&_*]:motion-reduce:!transition-none"
      style={{
        left: open ? left : 29 - BOX / 4, top: open ? top : top + BOX / 4, width: side, height: side, opacity: 'var(--room-mark)',
        transition: ['left', 'top', 'width', 'height'].map((p) => `${p} var(--room-mid) ${ease}`).join(', ')
      }}>
      <span className="absolute inset-0 motion-reduce:!transition-none"
        style={{ ...masked(ICON), transform: open ? 'rotate(90deg)' : 'none', transition: `transform var(--room-mid) ${ease}` }} />
      <span className="absolute motion-reduce:!transition-none"
        style={{
          ...masked(WORD), left: pct(WORD_X), top: pct(WORD_Y), width: pct(880 * S), height: pct(H),
          opacity: open ? 1 : 0,
          // in after the turn has mostly happened; out at once on the way back, before it turns
          transition: open ? `opacity 380ms ease-out 420ms` : 'opacity 160ms ease-in'
        }} />
    </span>
  );
}
