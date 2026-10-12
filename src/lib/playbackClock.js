import { usePlayerStore } from '../store/playerStore';

// Where the song is now, between Spotify's reports. This computer's player says when it measured
// the position; counting from when the update arrived instead runs lyrics late by however long it
// took to arrive. A remote device's timestamp means something else (when playback last changed),
// so it is not used.
export function positionNow() {
  const { playbackState: ps, positionAt } = usePlayerStore.getState();
  if (!ps) return 0;
  if (ps.paused) return ps.position;
  const measured = !ps.remote && Number.isFinite(ps.timestamp) && positionAt - ps.timestamp >= 0 && positionAt - ps.timestamp < 3000 ? ps.timestamp : positionAt;
  return ps.position + Date.now() - measured;
}
