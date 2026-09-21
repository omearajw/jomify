// Case table for the Unadded Songs "sort into" ranking.
// Run with: node scripts/suggest-cases.mjs

import { buildProfile, scoreTrack, suggestPlaylists, trackGenres, MIN_SCORE } from '../src/utils/playlistSuggestions.js';

let pass = 0;
let fail = 0;
const failures = [];
const check = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); console.log('  FAIL ', name); } };
const section = (t) => console.log(`\n-- ${t} --`);

const A = (id, name) => ({ id, name });
const T = (id, ...artists) => ({ id, artists });
const genres = new Map([
  ['tame', ['psychedelic rock', 'australian psych']],
  ['mgmt', ['indie rock', 'psychedelic pop']],
  ['drake', ['hip hop', 'canadian hip hop', 'rap']],
  ['kendrick', ['hip hop', 'west coast rap']],
  ['adele', ['pop', 'british soul']],
  ['nobody', []]
]);

const psych = buildProfile([T('t1', A('tame', 'Tame Impala')), T('t2', A('tame', 'Tame Impala')), T('t3', A('mgmt', 'MGMT'))], genres);
const rap = buildProfile([T('r1', A('drake', 'Drake')), T('r2', A('kendrick', 'Kendrick Lamar')), T('r3', A('drake', 'Drake')), T('r4', A('drake', 'Drake'))], genres);
const empty = buildProfile([], genres);
const profiles = [{ id: 'psych', name: 'Psych', profile: psych }, { id: 'rap', name: 'Rap', profile: rap }, { id: 'empty', name: 'Empty', profile: empty }];

section('profiles');
check('counts tracks', psych.total === 3 && rap.total === 4 && empty.total === 0);
check('counts artists', psych.artistCounts.get('tame') === 2 && rap.artistCounts.get('drake') === 3);
check('genre weights are fractions of the playlist', Math.abs(rap.genreWeights.get('hip hop') - (3 * (1 / 3) + 1 / 2) / 4) < 1e-9);
check('genre words get their own weights', rap.tokenWeights.get('hop') > 0 && rap.tokenWeights.get('rap') > 0);
check('a track by an artist with no genres still counts for the artist signal', buildProfile([T('x', A('nobody', 'Nobody'))], genres).artistCounts.get('nobody') === 1);
check('track genres are the union of its artists', trackGenres(T('x', A('tame'), A('mgmt')), genres).length === 4);

section('scoring');
const newTame = T('n1', A('tame', 'Tame Impala'));
const newDrake = T('n2', A('drake', 'Drake'));
const newKendrick = T('n3', A('kendrick', 'Kendrick Lamar'));
const newAdele = T('n4', A('adele', 'Adele'));
const unknown = T('n5', A('nobody', 'Nobody'));
const rapNoArtists = { ...rap, artistCounts: new Map() };
check('same artist beats genre-only', scoreTrack(newTame, genres, psych).score > scoreTrack(newKendrick, genres, rapNoArtists).score);
check('genre-only still scores', scoreTrack(newKendrick, genres, rapNoArtists).score > MIN_SCORE);
check('three earlier songs by the artist is a full artist signal', scoreTrack(newDrake, genres, rap).score > scoreTrack(newTame, genres, psych).score);
check('reason names the artist when present', scoreTrack(newDrake, genres, rap).reason === 'Already has Drake');
check('reason names the genre otherwise', scoreTrack(newKendrick, genres, rapNoArtists).reason === 'Lots of hip hop');
check('a playlist of nothing scores nothing', scoreTrack(newDrake, genres, empty).score === 0);
check('an artist with no genres and no history scores nothing', scoreTrack(unknown, genres, rap).score === 0 && scoreTrack(unknown, genres, rap).reason === null);
// MGMT's "psychedelic pop" shares a word with the playlist's "psychedelic rock"
check('genre words give partial credit across micro-genres', scoreTrack(T('n7', A('mgmt')), genres, { ...psych, artistCounts: new Map(), genreWeights: new Map() }).score > 0);

section('ranking');
const forDrake = suggestPlaylists(newDrake, genres, profiles);
check('best playlist first', forDrake[0]?.id === 'rap');
check('drops playlists with no signal', !forDrake.some((s) => s.id === 'empty'));
check('a pop song fits nothing here', suggestPlaylists(newAdele, genres, profiles).length === 0);
check('respects the limit', suggestPlaylists(newDrake, genres, [...profiles, { id: 'rap2', name: 'Rap 2', profile: rap }, { id: 'rap3', name: 'Rap 3', profile: rap }], { limit: 2 }).length === 2);
check('ties break by name', suggestPlaylists(newDrake, genres, [{ id: 'b', name: 'B', profile: rap }, { id: 'a', name: 'A', profile: rap }]).map((s) => s.id).join() === 'a,b');
check('minimum score is applied', suggestPlaylists(newKendrick, genres, profiles, { minScore: 0.99 }).length === 0 && MIN_SCORE < 0.99);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log(failures.map(f => `  - ${f}`).join('\n')); process.exit(1); }
console.log('');
