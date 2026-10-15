import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { guestApi } from '../../party/client';
import { orderQueue, positionsFor } from '../../party/order';

// A guest's phone at a party: no account, just the code. Pick a name, see what is playing, find a
// song, tap to request it, and watch where it sits in the order.

const GUEST_KEY = 'jomify_party_guest';
const POLL_MS = 3000;

function loadGuest() {
  try { return JSON.parse(localStorage.getItem(GUEST_KEY) || 'null'); } catch { return null; }
}
function saveGuest(guest) {
  try { localStorage.setItem(GUEST_KEY, JSON.stringify(guest)); } catch { /* fine */ }
}
const newGuestId = () => `g${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
const ordinal = (n) => `${n}${['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : Math.min(n % 10, 4) === 4 ? 0 : (n % 10) > 3 ? 0 : n % 10]}`;
const spotifyUrl = (item) => { const id = item?.id || (item?.uri || '').split(':').pop(); return id ? `https://open.spotify.com/track/${id}` : null; };
// A queue changed on this phone before the server answers, put in play order with its positions
const withOrder = (state, queue, guestId) => {
  const ordered = orderQueue(queue);
  return { ...state, queue: ordered, mine: positionsFor(ordered, guestId) };
};

// A request as it will look once the server confirms it, shown before it does
const guessRequest = (track, guest) => ({ id: `tmp-${Date.now()}`, ...track, guestId: guest.id, guestName: guest.name, at: Date.now(), votes: 0 });
const fmt = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;

const Label = ({ children, right }) => <p className="room-mono flex items-center justify-between border-b border-[var(--room-hair)] pb-2 text-[var(--room-faint)]"><span>{children}</span>{right}</p>;
const Word = ({ children, ...props }) => <button type="button" className="ui-word inline-flex min-h-[44px] items-center" {...props}>{children}</button>;
const Cover = ({ src, size }) => <span className="shrink-0 overflow-hidden rounded-[4px]" style={{ width: size, height: size, background: 'rgba(241,239,233,0.06)' }}>{src && <img src={src} alt="" className="h-full w-full object-cover" />}</span>;

export default function GuestParty({ code }) {
  const [guest, setGuest] = useState(() => loadGuest());
  const [nameDraft, setNameDraft] = useState(() => loadGuest()?.name || '');
  const [state, setState] = useState(null);
  const [gone, setGone] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [notice, setNotice] = useState(null); // { text, tone }
  const [busyUris, setBusyUris] = useState(() => new Set()); // requests on their way, one per song
  const searchTimer = useRef(null);
  const noticeTimer = useRef(null);
  // While a tap is being confirmed, a poll landing in between must not wipe the optimistic view
  const pending = useRef(0);
  const buzz = () => { try { navigator.vibrate?.(8); } catch { /* fine */ } };

  const say = (text, tone = 'info') => {
    clearTimeout(noticeTimer.current);
    setNotice({ text, tone });
    noticeTimer.current = setTimeout(() => setNotice(null), 4000);
  };

  // Join once named, then keep the picture fresh
  useEffect(() => {
    if (!guest) return undefined;
    let cancelled = false;
    const load = async (join) => {
      try {
        const s = join ? await guestApi.op(code, { op: 'join', guestId: guest.id, name: guest.name }) : await guestApi.state(code, guest.id);
        if (!cancelled && (join || pending.current === 0)) { setState(s); setGone(''); }
      } catch (err) {
        if (!cancelled && err?.status === 404) setGone(err.message);
      }
    };
    load(true);
    const timer = setInterval(() => { if (document.visibilityState === 'visible') load(false); }, POLL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') load(false); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { cancelled = true; clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [code, guest]);

  useEffect(() => {
    clearTimeout(searchTimer.current);
    const q = query.trim();
    if (!guest || q.length < 2) { return undefined; }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const { tracks } = await guestApi.op(code, { op: 'search', guestId: guest.id, q });
        setResults(tracks);
      } catch (err) {
        say(err?.message || "Couldn't search", 'error');
      } finally {
        setSearching(false);
      }
    }, 400);
    return () => clearTimeout(searchTimer.current);
  }, [query, code, guest]);
  const shownResults = query.trim().length < 2 ? null : results;

  // Every tap shows its result at once and the server's answer replaces it; a refusal puts
  // things back and says why
  const request = async (track) => {
    if (!guest || busyUris.has(track.uri)) return;
    buzz();
    setBusyUris((b) => new Set(b).add(track.uri));
    const guess = guessRequest(track, guest);
    // Placed by the same rule the server uses, so the song shows where it will really play
    setState((s) => s && withOrder(s, [...s.queue, guess], guest.id));
    say(`Adding ${track.name}…`, 'success');
    pending.current += 1;
    try {
      const res = await guestApi.op(code, { op: 'request', guestId: guest.id, track });
      setState(res);
      // The search stays, so several songs can be picked from one set of results
      say(res.position === 1 ? `${track.name} is up next` : `${track.name} is ${ordinal(res.position)} in line`, 'success');
    } catch (err) {
      // Only this song's guess comes out; another request made meanwhile stays
      setState((s) => s && withOrder(s, s.queue.filter((i) => i.id !== guess.id), guest.id));
      say(err?.message || "Couldn't add that", 'error');
    } finally {
      pending.current -= 1;
      setBusyUris((b) => { const next = new Set(b); next.delete(track.uri); return next; });
    }
  };

  const vote = async (item) => {
    if (!guest) return;
    buzz();
    const before = state;
    const had = (state?.voted || []).includes(item.id);
    setState((s) => s && withOrder({
      ...s,
      voted: had ? s.voted.filter((id) => id !== item.id) : [...(s.voted || []), item.id]
    }, s.queue.map((i) => (i.id === item.id ? { ...i, votes: Math.max(0, (i.votes || 0) + (had ? -1 : 1)) } : i)), guest.id));
    pending.current += 1;
    try { setState(await guestApi.op(code, { op: 'vote', guestId: guest.id, id: item.id })); } catch (err) { setState(before); say(err?.message || "Couldn't vote", 'error'); } finally { pending.current -= 1; }
  };

  const withdraw = async (item) => {
    if (!guest) return;
    buzz();
    const before = state;
    setState((s) => s && ({ ...s, queue: s.queue.filter((i) => i.id !== item.id) }));
    pending.current += 1;
    try { setState(await guestApi.op(code, { op: 'withdraw', guestId: guest.id, id: item.id })); } catch (err) { setState(before); say(err?.message || "Couldn't remove it", 'error'); } finally { pending.current -= 1; }
  };

  // The room's language on a phone: ink, paper, mono labels, hairlines; words you can press carry
  // a hair under them. The song playing tints the top of the page through a small blurred copy of
  // its cover scaled up (a large CSS blur is what WebKit drops). The app's stylesheet holds the
  // page body still for its own layout, so this page scrolls itself.
  const art = state?.nowPlaying?.image || null;
  const shell = (children) => (
    <div className="fixed inset-0 overflow-y-auto overscroll-y-contain" style={{ background: 'var(--room-ink)', color: 'var(--room-paper)', fontFamily: 'var(--font-room)' }}>
      {art && <div aria-hidden="true" className="pointer-events-none fixed left-1/2 top-0 z-0 h-[120px] w-[120px] -translate-x-1/2 bg-cover bg-center opacity-40" style={{ backgroundImage: `url(${art})`, filter: 'blur(18px)', transform: 'translate(-50%, -20%) scale(4.5)' }} />}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0" style={{ background: 'linear-gradient(to bottom, rgba(13,12,18,0.35), var(--room-ink) 420px)' }} />
      <div className="relative z-10 mx-auto flex max-w-lg flex-col gap-7 px-5 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]">
        {children}
      </div>
    </div>
  );

  if (gone) {
    return shell(<div className="pt-24 text-center">
      <p className="room-mono text-[var(--room-faint)]">Party {code}</p>
      <h1 className="mt-3 text-[30px] font-semibold leading-[1.05] tracking-[-0.025em]">{gone}</h1>
      <p className="mt-3 text-[15px] text-[var(--room-dim)]">Thanks for coming.</p>
    </div>);
  }

  if (!guest) {
    return shell(<form className="flex flex-col gap-5 pt-20" onSubmit={(e) => { e.preventDefault(); const name = nameDraft.trim().slice(0, 40); if (!name) return; const g = { id: loadGuest()?.id || newGuestId(), name }; saveGuest(g); setGuest(g); }}>
      <p className="room-mono text-[var(--room-faint)]">Jomify · party <span className="tracking-[0.3em] text-[var(--room-paper)]">{code}</span></p>
      <h1 className="text-[34px] font-semibold leading-[1.05] tracking-[-0.025em]">Pick the music</h1>
      <p className="text-[15px] text-[var(--room-dim)]">Find songs and ask for them; vote for other people's. No account needed. What should we call you?</p>
      <input autoFocus value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} placeholder="Your name" aria-label="Your name" maxLength={40} className="ui-field text-[18px]" />
      <p><button type="submit" disabled={!nameDraft.trim()} className="ui-pill min-h-[44px] px-6 text-[15px]">Join the party</button></p>
    </form>);
  }

  const np = state?.nowPlaying;
  const mine = state?.mine || {};
  const voted = new Set(state?.voted || []);
  const myItems = (state?.queue || []).filter((i) => mine[i.id]);
  const waiting = (state?.queue || []).length;
  const queuedUris = new Set([...(state?.queue || []).map((i) => i.uri), state?.upNext?.uri].filter(Boolean));
  const history = state?.history || [];
  // My song is on: the song playing is one I requested and it has been handed over (not merely a coincidence of the playlist)
  const myTurn = np && !np.paused && history.some((h) => h.uri === np.uri && h.guestId === guest.id);

  return shell(<>
    <header className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="room-mono truncate text-[var(--room-faint)]">{state?.party?.hostName ? `${state.party.hostName}'s party` : 'Party'}</p>
        <p className="mt-1 text-[22px] font-semibold tracking-[0.3em]" style={{ fontFamily: 'var(--font-mono)' }}>{code}</p>
      </div>
      <Word onClick={() => { setGuest(null); }} aria-label={`You are ${guest.name}; change your name`}>{guest.name}</Word>
    </header>

    {state?.hostAway && <p className="text-[13.5px] text-[var(--room-dim)]">The host's Jomify is away for the moment. Requests still land; searching comes back when it does.</p>}
    {state?.party?.paused && <p className="text-[13.5px] text-[var(--room-dim)]">The host has paused requests for now.</p>}

    {/* playing */}
    <section>
      <Label right={spotifyUrl(np) ? <a href={spotifyUrl(np)} target="_blank" rel="noreferrer" className="ui-word">Spotify</a> : null}>{myTurn ? 'Your song is playing' : np ? (np.paused ? 'Paused' : 'Playing') : 'Waiting for music'}</Label>
      <div className="mt-4 flex items-center gap-4">
        <Cover src={np?.image} size={72} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[19px] font-semibold leading-tight tracking-[-0.015em]">{np?.name || '…'}</p>
          <p className="room-mono mt-1.5 truncate text-[var(--room-dim)]">{np?.artists || ''}</p>
        </div>
      </div>
      {state?.upNext && <p className="mt-3 truncate text-[13px] text-[var(--room-dim)]"><span className="room-mono text-[var(--room-faint)]">Next</span> · {state.upNext.name}{state.upNext.guestName ? ` · ${state.upNext.guestName}` : ''}</p>}
    </section>

    {/* find and ask */}
    <section>
      <Label>Ask for a song</Label>
      <div className="relative mt-1">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="A song, an artist" aria-label="Find a song" className="ui-field pr-10 text-[17px]" />
        {query && <button type="button" onClick={() => { setQuery(''); setResults(null); }} aria-label="Clear" className="absolute right-0 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center text-[var(--room-faint)]"><X className="h-4 w-4" /></button>}
      </div>
      {notice && <p role="status" className={`mt-3 text-[13.5px] ${notice.tone === 'error' ? 'text-[rgb(240,160,160)]' : 'text-[var(--room-paper)]'}`}>{notice.text}</p>}
      {searching && <p className="room-mono mt-3 text-[var(--room-faint)]">Searching</p>}
      {shownResults && shownResults.length === 0 && !searching && <p className="mt-3 text-[13.5px] text-[var(--room-faint)]">Nothing found.</p>}
      {shownResults && shownResults.length > 0 && (
        <ul className="mt-2">
          {shownResults.map((t, n) => {
            const queued = busyUris.has(t.uri) || queuedUris.has(t.uri);
            return (
              <li key={t.uri} style={{ borderTop: n ? '1px solid var(--room-hair)' : 'none' }}>
                <button type="button" onClick={() => request(t)} disabled={queued} aria-label={queued ? `${t.name}, in the queue` : `Ask for ${t.name}`} className="flex min-h-[56px] w-full items-center gap-3 py-2 text-left">
                  <Cover src={t.image} size={40} />
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-[15px] font-medium ${queued ? 'text-[var(--room-dim)]' : ''}`}>{t.name}</span>
                    <span className="block truncate text-[12.5px] text-[var(--room-dim)]">{queued ? 'In the queue' : `${t.artists}${t.durationMs ? ` · ${fmt(t.durationMs)}` : ''}`}</span>
                  </span>
                  <span className={`room-mono shrink-0 ${queued ? 'text-[var(--room-faint)]' : 'text-[var(--room-paper)] underline decoration-[rgba(241,239,233,0.3)] underline-offset-[5px]'}`}>{queued ? 'Asked' : 'Ask'}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>

    {myItems.length > 0 && (
      <section>
        <Label>Yours</Label>
        <ul>
          {myItems.map((i, n) => (
            <li key={i.id} className="flex min-h-[56px] items-center gap-3 py-2" style={{ borderTop: n ? '1px solid var(--room-hair)' : 'none' }}>
              <span className="room-mono w-12 shrink-0 text-[var(--room-paper)]">{ordinal(mine[i.id])}</span>
              <span className="min-w-0 flex-1"><span className="block truncate text-[15px] font-medium">{i.name}</span><span className="block truncate text-[12.5px] text-[var(--room-dim)]">{i.artists}</span></span>
              <Word onClick={() => withdraw(i)} aria-label={`Take back ${i.name}`}>Take back</Word>
            </li>
          ))}
        </ul>
      </section>
    )}

    <section>
      <Label right={waiting ? <span>{waiting}</span> : null}>Coming up</Label>
      {waiting === 0 ? (
        <p className="pt-3 text-[13.5px] text-[var(--room-faint)]">Nothing asked for yet. {state?.party?.backing?.name ? `${state.party.backing.name} plays in the meantime.` : 'Be the first.'}</p>
      ) : (
        <ol>
          {(state?.queue || []).slice(0, 12).map((i, n) => (
            <li key={i.id} className="flex min-h-[52px] items-center gap-3 py-1.5" style={{ borderTop: n ? '1px solid var(--room-hair)' : 'none' }}>
              <span className="room-mono w-5 shrink-0 text-right text-[var(--room-faint)]">{n + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14.5px] font-medium">{i.name}</span>
                <span className="block truncate text-[12px] text-[var(--room-dim)]">{i.artists} · {mine[i.id] ? 'you' : i.guestName}</span>
              </span>
              {mine[i.id] ? (
                <span className="room-mono w-14 shrink-0 text-right text-[var(--room-faint)]">{i.votes ? `▲ ${i.votes}` : ''}</span>
              ) : (
                <button type="button" onClick={() => vote(i)} aria-pressed={voted.has(i.id)} aria-label={`${voted.has(i.id) ? 'Take back your vote for' : 'Vote for'} ${i.name}`} className="ui-word inline-flex min-h-[44px] w-16 shrink-0 items-center justify-end">
                  ▲ {i.votes || 0}
                </button>
              )}
            </li>
          ))}
          {waiting > 12 && <li className="room-mono pt-2 text-[var(--room-faint)]">and {waiting - 12} more</li>}
        </ol>
      )}
      {waiting > 0 && <p className="mt-3 text-[12.5px] text-[var(--room-faint)]">Voted songs go first, most votes first. The rest take turns: everyone's first song plays before anyone's second.</p>}
    </section>

    {history.length > 0 && (
      <section>
        <Label>Played</Label>
        <ul>
          {history.map((h, n) => (
            <li key={`${h.id}-${h.playedAt}`} className="flex min-h-[44px] items-center gap-3 py-1.5 text-[13.5px]" style={{ borderTop: n ? '1px solid var(--room-hair)' : 'none' }}>
              <span className="min-w-0 flex-1 truncate"><span className="font-medium">{h.name}</span> <span className="text-[var(--room-dim)]">· {h.artists}</span></span>
              <span className="shrink-0 text-[12px] text-[var(--room-faint)]">{h.guestName}</span>
              {spotifyUrl(h) && <a href={spotifyUrl(h)} target="_blank" rel="noreferrer" aria-label={`Open ${h.name} in Spotify`} className="ui-word inline-flex min-h-[44px] items-center">Open</a>}
            </li>
          ))}
        </ul>
      </section>
    )}
  </>);
}
