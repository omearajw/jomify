// The largest font size at which `text` fits a box of width w in at most `maxLines` lines and
// `maxHeight` tall. A character of this bold face is roughly 0.56em wide, a line 1.05em tall;
// an estimate, so the box keeps a little slack.
export function fitFontSize(text, w, maxHeight, maxLines = 3, { charWidth = 0.56, lineHeight = 1.05 } = {}) {
  const len = Math.max(1, String(text || '').length);
  let lo = 6;
  let hi = Math.max(lo, maxHeight / lineHeight);
  const fits = (f) => {
    const perLine = Math.max(1, Math.floor(w / (f * charWidth)));
    // Words wrap whole, so a line holds fewer characters than the arithmetic says
    const lines = Math.ceil(len / Math.max(1, perLine - 2));
    return lines <= maxLines && lines * lineHeight * f <= maxHeight;
  };
  for (let k = 0; k < 18; k++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid; else hi = mid;
  }
  return Math.floor(lo);
}
