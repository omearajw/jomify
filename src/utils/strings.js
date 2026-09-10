// Loose comparison key for track names. Strips everything after the first " - " or "(" so
// "Song - Remastered 2011" and "Song (Live)" both reduce to "song", then keeps only [a-z0-9].
// This was copy-pasted into six files; it lives here now.
export function cleanString(str) {
  if (!str) return '';
  return str.split(/[-(]/)[0].toLowerCase().replace(/[^a-z0-9]/g, '').trim();
}
