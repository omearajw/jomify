// Ranks a user's check playlists as homes for a track. Spotify has no genres on tracks (and
// switched off audio features and recommendations for apps like this one), so a track's tags are
// its artists' genres, and a playlist's taste is the artists and genres of what is already in it.
// Two signals: the playlist already holding this artist (strong) and genre overlap (softer),
// with genre words ("indie" in "indie rock" and "indie pop") giving partial credit because
// Spotify's micro-genres rarely match exactly.

const ARTIST_WEIGHT = 0.65;
const GENRE_WEIGHT = 0.35;
const EXACT_SHARE = 0.7;
const TOKEN_SHARE = 0.3;
// Genre fractions are small even in a focused playlist (30% "indie rock" is a lot), so they are
// stretched before mixing with the 0..1 artist signal
const GENRE_STRETCH = 2.5;
export const MIN_SCORE = 0.08;
// A song's best-matching genre says more than the average across its four or five micro-genres,
// most of which no playlist will name
const BEST_GENRE_SHARE = 0.6;
// A genre has to be at least this much of a playlist before the reason claims "lots of" it
const GENRE_REASON_MIN = 0.1;

const tokensOf = (genre) => genre.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2);

const add = (map, key, amount) => map.set(key, (map.get(key) || 0) + amount);

export function trackGenres(track, genresByArtist) {
  const out = new Set();
  for (const artist of track?.artists || []) {
    for (const genre of genresByArtist.get(artist.id) || []) out.add(genre.toLowerCase());
  }
  return [...out];
}

// tracks: [{ id, artists: [{ id, name }] }]; genresByArtist: Map artistId -> [genre]
export function buildProfile(tracks, genresByArtist) {
  const artistCounts = new Map();
  const genreWeights = new Map();
  const tokenWeights = new Map();
  let total = 0;
  for (const track of tracks) {
    if (!track?.artists?.length) continue;
    total += 1;
    for (const artist of track.artists) {
      if (artist?.id) add(artistCounts, artist.id, 1);
    }
    const genres = trackGenres(track, genresByArtist);
    if (genres.length === 0) continue;
    const genreShare = 1 / genres.length;
    const tokens = new Set(genres.flatMap(tokensOf));
    for (const genre of genres) add(genreWeights, genre, genreShare);
    for (const token of tokens) add(tokenWeights, token, 1 / tokens.size);
  }
  if (total > 0) {
    for (const [k, v] of genreWeights) genreWeights.set(k, v / total);
    for (const [k, v] of tokenWeights) tokenWeights.set(k, v / total);
  }
  return { total, artistCounts, genreWeights, tokenWeights };
}

export function scoreTrack(track, genresByArtist, profile) {
  if (!profile || profile.total === 0) return { score: 0, reason: null };

  let artistScore = 0;
  let matchedArtist = null;
  for (const artist of track?.artists || []) {
    const count = profile.artistCounts.get(artist.id) || 0;
    if (count === 0) continue;
    // One earlier song by the artist is a hint; three or more is a home
    const strength = Math.min(count, 3) / 3;
    if (strength > artistScore) { artistScore = strength; matchedArtist = artist; }
  }

  const genres = trackGenres(track, genresByArtist);
  let genreScore = 0;
  let bestGenre = null;
  let bestGenreWeight = 0;
  if (genres.length > 0) {
    let exact = 0;
    for (const genre of genres) {
      const weight = profile.genreWeights.get(genre) || 0;
      exact += weight;
      if (weight > bestGenreWeight) { bestGenreWeight = weight; bestGenre = genre; }
    }
    const tokens = [...new Set(genres.flatMap(tokensOf))];
    let fuzzy = 0;
    for (const token of tokens) fuzzy += profile.tokenWeights.get(token) || 0;
    const exactMean = exact / genres.length;
    const exactBlend = BEST_GENRE_SHARE * bestGenreWeight + (1 - BEST_GENRE_SHARE) * exactMean;
    const fuzzyMean = tokens.length ? fuzzy / tokens.length : 0;
    genreScore = Math.min(1, (EXACT_SHARE * exactBlend + TOKEN_SHARE * fuzzyMean) * GENRE_STRETCH);
  }

  const score = ARTIST_WEIGHT * artistScore + GENRE_WEIGHT * genreScore;
  const reasons = [];
  if (matchedArtist) reasons.push(`Already has ${matchedArtist.name || 'this artist'}`);
  if (bestGenre && bestGenreWeight >= GENRE_REASON_MIN) reasons.push(`${matchedArtist ? 'lots' : 'Lots'} of ${bestGenre}`);
  return { score, reason: reasons.length ? reasons.join(' and ') : null };
}

// profiles: [{ id, name, profile }] -> [{ id, name, score, reason }] best first, at most `limit`
export function suggestPlaylists(track, genresByArtist, profiles, { limit = 3, minScore = MIN_SCORE } = {}) {
  return profiles
    .map(({ id, name, profile }) => ({ id, name, ...scoreTrack(track, genresByArtist, profile) }))
    .filter((s) => s.score >= minScore)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit);
}
