import { Laptop, Smartphone, Wand2 } from 'lucide-react';
import { usePartyStore } from '../../store/partyStore';
import { hostApi, guestApi } from '../../party/client';
import { heartbeat } from '../../party/conductor';
import { fetchDevices, setPlaybackVolume, fetchPlaylistSummary } from '../../services/spotify/api';

// The party's set-up facts shared by the old tools (PartyTools.jsx) and the room's surface
// (src/room/RoomParty.jsx): which part a device can play, and the check that runs before
// guests arrive.

export const ROLES = [
  { id: 'conductor', label: 'Runs the party', icon: Laptop, hint: 'Keeps the queue moving. The always-on laptop.' },
  { id: 'auto', label: 'Auto', icon: Wand2, hint: 'Whichever device plays the music runs it.' },
  { id: 'remote', label: 'Remote', icon: Smartphone, hint: 'Only controls the party. Your phone.' }
];

export async function runChecks(code, token, report) {
  const p = usePartyStore.getState();
  const party = p.party;
  const step = async (id, label, fn) => {
    report(id, { label, status: 'run', detail: '' });
    try {
      const out = await fn();
      report(id, { label, status: out?.status || 'ok', detail: out?.detail || '' });
    } catch (err) {
      report(id, { label, status: 'fail', detail: err?.message || String(err) });
    }
  };
  let devices = [];
  await step('spotify', 'Spotify account', async () => {
    devices = await fetchDevices(token);
    return { detail: `signed in, ${devices.length} speaker${devices.length === 1 ? '' : 's'} visible` };
  });
  await step('server', 'Party server', async () => {
    const view = await guestApi.state(code);
    if (view.hostAway) return { status: 'warn', detail: "guests are told you're away: no device has checked in for 30s" };
    return { detail: `${view.guestCount} guest${view.guestCount === 1 ? '' : 's'}, ${view.queue.length} request${view.queue.length === 1 ? '' : 's'} waiting` };
  });
  await step('conductor', 'Running the party', async () => {
    await heartbeat();
    const info = usePartyStore.getState().conductorInfo;
    if (!info?.name) return { status: 'fail', detail: 'no device is running the party' };
    if (info.at && Date.now() - info.at > 30000) return { status: 'fail', detail: `${info.name} has gone quiet` };
    if (info.awake === false) return { status: 'warn', detail: `${info.name}; its screen may sleep, keep Jomify open in front there` };
    return { detail: info.name };
  });
  const speaker = party?.speaker;
  let found = null;
  await step('speaker', 'Party speaker', async () => {
    if (!speaker) return { status: 'warn', detail: 'none chosen: the music plays wherever Spotify is playing' };
    found = devices.find((d) => d.id === speaker.id) || devices.find((d) => d.name === speaker.name) || null;
    if (!found) return { status: 'fail', detail: `${speaker.name} is not on Spotify Connect` };
    return { detail: `${found.name}${found.is_active ? ', playing' : ''}` };
  });
  await step('volume', 'Volume from Jomify', async () => {
    if (!found) return { status: 'warn', detail: 'skipped: no speaker to try' };
    if (found.supports_volume === false) return { status: 'warn', detail: `${found.name} won't take volume from apps: use the speaker or Alexa` };
    await setPlaybackVolume(token, found.volume_percent ?? 50, found.id);
    return { detail: `${found.name} accepted a volume change` };
  });
  await step('backing', 'Fallback playlist', async () => {
    const id = party?.backing?.uri?.split(':').pop();
    if (!id) return { status: 'fail', detail: 'none chosen' };
    const pl = await fetchPlaylistSummary(token, id);
    const total = pl?.tracks?.total ?? 0;
    if (!total) return { status: 'fail', detail: `${pl?.name || 'it'} is empty` };
    return { detail: `${pl.name}, ${total} songs` };
  });
  await step('guests', 'A guest request, end to end', async () => {
    // A stand-in guest whose requests the server never hands to Spotify
    const guestId = `check-${Math.random().toString(36).slice(2, 10)}`;
    const started = Date.now();
    const joined = await guestApi.op(code, { op: 'join', guestId, name: 'Party check' });
    const { tracks } = await guestApi.op(code, { op: 'search', guestId, q: 'the' });
    const waiting = new Set([...(joined.queue || []).map((i) => i.uri), joined.upNext?.uri].filter(Boolean));
    const pick = (tracks || []).find((t) => !waiting.has(t.uri));
    if (!pick) return { status: 'warn', detail: 'search worked, but every result was already queued' };
    const res = await guestApi.op(code, { op: 'request', guestId, track: pick });
    if (!res.position) return { status: 'fail', detail: 'the request did not show in the queue' };
    await guestApi.op(code, { op: 'withdraw', guestId, id: res.item.id });
    return { detail: `searched, queued and withdrew a song in ${((Date.now() - started) / 1000).toFixed(1)}s` };
  });
  await step('playing', 'Music playing', async () => {
    const view = await hostApi.op(code, { op: 'heartbeat' });
    if (!view.nowPlaying) return { status: 'warn', detail: 'nothing playing yet' };
    if (view.nowPlaying.paused) return { status: 'warn', detail: `${view.nowPlaying.name} is paused` };
    return { detail: `${view.nowPlaying.name}${view.nowPlaying.device ? ` on ${view.nowPlaying.device}` : ''}` };
  });
}

