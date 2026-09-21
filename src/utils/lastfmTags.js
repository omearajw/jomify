// Last.fm tags are typed by listeners, so alongside "sad" and "upbeat" they carry noise like
// "seen live" and "albums i own". Shared by the server (which fetches) and the tests.

const JUNK = new Set([
  'seen live', 'favorites', 'favourites', 'favorite', 'favourite', 'my favorites', 'my favourites',
  'favorite songs', 'favourite songs', 'albums i own', 'spotify', 'love', 'loved', 'good', 'great',
  'awesome', 'amazing', 'best', 'beautiful', 'cool', 'fun', 'nice', 'like', 'i like', 'check out',
  'want to hear', 'to listen', 'listen', 'music', 'songs', 'song', 'single', 'singles', 'album',
  'radio', 'top 40', 'hit', 'hits', 'classic', 'classics', 'overrated', 'underrated', 'perfect',
  'epic', 'genius', 'lol', 'wtf', 'male vocalists', 'female vocalists', 'male vocalist', 'female vocalist',
  'male vocals', 'female vocals', 'usa', 'uk', 'american', 'british', 'english', 'canadian', 'australian'
]);

export const MIN_TAG_COUNT = 8;
export const MAX_TAGS = 10;

// `artist` lets the artist's own name be dropped: listeners tag songs with it constantly
export function cleanTags(rawTags, artist = '') {
  const out = [];
  const seen = new Set();
  const artistName = String(artist).trim().toLowerCase();
  for (const raw of rawTags || []) {
    const name = String(raw?.name || '').trim().toLowerCase();
    const count = Number(raw?.count) || 0;
    if (!name || count < MIN_TAG_COUNT || seen.has(name)) continue;
    if (JUNK.has(name)) continue;
    if (/^\d{2,4}s?$/.test(name)) continue;            // "2015", "80s", "2010s"
    if (/^(\d+|[^a-z0-9]+)$/.test(name)) continue;
    if (artistName && (name === artistName || name.includes(artistName))) continue;
    if (/\b(fm|radio|station)\b|\d+\.\d+/.test(name)) continue; // "wsum 91.7 fm madison"
    seen.add(name);
    out.push({ name, count });
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}
