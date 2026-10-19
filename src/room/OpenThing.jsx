import { Suspense, lazy } from 'react';

const RoomPlaylist = lazy(() => import('./RoomPlaylist'));
const RoomLikedSongs = lazy(() => import('./RoomLikedSongs'));
const RoomLibrary = lazy(() => import('./RoomLibrary'));
const RoomSearch = lazy(() => import('./RoomSearch'));
const RoomSeven = lazy(() => import('./RoomSeven'));
const RoomSevensPage = lazy(() => import('./RoomSevensPage'));
const RoomUnadded = lazy(() => import('./RoomUnadded'));
const RoomParty = lazy(() => import('./RoomParty'));
const RoomAlbum = lazy(() => import('./RoomAlbum'));
const RoomArtist = lazy(() => import('./RoomArtist'));
const RoomFriends = lazy(() => import('./RoomFriends'));
const RoomUser = lazy(() => import('./RoomUser'));
const RoomLyrics = lazy(() => import('./RoomLyrics'));
const RoomHome = lazy(() => import('./RoomHome'));

// The open thing: the room's own surface for the view, or the app's page as it is when the room
// has none yet. The same on the Mac (the layer's right column) and the phone (the sheet at full).
export default function OpenThing({ currentView, isSeven, roomPlaylist, children }) {
  return (<>{roomPlaylist ? <Suspense fallback={null}><RoomPlaylist /></Suspense> : isSeven ? <Suspense fallback={null}><RoomSeven /></Suspense> : currentView === 'liked-songs' ? <Suspense fallback={null}><RoomLikedSongs /></Suspense> : currentView === 'library' ? <Suspense fallback={null}><RoomLibrary /></Suspense> : currentView === 'browse' ? <Suspense fallback={null}><RoomSearch /></Suspense> : currentView === 'sevens' ? <Suspense fallback={null}><RoomSevensPage /></Suspense> : currentView === 'unadded' ? <Suspense fallback={null}><RoomUnadded /></Suspense> : currentView === 'party' ? <Suspense fallback={null}><RoomParty /></Suspense> : currentView === 'album' ? <Suspense fallback={null}><RoomAlbum /></Suspense> : currentView === 'artist' ? <Suspense fallback={null}><RoomArtist /></Suspense> : currentView === 'friends' ? <Suspense fallback={null}><RoomFriends /></Suspense> : currentView === 'user' ? <Suspense fallback={null}><RoomUser /></Suspense> : currentView === 'lyrics' ? <Suspense fallback={null}><RoomLyrics /></Suspense> : currentView === 'home' ? <Suspense fallback={null}><RoomHome /></Suspense> : children}</>);
}
