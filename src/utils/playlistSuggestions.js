// Ranks a user's check playlists as homes for a track. Spotify has no genres on tracks (and
// switched off audio features and recommendations for apps like this one), so a track's tags are
// its artists' genres. How a song sounds comes from ReccoBeats instead (src/services/soundFeatures):
// each playlist gets a sound profile, and a song that sounds like one more than like the others
// scores for it, which catches what the words miss (a sad song by an "indie rock" artist, a song
// with no tags at all).
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
const MOOD_BOOST = 1.5;          // mood words count this much more than genre words
const SOUND_WEIGHT = 2.5;        // a playlist the song clearly sounds like, against the others
const SOUND_MIN_TRACKS = 4;      // songs with measurements a playlist needs for a sound profile

// The measures that place a song, each on 0..1 (tempo scaled from 60-200 BPM), and how much each
// counts. Mood and energy say most about where a song belongs; tempo the least.
const SOUND_DIMS = [
  ['energy', 1.2], ['valence', 1.2], ['acousticness', 1], ['danceability', 0.8], ['instrumentalness', 0.6], ['tempo', 0.4]
];
const dimValue = (f, k) => (k === 'tempo' ? Math.max(0, Math.min(1, (f.tempo - 60) / 140)) : Math.max(0, Math.min(1, f[k])));

// Words that describe how a song feels rather than what it is. They come from Last.fm tags,
// count extra in the score, and get named in the reason so a mood decision is visible.
export const MOOD_WORDS = new Set([
  'sad', 'melancholic', 'melancholy', 'depressing', 'heartbreak', 'heartbroken', 'emotional', 'emo', 'moody', 'dark', 'gloomy', 'bittersweet',
  'happy', 'upbeat', 'uplifting', 'feel', 'feelgood', 'joyful', 'cheerful', 'fun', 'euphoric', 'sunny', 'summer', 'party', 'dance', 'hype', 'energetic', 'energy', 'anthem', 'workout',
  'chill', 'chillout', 'mellow', 'calm', 'relaxing', 'relax', 'peaceful', 'soothing', 'sleep', 'dreamy', 'dream', 'atmospheric', 'ambient', 'ethereal', 'hazy', 'lazy', 'slow', 'ballad', 'acoustic', 'piano',
  'love', 'romantic', 'sexy', 'sensual', 'nostalgic', 'nostalgia', 'angry', 'aggressive', 'intense', 'heavy', 'groovy', 'funky', 'smooth', 'soulful', 'epic', 'cinematic', 'night', 'late', 'rainy', 'winter', 'autumn', 'spring', 'road', 'driving'
]);

const add = (map, key, amount) => map.set(key, (map.get(key) || 0) + amount);

export function tokensOf(genre) {
  const lower = genre.toLowerCase();
  const words = lower.split(/[^a-z0-9]+/).filter((t) => t.length > 2);
  return words.length ? words : [lower];
}

// A song's terms: its artists' Spotify genres (full weight) plus its own Last.fm tags, which
// carry the mood ("sad", "upbeat", "chill") and are weighted by how strongly listeners applied
// them. Map term -> weight in (0, 1].
export function trackTerms(track, genresByArtist, tagsByTrack) {
  const out = new Map();
  for (const artist of track?.artists || []) {
    for (const genre of genresByArtist.get(artist.id) || []) out.set(genre.toLowerCase(), 1);
  }
  for (const tag of (tagsByTrack && track?.id ? tagsByTrack.get(track.id) : null) || []) {
    const name = String(tag.name || '').toLowerCase();
    if (!name) continue;
    const weight = Math.max(0.5, Math.min(1, (Number(tag.count) || 0) / 100));
    if ((out.get(name) || 0) < weight) out.set(name, weight);
  }
  return out;
}

export function trackGenres(track, genresByArtist, tagsByTrack) {
  return [...trackTerms(track, genresByArtist, tagsByTrack).keys()];
}

// tracks: [{ id, name, artists: [{ id, name }] }]; genresByArtist: Map artistId -> [genre];
// tagsByTrack: Map trackId -> [{ name, count }]. Shares are the (weighted) fraction of the
// playlist's tracks carrying the word or term.
export function buildProfile(tracks, genresByArtist, tagsByTrack = new Map(), featuresByTrack = new Map()) {
  const artistCounts = new Map();
  const soundSamples = [];
  const genreShare = new Map();
  const wordShare = new Map();
  let total = 0;
  for (const track of tracks) {
    if (!track?.artists?.length) continue;
    total += 1;
    for (const artist of track.artists) if (artist?.id) add(artistCounts, artist.id, 1);
    const terms = trackTerms(track, genresByArtist, tagsByTrack);
    const wordWeights = new Map();
    for (const [term, weight] of terms) {
      add(genreShare, term, weight);
      for (const word of tokensOf(term)) if ((wordWeights.get(word) || 0) < weight) wordWeights.set(word, weight);
    }
    for (const [word, weight] of wordWeights) add(wordShare, word, weight);
    const f = featuresByTrack.get(track.id);
    if (f) soundSamples.push(f);
  }
  if (total > 0) {
    for (const [k, v] of genreShare) genreShare.set(k, v / total);
    for (const [k, v] of wordShare) wordShare.set(k, v / total);
  }
  return { total, artistCounts, genreShare, wordShare, sound: soundProfile(soundSamples), rankedWords: [], rankedGenres: [], wordWeight: new Map(), genreWeight: new Map() };
}

// Typical value and spread of each measure. The spread has a floor, so a playlist of near-identical
// songs does not reject everything a hair different.
export function soundProfile(samples) {
  if (samples.length < SOUND_MIN_TRACKS) return null;
  const mean = {};
  const spread = {};
  for (const [k] of SOUND_DIMS) {
    const v = samples.map((f) => dimValue(f, k));
    const m = v.reduce((a, b) => a + b, 0) / v.length;
    const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
    mean[k] = m;
    spread[k] = Math.max(0.12, sd);
  }
  return { mean, spread, count: samples.length };
}

// How much a song sounds like a playlist, 0..1: 1 at its typical sound, falling off with distance
// measured in the playlist's own spread
export function soundSimilarity(features, sound) {
  if (!features || !sound) return null;
  let d2 = 0;
  let wsum = 0;
  for (const [k, w] of SOUND_DIMS) {
    const z = (dimValue(features, k) - sound.mean[k]) / sound.spread[k];
    d2 += w * z * z;
    wsum += w;
  }
  return Math.exp(-0.5 * (d2 / wsum));
}

// A few words for how a playlist sounds different from the user's other playlists, for the reason
// line. Against the others, because "mid-tempo" is true of most playlists and tells you nothing.
// others: the other playlists' sound profiles; with none, it describes the playlist on its own.
const SOUND_WORDS = { energy: ['energetic', 'calm'], valence: ['upbeat', 'moody'], acousticness: ['acoustic', null], danceability: ['danceable', null], instrumentalness: ['instrumental', null], tempo: ['faster', 'slower'] };
export function describeSound(sound, others = []) {
  if (!sound) return null;
  const peers = others.filter(Boolean);
  const words = [];
  for (const [k] of SOUND_DIMS) {
    const [up, down] = SOUND_WORDS[k];
    const base = peers.length ? peers.reduce((a, p) => a + p.mean[k], 0) / peers.length : 0.5;
    const diff = (sound.mean[k] - base) / (peers.length ? sound.spread[k] : 0.25);
    const word = diff > 0 ? up : down;
    if (word && Math.abs(diff) > 0.6) words.push([Math.abs(diff), word]);
  }
  words.sort((a, b) => b[0] - a[0]);
  return words.length ? words.slice(0, 2).map(([, w]) => w).join(', ') : null;
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
        soundWords: describeSound(entry.profile.sound, entries.filter((e) => e !== entry).map((e) => e.profile.sound)),
        rankedWords,
        rankedGenres,
        wordWeight: new Map(rankedWords.map((r) => [r.key, r.weight])),
        genreWeight: new Map(rankedGenres.map((r) => [r.key, r.weight]))
      }
    };
  });
}

// soundLift: how much more the song sounds like this playlist than like the user's others (0 when
// no better, or when either side has no measurements)
export function scoreTrack(track, genresByArtist, profile, tagsByTrack, soundLift = 0) {
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

  const genres = trackGenres(track, genresByArtist, tagsByTrack);
  const words = new Set(genres.flatMap(tokensOf));
  let genreSignal = 0;
  let bestWord = null;
  let bestWordWeight = 0;
  let bestMood = null;
  let bestMoodWeight = 0;
  for (const word of words) {
    const weight = profile.wordWeight.get(word) || 0;
    if (MOOD_WORDS.has(word)) {
      genreSignal += weight * MOOD_BOOST;
      if (weight > bestMoodWeight) { bestMoodWeight = weight; bestMood = word; }
    } else {
      genreSignal += weight;
    }
    if (weight > bestWordWeight) { bestWordWeight = weight; bestWord = word; }
  }
  for (const genre of genres) genreSignal += EXACT_GENRE_BONUS * (profile.genreWeight.get(genre) || 0);

  const soundSignal = SOUND_WEIGHT * soundLift;
  const score = (genreSignal + soundSignal) * (1 + ARTIST_BOOST * artistStrength) + ARTIST_ALONE * artistStrength;

  const reasons = [];
  if (bestWord) {
    const topWord = profile.rankedWords[0]?.key;
    const label = `${bestWord === topWord ? 'Mostly' : 'Lots of'} ${bestWord}`;
    // A mood match is the interesting part; say it even when a genre word scored higher
    reasons.push(bestMood && bestMood !== bestWord ? `${label}, ${bestMood}` : label);
  }
  // Said whenever the sound clearly counted, first when it outweighed the words
  if (soundLift > 0) {
    const sound = profile.soundWords ?? describeSound(profile.sound);
    if (sound && soundSignal >= genreSignal) reasons.unshift(`Sounds like it: ${sound}`);
    else if (sound) reasons.push(`sounds ${sound}`);
    if (reasons.length > 1) reasons[1] = reasons[1].charAt(0).toLowerCase() + reasons[1].slice(1);
  }
  if (matchedArtist) reasons.push(`${reasons.length ? 'already' : 'Already'} has ${matchedArtist.name || 'this artist'}`);
  return { score, reason: reasons.length ? reasons.join(', ') : null };
}

// entries: ranked [{ id, name, profile }] -> [{ id, name, score, reason }] best first. Anything
// with a signal is offered: more options beat fewer, even imperfect ones.
export function suggestPlaylists(track, genresByArtist, entries, { limit = 3, tagsByTrack, featuresByTrack } = {}) {
  // Sound counts only against the other playlists: if the song sounds a bit like all of them,
  // that says nothing about which one it belongs in
  const features = featuresByTrack?.get(track?.id) || null;
  const sims = entries.map((e) => soundSimilarity(features, e.profile?.sound));
  const known = sims.filter((v) => v !== null);
  const meanSim = known.length > 1 ? known.reduce((a, b) => a + b, 0) / known.length : null;
  return entries
    .map(({ id, name, profile }, i) => {
      // An edge this small is noise, not a reason
      const raw = meanSim === null || sims[i] === null ? 0 : sims[i] - meanSim;
      const lift = raw > 0.05 ? raw : 0;
      return { id, name, ...scoreTrack(track, genresByArtist, profile, tagsByTrack, lift) };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit);
}
