import { useState } from 'react';
import { Speaker, Check, X, AlertTriangle, Loader2, ClipboardCheck, Laptop, Smartphone, Wand2 } from 'lucide-react';
import { useUserStore } from '../../store/userStore';
import { usePartyStore } from '../../store/partyStore';
import { hostApi, guestApi } from '../../party/client';
import { heartbeat } from '../../party/conductor';
import { fetchDevices, transferPlayback, setPlaybackVolume, fetchPlaylistSummary } from '../../services/spotify/api';
import { toast } from '../../store/toastStore';

// The parts of the party view that set the party up rather than run it: which device does what,
// which speaker plays, and a check that it all works before anyone arrives.

const ROLES = [
  { id: 'conductor', label: 'Runs the party', icon: Laptop, hint: 'Keeps the queue moving. The always-on laptop.' },
  { id: 'auto', label: 'Auto', icon: Wand2, hint: 'Whichever device plays the music runs it.' },
  { id: 'remote', label: 'Remote', icon: Smartphone, hint: 'Only controls the party. Your phone.' }
];

export function RolePicker() {
  const role = usePartyStore((s) => s.role);
  const setRole = usePartyStore((s) => s.setRole);
  const conductor = usePartyStore((s) => s.conductor);
  const info = usePartyStore((s) => s.conductorInfo);
  const stale = usePartyStore((s) => s.conductorQuiet);
  const choose = (id) => { setRole(id); heartbeat(); };
  return (
    <section className="rounded-2xl bg-white/5 border border-white/10 p-3 flex flex-col gap-2">
      <p className="text-xs font-bold uppercase tracking-widest text-neutral-400">This device</p>
      <div className="grid grid-cols-3 gap-1" role="radiogroup" aria-label="This device's part">
        {ROLES.map((r) => (
          <button key={r.id} type="button" role="radio" aria-checked={role === r.id} title={r.hint} onClick={() => choose(r.id)} className={`flex flex-col items-center gap-1 rounded-xl px-2 py-2 text-xs font-bold ${role === r.id ? 'bg-white text-black' : 'text-neutral-300 hover:bg-white/10'}`}>
            <r.icon className="w-4 h-4" />{r.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-neutral-400">
        {conductor ? 'This device is running the party.' : info?.name ? `${info.name} is running the party${stale ? ', but has gone quiet' : ''}.` : 'Finding out which device runs the party…'}
        {conductor && info?.awake === false && ' Its screen may go to sleep: keep Jomify open in front.'}
      </p>
    </section>
  );
}

export function SpeakerPicker({ party, op }) {
  const token = useUserStore((s) => s.token);
  const speakerOk = usePartyStore((s) => s.speakerOk);
  const [devices, setDevices] = useState(null);
  const [open, setOpen] = useState(false);
  const speaker = party?.speaker || null;
  const load = async () => {
    setOpen((v) => !v);
    try { setDevices(await fetchDevices(token)); } catch { setDevices([]); }
  };
  const choose = async (d) => {
    setOpen(false);
    await op({ op: 'settings', speaker: d ? { id: d.id, name: d.name } : null }, d ? `Playing on ${d.name}` : 'No party speaker');
    if (d) await transferPlayback(token, d.id, true).catch((err) => toast(`Couldn't move the music to ${d.name}: ${err?.message || 'no answer'}`, { tone: 'error' }));
    heartbeat();
  };
  return (
    <>
      <button type="button" onClick={load} className={`rounded-full border px-4 py-2.5 text-sm font-semibold flex items-center gap-2 truncate max-w-full ${speaker && speakerOk === false ? 'border-red-400/50 bg-red-500/15 text-red-200' : 'border-white/15 bg-white/5 text-white'}`}>
        <Speaker className="w-4 h-4 shrink-0" /> <span className="truncate">Speaker: {speaker?.name || 'not chosen'}</span>
      </button>
      {open && (
        <div className="basis-full rounded-2xl bg-neutral-900 border border-white/10 p-2 flex flex-col gap-1">
          {devices === null ? <p className="text-sm text-neutral-400 p-2 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Asking Spotify…</p>
            : devices.length === 0 ? <p className="text-sm text-neutral-400 p-2">Spotify lists no speakers. Wake the one you want (for an Alexa group, say "Alexa, play Spotify on the group") and try again.</p>
              : devices.map((d) => (
                <button key={d.id} type="button" onClick={() => choose(d)} className={`flex items-center gap-3 rounded-xl px-3 py-2 text-left text-sm ${speaker?.id === d.id ? 'bg-white/10 text-white' : 'text-neutral-200 hover:bg-white/5'}`}>
                  <Speaker className="w-4 h-4 text-neutral-400" />
                  <span className="flex-1 min-w-0 truncate font-semibold">{d.name}</span>
                  <span className="text-xs text-neutral-500">{d.type}{d.supports_volume === false ? ' · no volume' : ''}</span>
                  {speaker?.id === d.id && <Check className="w-4 h-4 text-[var(--brand-mid)]" />}
                </button>
              ))}
          {speaker && <button type="button" onClick={() => choose(null)} className="rounded-xl px-3 py-2 text-left text-sm text-neutral-400 hover:bg-white/5">No party speaker (play wherever Spotify is)</button>}
        </div>
      )}
    </>
  );
}

export function SpeakerBanner({ party }) {
  const speakerOk = usePartyStore((s) => s.speakerOk);
  if (!party?.speaker || speakerOk !== false) return null;
  return (
    <p role="alert" className="rounded-2xl bg-red-500/15 border border-red-400/40 px-4 py-3 text-sm text-red-100 flex items-start gap-2">
      <AlertTriangle className="w-5 h-5 shrink-0 text-red-300" />
      <span><b>{party.speaker.name}</b> has dropped off Spotify. Wake it (for an Alexa: "Alexa, play Spotify"). Until it's back the music plays wherever Spotify can, and it moves back by itself.</span>
    </p>
  );
}

// ---------------------------------------------------------------------------- the check

const MARK = { ok: { icon: Check, cls: 'text-emerald-300' }, warn: { icon: AlertTriangle, cls: 'text-amber-300' }, fail: { icon: X, cls: 'text-red-300' }, run: { icon: Loader2, cls: 'text-neutral-400 animate-spin' } };

async function runChecks(code, token, report) {
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

export function PartyCheck({ code }) {
  const token = useUserStore((s) => s.token);
  const [results, setResults] = useState(null);
  const [running, setRunning] = useState(false);
  const run = async () => {
    setRunning(true);
    const order = [];
    const found = {};
    setResults([]);
    await runChecks(code, token, (id, row) => {
      if (!found[id]) { found[id] = true; order.push(id); }
      setResults((prev) => {
        const map = Object.fromEntries((prev || []).map((r) => [r.id, r]));
        map[id] = { id, ...row };
        return order.map((k) => map[k]).filter(Boolean);
      });
    });
    setRunning(false);
  };
  const failed = (results || []).filter((r) => r.status === 'fail').length;
  const warned = (results || []).filter((r) => r.status === 'warn').length;
  return (
    <section className="rounded-2xl bg-white/5 border border-white/10 p-3 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <p className="flex-1 text-xs font-bold uppercase tracking-widest text-neutral-400">Party check</p>
        <button type="button" onClick={run} disabled={running} className="rounded-full bg-white/10 hover:bg-white/15 px-3 py-1.5 text-xs font-bold text-white flex items-center gap-1.5 disabled:opacity-60">
          {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ClipboardCheck className="w-3.5 h-3.5" />} {results ? 'Run again' : 'Run the check'}
        </button>
      </div>
      {results && (
        <ul className="flex flex-col gap-1.5" aria-label="Party check results">
          {results.map((r) => {
            const m = MARK[r.status] || MARK.fail;
            return (
              <li key={r.id} data-status={r.status} className="flex items-start gap-2 text-sm">
                <m.icon className={`w-4 h-4 mt-0.5 shrink-0 ${m.cls}`} />
                <span className="min-w-0"><span className="font-semibold text-white">{r.label}</span>{r.detail && <span className="text-neutral-400"> · {r.detail}</span>}</span>
              </li>
            );
          })}
        </ul>
      )}
      {results && !running && <p className={`text-xs font-semibold ${failed ? 'text-red-300' : warned ? 'text-amber-300' : 'text-emerald-300'}`}>{failed ? `${failed} thing${failed === 1 ? '' : 's'} to fix before guests arrive.` : warned ? 'Ready, with a note or two above.' : 'All good. Party on.'}</p>}
    </section>
  );
}
