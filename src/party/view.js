import qrcode from 'qrcode-generator';

// Small things every party screen needs: who asked for the song playing, and the join QR.

const artistsOf = (x) => (Array.isArray(x?.artists) ? x.artists.map((a) => a.name).join(', ') : x?.artists || '');
// The same song: by uri, or by name and artists, since Spotify can play a relinked copy under
// another uri and this app no longer gets told which one it stood in for
export const sameSong = (a, b) => Boolean(a && b && (a.uri === b.uri || (a.name && a.name === b.name && artistsOf(a) === artistsOf(b))));

// The guest who requested what is playing, or null if it came from the playlist. `playing` can be
// a party snapshot's nowPlaying or a player track; the request is the one just played (history)
// or the one handed to Spotify (upNext).
export function requestedBy(playing, { history, upNext } = {}) {
  if (!playing) return null;
  const item = [history?.[0], upNext].find((i) => sameSong(playing, i));
  return item ? item.guestName || null : null;
}

const qrCache = new Map();
export function qrSvg(text) {
  if (qrCache.has(text)) return qrCache.get(text);
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const svg = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  qrCache.set(text, svg);
  return svg;
}
