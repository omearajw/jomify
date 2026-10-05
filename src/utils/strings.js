// Loose comparison key for track names. Strips everything after the first " - " or "(" so
// "Song - Remastered 2011" and "Song (Live)" both reduce to "song", then keeps only [a-z0-9].
// This was copy-pasted into six files; it lives here now.
export function cleanString(str) {
  if (!str) return '';
  return str.split(/[-(]/)[0].toLowerCase().replace(/[^a-z0-9]/g, '').trim();
}

// Spotify returns playlist descriptions encoded for HTML ("It&#x27;s", "R&amp;B"), and its own
// playlists can carry links as tags, but takes plain text when one is saved. Shown as it came, an
// apostrophe read as &#x27;. Decoded until nothing changes, because the edit box used to be filled
// with the encoded text, so a description saved from it came back encoded twice.
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeOnce(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] !== '#') return NAMED_ENTITIES[code.toLowerCase()] ?? match;
    const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : match;
  });
}

export function fromSpotifyText(text) {
  if (!text) return '';
  let out = String(text).replace(/<[^>]*>/g, '');
  for (let i = 0; i < 3; i++) {
    const next = decodeOnce(out);
    if (next === out) break;
    out = next;
  }
  return out.trim();
}

// Spotify shows a description on one line, so line breaks typed into the box become spaces
export function toSpotifyDescription(text) {
  return String(text ?? '').replace(/\s*[\r\n]+\s*/g, ' ').trim();
}
