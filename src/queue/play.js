// The one door every play button and "Add to queue" goes through. With the new queue on, it is
// the queue (engine.js); with it off (and during a party) the button's old request runs exactly
// as it did, passed in as `legacy`, until the old way is retired.

import { playOn, activateLocalPlayer } from '../services/spotify/playbackController';
import { nudge } from '../services/queueConductor';
import { useQueueStore } from '../store/queueStore';
import { usePartyStore } from '../store/partyStore';
import { hostApi } from '../party/client';
import { toast } from '../store/toastStore';
import * as engine from './engine';

// At a party with the new queue on, a song added anywhere joins the party's queue as the host's
// request, taking its turn with the guests' (Play next pins it)
async function request(tracks, playNext) {
  const code = usePartyStore.getState().code;
  for (const t of tracks) {
    const track = { uri: t.uri, id: t.id, name: t.name, artists: (t.artists || []).map((a) => a.name).join(', '), image: t.album?.images?.slice(-1)[0]?.url || t.album?.images?.[0]?.url || null, durationMs: t.duration_ms || 0 };
    try { await hostApi.op(code, { op: 'add', track, playNext }); } catch (err) { toast(err?.message || `Couldn't add ${t.name} to the party`, { tone: 'error' }); }
  }
}
const atParty = () => engine.engineOn() && Boolean(usePartyStore.getState().code);

// desc: see engine.playSource. legacy: (deviceId) => the old request.
export function startPlaying(desc, legacy) {
  if (engine.engineOn()) return engine.playSource(desc);
  activateLocalPlayer();
  return playOn(legacy, { track: desc.track });
}

export function queueSongs(tracks) {
  const list = (tracks || []).filter((t) => t?.uri);
  if (!list.length) return;
  if (atParty()) { request(list, false); return; }
  if (engine.engineOn()) { engine.add(list); return; }
  useQueueStore.getState().add(list);
  nudge();
}

export function queueSongsNext(tracks) {
  const list = (tracks || []).filter((t) => t?.uri);
  if (!list.length) return;
  if (atParty()) { request(list, true); return; }
  if (engine.engineOn()) { engine.playNext(list); return; }
  useQueueStore.getState().addNext(list);
  nudge();
}
