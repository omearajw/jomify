import { useState } from 'react';
import { X, Play, Pause, SkipForward, Volume2 } from 'lucide-react';
import { useUserStore } from '../store/userStore';
import { usePartyStore } from '../store/partyStore';
import { usePartyHost } from '../views/Party/usePartyHost';
import { ROLES, runChecks } from '../views/Party/partyChecks';
import { partyLink, openPartyScreen } from '../party/client';
import { heartbeat, skipWithParty, setHostPaused, rejoinParty, endParty } from '../party/conductor';
import { togglePlay, setVolume } from '../services/spotify/playbackController';
import { fetchDevices, transferPlayback } from '../services/spotify/api';
import { requestedBy } from '../party/view';
import { artUrl } from '../utils/images';
import { openProjectorWindow } from '../views/ZenMode/projectorBridge';
import { toast } from '../store/toastStore';

// The host's view on the room's language (DESIGN.md §9): the open thing at full while the
// column holds the party's facts (code, QR, link, who is in). Here: the party's words (share,
// the wall screen, pause requests, end), what is playing with Pause/Skip/volume that go through
// the party (a skip feeds the next request), a field to add a song, the requests in their fair
// order with Pin/Block/Remove, and the set-up: the fallback playlist, the speaker, which part
// this device plays, and the check. With no party on, the set-up to start one; a party left
// open from earlier asks to be resumed or ended. The logic is usePartyHost, shared with the old
// page.

const Mono = ({ children, className = '' }) => <p className={`room-mono ${className}`}>{children}</p>;
const Word = ({ onClick, children, lit, disabled, danger, label, tip }) => <button type="button" data-tip={tip} onClick={onClick} disabled={disabled} aria-pressed={lit || undefined} aria-label={label} className={`ui-word ${danger ? 'ui-row-danger' : ''}`}>{children}</button>;
const Head = ({ children, right }) => <div className="mt-9 flex items-center justify-between border-b border-[var(--room-hair)] pb-2"><Mono className="text-[var(--room-faint)]">{children}</Mono>{right}</div>;
const Note = ({ children, alert }) => <p role={alert ? 'alert' : undefined} className={`mt-3 text-[13px] ${alert ? 'text-[rgb(240,160,160)]' : 'text-[var(--room-dim)]'}`}>{children}</p>;

function Cover({ playlist, size, lit, onClick }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={lit || undefined} className="flex flex-col items-start text-left" style={{ width: size }}>
      <span className={`block aspect-square w-full overflow-hidden rounded-[5px] bg-white/5 ${lit ? 'shadow-[0_0_0_1px_var(--room-paper)]' : ''}`}>{playlist.images?.[0]?.url && <img src={artUrl(playlist.images, size)} alt="" draggable="false" className="h-full w-full object-cover" />}</span>
      <span className={`mt-2 block w-full truncate text-[12.5px] font-medium ${lit ? 'text-[var(--room-paper)]' : 'text-[var(--room-paper)]/80'}`}>{playlist.name}</span>
    </button>
  );
}

function Setup({ choices, profile, onStart, busy }) {
  const [backingId, setBackingId] = useState(choices[0]?.id || null);
  const backing = choices.find((p) => p.id === backingId);
  return (
    <>
      <Mono className="text-[var(--room-faint)]">Party</Mono>
      <h1 className="mt-2 text-[30px] font-semibold leading-[1.05] tracking-[-0.025em] text-[var(--room-paper)]">Start a party</h1>
      <p className="mt-3 max-w-xl text-[13px] text-[var(--room-dim)]">A code for the room: anyone can ask for songs from their phone, no Spotify account needed. Requests take turns, so nobody can hog it, and this playlist carries on when nothing is asked for.</p>
      <Head>Playlist to fall back on</Head>
      <div className="mt-4 flex flex-wrap gap-5">{choices.map((p) => <Cover key={p.id} playlist={p} size={104} lit={p.id === backingId} onClick={() => setBackingId(p.id)} />)}</div>
      <p className="mt-8"><button type="button" disabled={!backing || busy} onClick={() => onStart(backing)} className="ui-pill">{busy ? 'Starting…' : `Start the party${profile?.display_name ? ` as ${profile.display_name}` : ''}`}</button></p>
    </>
  );
}

function Speaker({ party, op }) {
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
    <div className="py-3" style={{ borderTop: '1px solid var(--room-hair)' }}>
      <div className="flex items-center justify-between gap-6">
        <span className="min-w-0 text-[13px]"><span className="text-[var(--room-dim)]">Speaker</span> <span className={speaker && speakerOk === false ? 'text-[rgb(240,160,160)]' : 'text-[var(--room-paper)]'}>{speaker?.name || 'wherever Spotify is playing'}</span></span>
        <Word onClick={load} lit={open}>{open ? 'Done' : 'Choose'}</Word>
      </div>
      {open && (
        <div className="mt-2">
          {devices === null && <Mono className="py-2 text-[var(--room-faint)]">Asking Spotify</Mono>}
          {devices?.length === 0 && <p className="py-2 text-[12.5px] text-[var(--room-faint)]">Spotify lists no speakers. Wake the one you want (for an Alexa group, say "Alexa, play Spotify on the group") and try again.</p>}
          {(devices || []).map((d) => (
            <button key={d.id} type="button" onClick={() => choose(d)} className={`flex w-full items-center gap-3 py-2 text-left text-[13px] ${speaker?.id === d.id ? 'text-[var(--room-paper)]' : 'text-[var(--room-dim)] hover:text-[var(--room-paper)]'}`} style={{ borderTop: '1px solid var(--room-hair)' }}>
              <span className="min-w-0 flex-1 truncate">{d.name}</span>
              <Mono className="text-[var(--room-faint)]">{d.type}{d.supports_volume === false ? ' · no volume' : ''}{speaker?.id === d.id ? ' · chosen' : ''}</Mono>
            </button>
          ))}
          {speaker && <button type="button" onClick={() => choose(null)} className="w-full py-2 text-left text-[13px] text-[var(--room-dim)] hover:text-[var(--room-paper)]" style={{ borderTop: '1px solid var(--room-hair)' }}>No party speaker: play wherever Spotify is</button>}
        </div>
      )}
    </div>
  );
}

function ThisDevice() {
  const role = usePartyStore((s) => s.role);
  const setRole = usePartyStore((s) => s.setRole);
  const conductor = usePartyStore((s) => s.conductor);
  const info = usePartyStore((s) => s.conductorInfo);
  const stale = usePartyStore((s) => s.conductorQuiet);
  const choose = (id) => { setRole(id); heartbeat(); };
  return (
    <div className="py-3" style={{ borderTop: '1px solid var(--room-hair)' }}>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <span className="text-[13px] text-[var(--room-dim)]">This device</span>
        <span className="flex items-center gap-5" role="radiogroup" aria-label="This device's part">
          {ROLES.map((r) => <button key={r.id} type="button" role="radio" aria-checked={role === r.id} aria-pressed={role === r.id || undefined} title={r.hint} onClick={() => choose(r.id)} className="ui-word">{r.label}</button>)}
        </span>
      </div>
      <p className="mt-2 text-[12.5px] text-[var(--room-faint)]">
        {conductor ? 'This device is running the party.' : info?.name ? `${info.name} is running the party${stale ? ', but has gone quiet' : ''}.` : 'Finding out which device runs the party…'}
        {conductor && info?.awake === false && ' Its screen may go to sleep: keep Jomify open in front.'}
      </p>
    </div>
  );
}

function Check({ code }) {
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
      setResults((prev) => { const map = Object.fromEntries((prev || []).map((r) => [r.id, r])); map[id] = { id, ...row }; return order.map((k) => map[k]).filter(Boolean); });
    });
    setRunning(false);
  };
  const failed = (results || []).filter((r) => r.status === 'fail').length;
  const warned = (results || []).filter((r) => r.status === 'warn').length;
  const mark = { ok: 'ok', warn: 'note', fail: 'fix', run: '…' };
  return (
    <div className="py-3" style={{ borderTop: '1px solid var(--room-hair)' }}>
      <div className="flex items-center justify-between gap-6">
        <span className="text-[13px] text-[var(--room-dim)]">Before guests arrive{results && !running ? <span className={failed ? ' text-[rgb(240,160,160)]' : ' text-[var(--room-paper)]'}>{failed ? ` · ${failed} thing${failed === 1 ? '' : 's'} to fix` : warned ? ' · ready, with a note or two' : ' · all good'}</span> : null}</span>
        <Word onClick={run} disabled={running}>{running ? 'Checking' : results ? 'Check again' : 'Run the check'}</Word>
      </div>
      {results && (
        <ul className="mt-2" aria-label="Party check results">
          {results.map((r) => (
            <li key={r.id} data-status={r.status} className="flex items-start gap-3 py-1.5 text-[12.5px]">
              <Mono className={`w-9 shrink-0 ${r.status === 'fail' ? 'text-[rgb(240,160,160)]' : r.status === 'ok' ? 'text-[var(--room-paper)]' : 'text-[var(--room-faint)]'}`}>{mark[r.status] || 'fix'}</Mono>
              <span className="min-w-0"><span className="text-[var(--room-paper)]/90">{r.label}</span>{r.detail && <span className="text-[var(--room-faint)]"> · {r.detail}</span>}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function RoomParty() {
  const h = usePartyHost();
  const { code, party, queue, upNext, history, guestCount, conductor, hostAway, error, skipping, track, paused, activeDevice, busy, query, setQuery, setResults, copied, endArmed, showPlaylists, setShowPlaylists, blockArmed, setBlockArmed, blocked, dormant, choices, shownResults, start, op, end, copyLink, changeBacking, volume, profile } = h;
  const speakerOk = usePartyStore((s) => s.speakerOk);

  if (!code) return <div className="relative pb-6" style={{ fontFamily: 'var(--font-room)' }}><Setup choices={choices} profile={profile} onStart={start} busy={busy} /></div>;

  if (dormant) {
    return (
      <div className="relative pb-6" style={{ fontFamily: 'var(--font-room)' }}>
        <Mono className="text-[var(--room-faint)]">Party · left open</Mono>
        <h1 className="mt-2 text-[30px] font-semibold leading-[1.05] tracking-[-0.025em] text-[var(--room-paper)]">Party {code} is still open</h1>
        <p className="mt-3 max-w-xl text-[13px] text-[var(--room-dim)]">It was left open from earlier and isn't running now, so it won't touch your music. Resume it to carry on with its queue and guests, or end it.</p>
        <p className="mt-6 flex items-center gap-6"><button type="button" onClick={rejoinParty} className="ui-pill">Resume the party</button><Word onClick={() => endParty()} danger>End it</Word></p>
      </div>
    );
  }

  const fromGuest = requestedBy(track, { history, upNext });
  const backingId = party?.backing?.uri?.split(':').pop();

  return (
    <div className="relative pb-6" style={{ fontFamily: 'var(--font-room)' }}>
      <Mono className="text-[var(--room-faint)]">Party on · {guestCount} in · {conductor ? 'running here' : 'running elsewhere'}</Mono>
      <h1 className="mt-2 text-[30px] font-semibold leading-[1.05] tracking-[-0.025em] text-[var(--room-paper)]">Party {code}</h1>
      <p className="mt-2 text-[13px] text-[var(--room-dim)]">{partyLink(code).replace(/^https?:\/\//, '')}</p>
      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2">
        <Word onClick={copyLink}>{copied ? 'Copied' : 'Share the link'}</Word>
        <button type="button" onClick={() => openPartyScreen(code)} className="ui-word" title="Open this on a TV or a spare screen: QR, now playing and what's next">The wall screen</button>
        <Word onClick={() => op({ op: 'settings', paused: !party?.paused })} lit={Boolean(party?.paused)} tip="Guests can still see what is playing but cannot ask for songs">{party?.paused ? 'Requests paused' : 'Pause requests'}</Word>
        <Word onClick={end} danger>{endArmed ? 'Click again to end' : 'End the party'}</Word>
      </div>
      {party?.speaker && speakerOk === false && <Note alert>{party.speaker.name} has dropped off Spotify. Wake it (for an Alexa: "Alexa, play Spotify"). Until it's back the music plays wherever Spotify can, and it moves back by itself.</Note>}
      {error && <Note alert>{error}</Note>}
      {!conductor && <Note>Another of your devices is running the party; this one is along for the ride.</Note>}
      {hostAway && conductor && <Note>Guests can't search until the next heartbeat lands.</Note>}

      {/* what is playing, with the controls that go through the party */}
      <Head>{paused ? 'Paused' : 'Playing'}{activeDevice?.name ? ` · ${activeDevice.name}` : ''}</Head>
      <div className="mt-4 flex items-center gap-4">
        <span className="h-[56px] w-[56px] shrink-0 overflow-hidden rounded-[4px] bg-white/5">{track?.album?.images?.[0]?.url && <img src={artUrl(track.album.images, 56)} alt="" draggable="false" className="h-full w-full object-cover" />}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold text-[var(--room-paper)]">{track?.name || 'Nothing yet'}</span>
          <span className="block truncate text-[12px] text-[var(--room-dim)]">{(track?.artists || []).map((a) => a.name).join(', ')}{fromGuest ? ` · asked for by ${fromGuest}` : ''}</span>
          {upNext && (!track || upNext.uri !== track.uri) && <Mono className="mt-1 truncate text-[var(--room-faint)]">Next · {upNext.name} · {upNext.guestName}</Mono>}
        </span>
        <span className="flex shrink-0 items-center gap-5" data-control>
          <button type="button" onClick={() => { setHostPaused(!paused); togglePlay(); }} aria-label={paused ? 'Play' : 'Pause'} className="grid h-[40px] w-[40px] place-items-center rounded-full bg-[var(--room-paper)] text-[#0a0810] transition-transform hover:scale-105 active:scale-95">{paused ? <Play className="ml-0.5 h-4 w-4 fill-current" /> : <Pause className="h-4 w-4 fill-current" />}</button>
          <button type="button" onClick={() => { setHostPaused(false); skipWithParty(); }} aria-label="Skip" aria-busy={skipping || undefined} disabled={skipping} className="text-[var(--room-dim)] transition-colors hover:text-[var(--room-paper)] disabled:opacity-40"><SkipForward className="h-5 w-5" /></button>
          <Volume2 className="h-4 w-4 text-[var(--room-faint)]" />
          <input type="range" min="0" max="100" value={volume} onChange={(e) => setVolume(Number(e.target.value))} aria-label="Volume" className="zen-range w-24" style={{ '--v': `${volume}%` }} />
        </span>
      </div>

      {/* add a song */}
      <Head>Add a song</Head>
      <div className="relative mt-2">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="A song, an artist" aria-label="Add a song" className="ui-field" />
        {query && <button type="button" onClick={() => { setQuery(''); setResults(null); }} aria-label="Clear" className="absolute right-0 top-1/2 -translate-y-1/2 text-[var(--room-faint)] hover:text-[var(--room-paper)]"><X className="h-4 w-4" /></button>}
      </div>
      {shownResults && shownResults.length === 0 && <p className="pt-3 text-[13px] text-[var(--room-faint)]">Nothing found.</p>}
      {shownResults && shownResults.length > 0 && shownResults.map((t) => (
        <div key={t.uri} className="flex items-center gap-3 py-2 text-[13px]" style={{ borderTop: '1px solid var(--room-hair)' }}>
          <span className="h-[32px] w-[32px] shrink-0 overflow-hidden rounded-[3px] bg-white/5">{t.image && <img src={t.image} alt="" draggable="false" className="h-full w-full object-cover" />}</span>
          <span className="min-w-0 flex-1"><span className="block truncate font-medium text-[var(--room-paper)]/90">{t.name}</span><span className="block truncate text-[11.5px] text-[var(--room-dim)]">{t.artists}</span></span>
          <span className="flex shrink-0 items-center gap-5">
            <Word onClick={async () => { if (await op({ op: 'add', track: t }, `Added ${t.name}`)) { setQuery(''); setResults(null); } }}>Add</Word>
            <Word onClick={async () => { if (await op({ op: 'add', track: t, playNext: true }, `${t.name} is next`)) { setQuery(''); setResults(null); } }}>Play next</Word>
          </span>
        </div>
      ))}

      {/* the requests, in their fair order */}
      <Head>Requests{queue.length ? ` · ${queue.length}` : ''}</Head>
      {queue.length === 0 && <p className="pt-3 text-[13px] text-[var(--room-faint)]">Nothing waiting. {party?.backing?.name || 'The playlist'} carries on until someone asks for a song.</p>}
      {queue.map((i, n) => (
        <div key={i.id} className="group flex items-center gap-3 py-2 text-[13px]" style={{ borderTop: n ? '1px solid var(--room-hair)' : 'none' }}>
          <Mono className="w-5 text-center text-[var(--room-faint)]">{n + 1}</Mono>
          <span className="h-[32px] w-[32px] shrink-0 overflow-hidden rounded-[3px] bg-white/5">{i.image && <img src={i.image} alt="" draggable="false" className="h-full w-full object-cover" />}</span>
          <span className="min-w-0 flex-1"><span className="block truncate font-medium text-[var(--room-paper)]/90">{i.name}</span><span className="block truncate text-[11.5px] text-[var(--room-dim)]">{i.artists} · {i.guestName}</span></span>
          {i.votes > 0 && <Mono className="shrink-0 text-[var(--room-dim)]">▲ {i.votes}</Mono>}
          <span className="flex shrink-0 items-center gap-5">
            <Word onClick={() => op({ op: 'pin', id: i.id, pinned: !i.pinnedAt })} lit={Boolean(i.pinnedAt)} label={i.pinnedAt ? 'Unpin' : 'Play next'}>{i.pinnedAt ? 'Pinned' : 'Play next'}</Word>
            {i.guestId !== 'host' && (
              <Word
                danger={blockArmed === i.guestId}
                label={blockArmed === i.guestId ? `Click again to block ${i.guestName}` : `Block ${i.guestName}`}
                onClick={() => {
                  if (blockArmed !== i.guestId) { setBlockArmed(i.guestId); setTimeout(() => setBlockArmed((v) => (v === i.guestId ? null : v)), 4000); return; }
                  setBlockArmed(null);
                  op({ op: 'block', guestId: i.guestId }, `Blocked ${i.guestName}; their songs are gone`);
                }}
              >{blockArmed === i.guestId ? `Block ${i.guestName}?` : 'Block'}</Word>
            )}
            <button type="button" onClick={() => op({ op: 'remove', id: i.id })} aria-label={`Remove ${i.name}`} className="grid h-6 w-6 place-items-center text-[var(--room-faint)] opacity-0 hover:text-[var(--room-paper)] group-hover:opacity-100"><X className="h-3.5 w-3.5" /></button>
          </span>
        </div>
      ))}
      {blocked?.length > 0 && (
        <p className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[12.5px] text-[var(--room-faint)]">Blocked:{blocked.map((g) => <Word key={g.id} onClick={() => op({ op: 'unblock', guestId: g.id }, `${g.name} can request again`)}>{g.name} · unblock</Word>)}</p>
      )}

      {/* the set-up */}
      <Head>The set-up</Head>
      <div className="mt-1">
        <div className="py-3">
          <div className="flex items-center justify-between gap-6">
            <span className="min-w-0 truncate text-[13px]"><span className="text-[var(--room-dim)]">Fallback playlist</span> <span className="text-[var(--room-paper)]">{party?.backing?.name || 'none'}</span></span>
            <Word onClick={() => setShowPlaylists((v) => !v)} lit={showPlaylists}>{showPlaylists ? 'Done' : 'Change'}</Word>
          </div>
          {showPlaylists && <div className="mt-3 flex flex-wrap gap-5">{choices.map((p) => <Cover key={p.id} playlist={p} size={92} lit={p.id === backingId} onClick={() => changeBacking(p)} />)}</div>}
        </div>
        <Speaker party={party} op={op} />
        <div className="py-3" style={{ borderTop: '1px solid var(--room-hair)' }}>
          <div className="flex items-center justify-between gap-6">
            <span className="min-w-0 text-[13px] text-[var(--room-dim)]">Projector <span className="text-[var(--room-faint)]">· its own window, to drag onto the projector's screen; this one keeps the controls</span></span>
            <Word onClick={() => { if (!openProjectorWindow()) toast('The browser blocked the window. Allow pop-ups for Jomify and try again.', { tone: 'error' }); }} tip="Opens the projection in a separate window for a second screen">Open</Word>
          </div>
        </div>
        <ThisDevice />
        <Check code={code} />
      </div>
    </div>
  );
}
