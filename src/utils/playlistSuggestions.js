// Ranks a user's check playlists as homes for a track. Spotify has no genres on tracks (and
// switched off audio features and recommendations for apps like this one), so a track's tags are
// its artists' genres.
//
// Each playlist gets a ranked list of genre words ("rock", "psychedelic", "indie") and full
// genres, weighted by how much of the playlist carries them and by how distinctive that is
// against the user's other check playlists: if every playlist is a third "indie", "indie"
// says nothing about where a song belongs, so it sinks. A song scores against a playlist by the
// rank weights of the words and genres it carries. An artist already in the playlist confirms
// the pick and multiplies the score; when a song has no tags at all the artist alone still
// suggests.

const EXACT_GENRE_BONUS = 2;     // a full-genre match counts on top of its words
const ARTIST_BOOST = 1;          // genre score multiplier per unit of artist strength
const ARTIST_ALONE = 0.4;        // score an artist match earns with no genre signal
const MAX_DISTINCT = 3;          // cap on the "more than the other playlists" multiplier

const add = (map, key, amount) => map.set(key, (map.get(key) || 0) + amount);

export function tokensOf(genre) {
  const lower = genre.toLowerCase();
  const words = lower.split(/[^a-z0-9]+/).filter((t) => t.length > 2);
  return words.length ? words : [lower];
}

export function trackGenres(track, genresByArtist) {
  const out = new Set();
  for (const artist of track?.artists || []) {
    for (const genre of genresByArtist.get(artist.id) || []) out.add(genre.toLowerCase());
  }
  return [...out];
}

// tracks: [{ id, artists: [{ id, name }] }]; genresByArtist: Map artistId -> [genre]
// Shares are the fraction of the playlist's tracks carrying the word or genre.
export function buildProfile(tracks, genresByArtist) {
  const artistCounts = new Map();
  const genreShare = new Map();
  const wordShare = new Map();
  let total = 0;
  for (const track of tracks) {
    if (!track?.artists?.length) continue;
    total += 1;
    for (const artist of track.artists) if (artist?.id) add(artistCounts, artist.id, 1);
    const genres = trackGenres(track, genresByArtist);
    for (const genre of genres) add(genreShare, genre, 1);
    for (const word of new Set(genres.flatMap(tokensOf))) add(wordShare, word, 1);
  }
  if (total > 0) {
    for (const [k, v] of genreShare) genreShare.set(k, v / total);
    for (const [k, v] of wordShare) wordShare.set(k, v / total);
  }
  return { total, artistCounts, genreShare, wordShare, rankedWords: [], rankedGenres: [], wordWeight: new Map(), genreWeight: new Map() };
}

function distinctiveness(share, key, profiles, field) {
  let sum = 0;
  for (const p of profiles) sum += p.profile[field].get(key) || 0;
  const mean = sum / profiles.length;
  return mean > 0 ? Math.min(MAX_DISTINCT, share / mean) : 1;
}

// Gives every profile its ranked lists, weighed against the others. Returns new entries.
export function rankProfiles(entries) {
  return entries.map((entry) => {
    const rank = (field) => [...entry.profile[field]]
      .map(([key, share]) => ({ key, share, weight: share * distinctiveness(share, key, entries, field) }))
      .sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key));
    const rankedWords = rank('wordShare');
    const rankedGenres = rank('genreShare');
    return {
      ...entry,
      profile: {
        ...entry.profile,
        rankedWords,
        rankedGenres,
        wordWeight: new Map(rankedWords.map((r) => [r.key, r.weight])),
        genreWeight: new Map(rankedGenres.map((r) => [r.key, r.weight]))
      }
    };
  });
}

export function scoreTrack(track, genresByArtist, profile) {
  if (!profile || profile.total === 0) return { score: 0, reason: null };

  let artistStrength = 0;
  let matchedArtist = null;
  for (const artist of track?.artists || []) {
    const count = profile.artistCounts.get(artist.id) || 0;
    if (count === 0) continue;
    // One earlier song by the artist is a hint; three or more is a home
    const strength = Math.min(count, 3) / 3;
    if (strength > artistStrength) { artistStrength = strength; matchedArtist = artist; }
  }

  const genres = trackGenres(track, genresByArtist);
  const words = new Set(genres.flatMap(tokensOf));
  let genreSignal = 0;
  let bestWord = null;
  let bestWordWeight = 0;
  for (const word of words) {
    const weight = profile.wordWeight.get(word) || 0;
    genreSignal += weight;
    if (weight > bestWordWeight) { bestWordWeight = weight; bestWord = word; }
  }
  for (const genre of genres) genreSignal += EXACT_GENRE_BONUS * (profile.genreWeight.get(genre) || 0);

  const score = genreSignal * (1 + ARTIST_BOOST * artistStrength) + ARTIST_ALONE * artistStrength;

  const reasons = [];
  if (bestWord) {
    const topWord = profile.rankedWords[0]?.key;
    reasons.push(`${bestWord === topWord ? 'Mostly' : 'Lots of'} ${bestWord}`);
  }
  if (matchedArtist) reasons.push(`${reasons.length ? 'already' : 'Already'} has ${matchedArtist.name || 'this artist'}`);
  return { score, reason: reasons.length ? reasons.join(', ') : null };
}

// entries: ranked [{ id, name, profile }] -> [{ id, name, score, reason }] best first. Anything
// with a signal is offered: more options beat fewer, even imperfect ones.
export function suggestPlaylists(track, genresByArtist, entries, { limit = 3 } = {}) {
  return entries
    .map(({ id, name, profile }) => ({ id, name, ...scoreTrack(track, genresByArtist, profile) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit);
}
