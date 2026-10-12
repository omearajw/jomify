// The demo listener's Spotify, built from the catalogue: everything shaped as Spotify's Web API
// answers it, so the app cannot tell the difference. Changes made during a visit (likes,
// playlist edits) live here in memory and are gone when the tab closes.

import { DEMO_ALBUMS } from './catalogue.js';

export const DEMO_USER = { id: 'jomifydemo', display_name: 'Demo listener', type: 'user', uri: 'spotify:user:jomifydemo', images: [], followers: { total: 12 }, product: 'premium', country: 'GB', external_urls: {} };
export const DEMO_FRIEND = { id: 'alexdemo', display_name: 'Alex', type: 'user', uri: 'spotify:user:alexdemo', images: [], followers: { total: 31 }, external_urls: {} };

const GENRES = {
  'Tame Impala': ['psychedelic pop', 'australian psych'], Oasis: ['britpop', 'madchester'], 'The Weeknd': ['canadian contemporary r&b', 'pop'],
  'Arctic Monkeys': ['garage rock', 'sheffield indie'], 'Daft Punk': ['electro', 'filter house'], 'Fleetwood Mac': ['soft rock', 'album rock'],
  Deftones: ['alternative metal', 'nu metal'], Gorillaz: ['alternative hip hop', 'trip hop'], 'Billie Eilish': ['art pop', 'pop'],
  'Frank Ocean': ['alternative r&b', 'neo soul'], Radiohead: ['art rock', 'alternative rock'], Nirvana: ['grunge', 'alternative rock']
};

// Ids must look like Spotify's (letters and digits only): routes and links parse them that way
const slugId = (name) => `demo${String(name).replace(/[^A-Za-z0-9]/g, '')}`.slice(0, 40);

const artists = new Map();
const artistFor = (name) => {
  if (!artists.has(name)) {
    const id = slugId(name);
    artists.set(name, { id, name, type: 'artist', uri: `spotify:artist:${id}`, external_urls: {}, genres: GENRES[name] || [], followers: { total: 1000000 + name.length * 734211 }, popularity: 70, images: [] });
  }
  return artists.get(name);
};
const brief = (a) => ({ id: a.id, name: a.name, type: 'artist', uri: a.uri, external_urls: {} });

export const ALBUMS = [];
export const TRACKS = new Map();
for (const a of DEMO_ALBUMS) {
  const lead = artistFor(a.artist);
  if (!lead.images.length) lead.images = a.images;
  const album = { id: a.id, name: a.name, type: 'album', album_type: 'album', uri: `spotify:album:${a.id}`, images: a.images, release_date: a.release_date, release_date_precision: 'day', total_tracks: a.tracks.length, artists: [brief(lead)], external_urls: {}, label: '', popularity: 70 };
  album.trackList = a.tracks.map((t, i) => {
    const names = t.artists.split(', ').filter(Boolean);
    const track = {
      id: t.id, name: t.name, type: 'track', uri: `spotify:track:${t.id}`, duration_ms: t.duration_ms, explicit: t.explicit,
      track_number: i + 1, disc_number: 1, is_playable: true, is_local: false, popularity: 60, external_urls: {},
      artists: names.map((n) => brief(artistFor(n))),
      album: { id: album.id, name: album.name, type: 'album', album_type: 'album', uri: album.uri, images: album.images, release_date: album.release_date, artists: album.artists }
    };
    TRACKS.set(t.id, track);
    return track;
  });
  ALBUMS.push(album);
}
export const ARTISTS = artists;
for (const artist of artists.values()) if (!artist.images.length) artist.images = ALBUMS.find((al) => al.trackList.some((t) => t.artists.some((x) => x.id === artist.id)))?.images || [];

export const artistById = (id) => [...artists.values()].find((a) => a.id === id) || null;
export const albumById = (id) => ALBUMS.find((a) => a.id === id) || null;
export const trackByUri = (uri) => TRACKS.get(String(uri).split(':').pop()) || null;
export const tracksOfArtist = (id) => [...TRACKS.values()].filter((t) => t.artists.some((a) => a.id === id));
export const albumsOfArtist = (id) => ALBUMS.filter((a) => a.artists.some((x) => x.id === id));

// Pick tracks by album and name, so the playlists read like a person made them
// Names compare without case or curly quotes, since Spotify's titles use ’ where these use '
const plain = (text) => String(text).toLowerCase().replace(/[‘’]/g, "'");
const pick = (albumName, ...names) => {
  const al = ALBUMS.find((a) => plain(a.name).includes(plain(albumName)));
  return names.map((n) => al?.trackList.find((t) => plain(t.name).startsWith(plain(n)))).filter(Boolean);
};
const day = (n) => new Date(Date.UTC(2026, 0, 1) + n * 86400000).toISOString();

function playlist(id, name, description, tracks, { owner = DEMO_USER, collaborative = false, addedBy } = {}) {
  return {
    id, name, description, collaborative, public: !collaborative, type: 'playlist', uri: `spotify:playlist:${id}`, snapshot_id: `${id}-1`, external_urls: {},
    owner: { id: owner.id, display_name: owner.display_name, type: 'user', uri: owner.uri },
    images: tracks[0] ? [tracks[0].album.images[0]] : [],
    entries: tracks.map((t, i) => ({ added_at: day(i * 3), added_by: { id: addedBy ? addedBy(i) : owner.id, type: 'user' }, is_local: false, track: t }))
  };
}

const lateNight = [...pick('Currents', 'Let It Happen', 'The Less I Know', 'Eventually', "New Person"), ...pick('After Hours', 'Blinding Lights', 'Save Your Tears', 'After Hours'), ...pick('Blonde', 'Nikes', 'Ivy', 'Self Control'), ...pick('AM', 'Do I Wanna Know', 'Why\'d You Only', '505')].filter(Boolean);
const sunday = [...pick('Rumours', 'Dreams', 'Never Going Back', 'Songbird', 'The Chain'), ...pick('In Rainbows', 'Nude', 'Weird Fishes', 'House of Cards', 'Reckoner'), ...pick('Blonde', 'Pink + White', 'Godspeed'), ...pick('HIT ME', 'BIRDS OF A FEATHER', 'WILDFLOWER')];
const gym = [...pick('Nevermind', 'Smells Like', 'Lithium', 'Breed', 'Territorial'), ...pick('AM', 'R U Mine', 'Arabella', 'Knee Socks'), ...pick('Demon Days', 'Feel Good Inc', 'DARE', 'Kids with Guns'), ...pick('Random Access', 'Get Lucky', 'Lose Yourself', 'Contact'), ...pick('White Pony', 'Change', 'Digital Bath', 'Elite')];
const everything = [...TRACKS.values()].filter((_, i) => i % 3 === 0);

// A Seven: two friends taking turns, seven songs at a time. Alex sent the last batch, so it is the
// visitor's turn and the workspace has something to do
const sevenTracks = [...pick('Currents', 'Let It Happen', 'Nangs', 'The Moment', 'Yes I\'m Changing', 'Eventually', 'Gossip', '\'Cause I\'m A Man'),
  ...pick('Morning Glory', 'Hello', 'Roll with It', 'Wonderwall', 'Don\'t Look Back', 'Hey Now', 'Some Might Say', 'Cast No Shadow'),
  ...pick('Demon Days', 'Last Living', 'Kids with Guns', 'O Green World', 'Dirty Harry', 'Feel Good', 'El Mañana', 'Every Planet')].slice(0, 21);

export const PLAYLISTS = [
  playlist('demoLateNightDrives', 'Late Night Drives', 'Windows down, city lights.', lateNight),
  playlist('demoSundayMorning', 'Sunday Morning', 'Slow coffee, slower songs.', sunday),
  playlist('demoGym', 'Gym', 'One more set.', gym),
  playlist('demoSevensAlex', 'Sevens with Alex', 'Seven songs each, taking turns.', sevenTracks, { collaborative: true, addedBy: (i) => (Math.floor(i / 7) % 2 === 0 ? DEMO_FRIEND.id : DEMO_USER.id) }),
  playlist('demoSevensPool', 'Songs for Alex', 'Saving these for my next turn.', [...pick('Rumours', 'Go Your Own Way', 'Second Hand News'), ...pick('Random Access', 'Instant Crush', 'Doin\' it Right')]),
  playlist('demoEverything', 'Everything', 'A bit of it all.', everything),
  playlist('demoAlexPicks', 'Alex\'s picks', 'Things I keep telling everyone about.', [...pick('White Pony', 'Change', 'Passenger', 'Teenager'), ...pick('In Rainbows', 'Bodysnatchers', '15 Step')], { owner: DEMO_FRIEND })
];
export const MY_PLAYLISTS = new Set(PLAYLISTS.filter((p) => p.owner.id === DEMO_USER.id || p.collaborative).map((p) => p.id));
export const playlistById = (id) => PLAYLISTS.find((p) => p.id === id) || null;

export const LIKED = new Map([...lateNight, ...sunday, ...gym.slice(0, 8)].map((t, i) => [t.id, day(200 - i)]));
export const SAVED_ALBUMS = new Set(ALBUMS.map((a) => a.id));
export const FOLLOWED = new Set([...artists.values()].map((a) => a.id));

export function createPlaylist(name, description = '') {
  const id = `demoNew${Date.now().toString(36)}`;
  const p = playlist(id, name || 'New playlist', description, []);
  PLAYLISTS.unshift(p);
  MY_PLAYLISTS.add(id);
  return p;
}

// Spotify's shapes
export const simplePlaylist = (p) => ({
  id: p.id, name: p.name, description: p.description, collaborative: p.collaborative, public: p.public, type: 'playlist', uri: p.uri,
  snapshot_id: p.snapshot_id, owner: p.owner, images: p.images, external_urls: {},
  tracks: { total: p.entries.length, href: '' }, items: { total: p.entries.length, href: '' }
});
export const fullAlbum = (a) => {
  const { trackList, ...rest } = a;
  return { ...rest, tracks: { items: trackList, total: trackList.length, next: null, offset: 0, limit: 50 } };
};
export const albumSummary = (a) => {
  const rest = { ...a };
  delete rest.trackList;
  return rest;
};
