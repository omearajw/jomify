// Case table for the Unadded Songs "sort into" ranking.
// Run with: node scripts/suggest-cases.mjs

import { buildProfile, rankProfiles, scoreTrack, suggestPlaylists, trackGenres, tokensOf } from '../src/utils/playlistSuggestions.js';

let pass = 0;
let fail = 0;
const failures = [];
const check = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); console.log('  FAIL ', name); } };
const section = (t) => console.log(`\n-- ${t} --`);

const A = (id, name) => ({ id, name });
const T = (id, ...artists) => ({ id, artists });
const genres = new Map([
  ['tame', ['psychedelic rock', 'indie rock']],
  ['mgmt', ['indie pop', 'psychedelic pop']],
  ['strokes', ['garage rock', 'indie rock']],
  ['arctic', ['indie rock', 'rock']],
  ['psyonly', ['psychedelic']],
  ['drake', ['hip hop', 'canadian hip hop', 'rap']],
  ['kendrick', ['hip hop', 'west coast rap']],
  ['adele', ['pop', 'british soul']],
  ['nobody', []],
  ['newcomer', ['hip hop', 'trap', 'phonk', 'cloud rap']],
  ['weeknd', ['r&b', 'neo soul']]
]);

const rockTracks = [T('r1', A('tame', 'Tame Impala')), T('r2', A('strokes', 'The Strokes')), T('r3', A('arctic', 'Arctic Monkeys')), T('r4', A('arctic', 'Arctic Monkeys'))];
const psychTracks = [T('s1', A('tame', 'Tame Impala')), T('s2', A('mgmt', 'MGMT')), T('s3', A('mgmt', 'MGMT'))];
const rapTracks = [T('h1', A('drake', 'Drake')), T('h2', A('kendrick', 'Kendrick Lamar')), T('h3', A('drake', 'Drake')), T('h4', A('drake', 'Drake'))];

const raw = [
  { id: 'rock', name: 'Rock', profile: buildProfile(rockTracks, genres) },
  { id: 'psych', name: 'Psych', profile: buildProfile(psychTracks, genres) },
  { id: 'rap', name: 'Rap', profile: buildProfile(rapTracks, genres) },
  { id: 'empty', name: 'Empty', profile: buildProfile([], genres) }
];
const ranked = rankProfiles(raw);
const byId = (id) => ranked.find((e) => e.id === id).profile;

section('tags');
check('genre words drop short tokens', tokensOf('hip hop').join() === 'hip,hop' && tokensOf('uk drill').join() === 'drill');
check('a genre with no long word survives whole', tokensOf('r&b').join() === 'r&b');
check('track genres are the union of its artists', trackGenres(T('x', A('tame'), A('mgmt')), genres).length === 4);

section('profiles');
check('counts tracks and artists', byId('rock').total === 4 && byId('rock').artistCounts.get('arctic') === 2);
check('word share is the fraction of tracks carrying the word', Math.abs(byId('rock').wordShare.get('rock') - 1) < 1e-9 && Math.abs(byId('rock').wordShare.get('garage') - 1 / 4) < 1e-9);
check('the empty playlist has nothing ranked', byId('empty').rankedWords.length === 0);

section('ranking within a playlist');
const rapWords = byId('rap').rankedWords.map((r) => r.key);
check('rap playlist is mostly hip hop', rapWords[0] === 'hip' || rapWords[0] === 'hop');
check('rock playlist ranks rock first', byId('rock').rankedWords[0].key === 'rock');
// "indie" is in every rock-ish track of both guitar playlists; "psychedelic" is what sets Psych apart
check('a word every playlist shares sinks below what sets one apart', byId('psych').wordWeight.get('psychedelic') > byId('psych').wordWeight.get('indie'));
check('distinctiveness is capped', byId('rap').rankedWords.every((r) => r.weight <= r.share * 3 + 1e-9));

section('scoring');
const newTame = T('n1', A('tame', 'Tame Impala'));
const newMgmt = T('n2', A('mgmt', 'MGMT'));
const newcomer = T('n3', A('newcomer', 'Newcomer'));
const unknown = T('n4', A('nobody', 'Nobody'));
const weeknd = T('n5', A('weeknd', 'The Weeknd'));
check('genres alone score', scoreTrack(newcomer, genres, byId('rap')).score > 0 && scoreTrack(newcomer, genres, byId('rap')).reason.startsWith('Mostly h'));
check('an artist already there multiplies the genre score', scoreTrack(newTame, genres, byId('rock')).score > scoreTrack(T('n6', A('newtame')), new Map([['newtame', genres.get('tame')]]), byId('rock')).score);
check('reason gives both signals when both apply', scoreTrack(newTame, genres, byId('rock')).reason === 'Mostly rock, already has Tame Impala');
check('"Lots of" when the matched word is not the playlist\'s top word', scoreTrack(T('n8', A('psyonly', 'Psy')), genres, byId('rock')).reason === 'Lots of psychedelic');
check('an untagged artist nobody has scores nothing', scoreTrack(unknown, genres, byId('rap')).score === 0 && scoreTrack(unknown, genres, byId('rap')).reason === null);
const drakeUntagged = T('n7', A('drake', 'Drake'));
check('an untagged artist already in the playlist still scores', scoreTrack(drakeUntagged, new Map(), byId('rap')).score > 0 && scoreTrack(drakeUntagged, new Map(), byId('rap')).reason === 'Already has Drake');
check('a playlist of nothing scores nothing', scoreTrack(newTame, genres, byId('empty')).score === 0);

section('suggestions');
const forNewcomer = suggestPlaylists(newcomer, genres, ranked);
check('best playlist first', forNewcomer[0]?.id === 'rap');
check('only playlists with a signal are offered', forNewcomer.every((s) => s.score > 0) && !forNewcomer.some((s) => s.id === 'empty'));
check('a tagged song gets every playlist with any overlap, up to three', suggestPlaylists(newMgmt, genres, ranked).map((s) => s.id).join() === 'psych,rock');
check('a song matching nothing gets no picks', suggestPlaylists(weeknd, genres, ranked).length === 0);
check('respects the limit', suggestPlaylists(newTame, genres, [...ranked, ...ranked.map((e) => ({ ...e, id: e.id + '2', name: e.name + ' 2' }))], { limit: 2 }).length === 2);
check('ties break by name', suggestPlaylists(newTame, genres, [{ ...ranked[0], id: 'b', name: 'B' }, { ...ranked[0], id: 'a', name: 'A' }]).map((s) => s.id).join() === 'a,b');
check('psych song lands in Psych over Rock', suggestPlaylists(newMgmt, genres, ranked)[0].id === 'psych');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log(failures.map(f => `  - ${f}`).join('\n')); process.exit(1); }
console.log('');
