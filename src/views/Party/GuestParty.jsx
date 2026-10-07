import { useEffect, useRef, useState } from 'react';
import { Music2, Search, Plus, Check, Loader2, X, PauseCircle, WifiOff, ChevronUp, ExternalLink } from 'lucide-react';
import { guestApi } from '../../party/client';

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
const fmt = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;

export default function GuestParty({ code }) {
  const [guest, setGuest] = useState(() => loadGuest());
  const [nameDraft, setNameDraft] = useState(() => loadGuest()?.name || '');
  const [state, setState] = useState(null);
  const [gone, setGone] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [notice, setNotice] = useState(null); // { text, tone }
  const [busyUri, setBusyUri] = useState(null);
  const searchTimer = useRef(null);
  const noticeTimer = useRef(null);

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
        if (!cancelled) { setState(s); setGone(''); }
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

  const request = async (track) => {
    if (!guest || busyUri) return;
    setBusyUri(track.uri);
    try {
      const res = await guestApi.op(code, { op: 'request', guestId: guest.id, track });
      setState(res);
      say(res.position === 1 ? `${track.name} is up next` : `${track.name} is ${ordinal(res.position)} in line`, 'success');
      setQuery('');
      setResults(null);
    } catch (err) {
      say(err?.message || "Couldn't add that", 'error');
    } finally {
      setBusyUri(null);
    }
  };

  const vote = async (item) => {
    if (!guest) return;
    try { setState(await guestApi.op(code, { op: 'vote', guestId: guest.id, id: item.id })); } catch (err) { say(err?.message || "Couldn't vote", 'error'); }
  };

  const withdraw = async (item) => {
    if (!guest) return;
    try { setState(await guestApi.op(code, { op: 'withdraw', guestId: guest.id, id: item.id })); } catch (err) { say(err?.message || "Couldn't remove it", 'error'); }
  };

  const shell = (children) => (
    <div className="min-h-dvh bg-black text-white">
      <div className="fixed inset-0 z-0 bg-aurora opacity-20" />
      <div className="relative z-10 max-w-lg mx-auto px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))] flex flex-col gap-5">
        {children}
      </div>
    </div>
  );

  if (gone) {
    return shell(<div className="pt-20 text-center">
      <p className="text-5xl mb-4">🎉</p>
      <h1 className="text-2xl font-extrabold">{gone}</h1>
      <p className="text-neutral-400 mt-2">Thanks for coming.</p>
    </div>);
  }

  if (!guest) {
    return shell(<form className="pt-16 flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); const name = nameDraft.trim().slice(0, 40); if (!name) return; const g = { id: loadGuest()?.id || newGuestId(), name }; saveGuest(g); setGuest(g); }}>
      <h1 className="text-4xl font-extrabold text-brand-gradient tracking-tighter">Jomify party</h1>
      <p className="text-neutral-300">You're joining party <span className="font-mono font-bold text-white tracking-widest">{code}</span>. What should we call you?</p>
      <input autoFocus value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} placeholder="Your name" aria-label="Your name" maxLength={40} className="w-full rounded-2xl bg-white/10 border border-white/15 px-5 py-4 text-lg text-white placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-[var(--brand-mid)]" />
      <button type="submit" disabled={!nameDraft.trim()} className="rounded-full bg-brand-gradient py-4 text-lg font-bold shadow-brand-glow disabled:opacity-50">Join the party</button>
    </form>);
  }

  const np = state?.nowPlaying;
  const mine = state?.mine || {};
  const voted = new Set(state?.voted || []);
  const myItems = (state?.queue || []).filter((i) => mine[i.id]);
  const waiting = (state?.queue || []).length;
  const history = state?.history || [];
  // My song is on: the song playing is one I requested and it has been handed over (not merely a coincidence of the playlist)
  const myTurn = np && !np.paused && history.some((h) => h.uri === np.uri && h.guestId === guest.id);

  return shell(<>
    <header className="flex items-center justify-between">
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-neutral-400">{state?.party?.hostName ? `${state.party.hostName}'s party` : 'Party'}</p>
        <p className="font-mono text-2xl font-extrabold tracking-[0.3em]">{code}</p>
      </div>
      <button type="button" onClick={() => { setGuest(null); }} className="text-xs text-neutral-400 underline">Hi {guest.name}</button>
    </header>

    {state?.hostAway && <p className="flex items-center gap-2 rounded-2xl bg-amber-500/15 border border-amber-400/30 px-4 py-3 text-sm text-amber-200"><WifiOff className="w-4 h-4" /> The host's Jomify is away. Requests still land; searching comes back when it does.</p>}
    {state?.party?.paused && <p className="flex items-center gap-2 rounded-2xl bg-white/10 px-4 py-3 text-sm text-neutral-200"><PauseCircle className="w-4 h-4" /> The host has paused requests for now.</p>}

    {myTurn && <p role="status" className="rounded-2xl bg-brand-gradient px-4 py-3 text-sm font-bold text-white shadow-brand-glow animate-fade-in">🎉 Your song is playing!</p>}
    <section className={`rounded-3xl border p-4 flex items-center gap-4 ${myTurn ? 'bg-white/10 border-[var(--brand-mid)]' : 'bg-white/5 border-white/10'}`}>
      {np?.image ? <img src={np.image} alt="" className="w-20 h-20 rounded-2xl object-cover shadow-xl" /> : <div className="w-20 h-20 rounded-2xl bg-white/10 flex items-center justify-center"><Music2 className="w-8 h-8 text-neutral-400" /></div>}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold uppercase tracking-widest text-neutral-400">{np ? (np.paused ? 'Paused' : 'Now playing') : 'Waiting for music'}</p>
        <p className="font-bold text-lg truncate">{np?.name || '…'}</p>
        <p className="text-neutral-400 truncate">{np?.artists || ''}</p>
        {state?.upNext && <p className="text-xs text-neutral-500 mt-1 truncate">Next: {state.upNext.name} · {state.upNext.guestName}</p>}
      </div>
      {spotifyUrl(np) && <a href={spotifyUrl(np)} target="_blank" rel="noreferrer" aria-label="Open in Spotify" className="p-2 text-neutral-400 hover:text-white shrink-0"><ExternalLink className="w-5 h-5" /></a>}
    </section>

    <section className="flex flex-col gap-3">
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-neutral-500" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a song to request" aria-label="Find a song" className="w-full rounded-2xl bg-white/10 border border-white/15 pl-12 pr-10 py-4 text-lg text-white placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-[var(--brand-mid)]" />
        {query && <button type="button" onClick={() => { setQuery(''); setResults(null); }} aria-label="Clear" className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-neutral-400"><X className="w-5 h-5" /></button>}
      </div>
      {notice && <p role="status" className={`rounded-2xl px-4 py-3 text-sm font-semibold ${notice.tone === 'error' ? 'bg-red-500/15 text-red-200' : notice.tone === 'success' ? 'bg-emerald-500/15 text-emerald-200' : 'bg-white/10'}`}>{notice.text}</p>}
      {searching && <p className="text-sm text-neutral-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Searching…</p>}
      {shownResults && shownResults.length === 0 && !searching && <p className="text-sm text-neutral-400">Nothing found.</p>}
      {shownResults && shownResults.length > 0 && (
        <ul className="flex flex-col gap-2">
          {shownResults.map((t) => (
            <li key={t.uri}>
              <button type="button" onClick={() => request(t)} disabled={busyUri === t.uri} className="w-full flex items-center gap-3 rounded-2xl bg-white/5 active:bg-white/15 border border-white/10 p-3 text-left">
                {t.image ? <img src={t.image} alt="" className="w-12 h-12 rounded-lg object-cover" /> : <div className="w-12 h-12 rounded-lg bg-white/10" />}
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold truncate">{t.name}</span>
                  <span className="block text-sm text-neutral-400 truncate">{t.artists}{t.durationMs ? ` · ${fmt(t.durationMs)}` : ''}</span>
                </span>
                {busyUri === t.uri ? <Loader2 className="w-6 h-6 animate-spin text-neutral-400" /> : <Plus className="w-7 h-7 text-[var(--brand-mid)]" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>

    {myItems.length > 0 && (
      <section>
        <h2 className="text-xs font-bold uppercase tracking-widest text-neutral-400 mb-2">Your requests</h2>
        <ul className="flex flex-col gap-2">
          {myItems.map((i) => (
            <li key={i.id} className="flex items-center gap-3 rounded-2xl bg-white/5 border border-white/10 p-3">
              <span className="w-8 h-8 rounded-full bg-brand-gradient flex items-center justify-center text-sm font-extrabold">{mine[i.id]}</span>
              <span className="min-w-0 flex-1"><span className="block font-semibold truncate">{i.name}</span><span className="block text-sm text-neutral-400 truncate">{i.artists}</span></span>
              <button type="button" onClick={() => withdraw(i)} aria-label={`Remove ${i.name}`} className="p-2 text-neutral-400"><X className="w-5 h-5" /></button>
            </li>
          ))}
        </ul>
      </section>
    )}

    <section>
      <h2 className="text-xs font-bold uppercase tracking-widest text-neutral-400 mb-2">Coming up{waiting ? ` · ${waiting}` : ''}</h2>
      {waiting === 0 ? (
        <p className="text-sm text-neutral-500">Nothing requested yet. {state?.party?.backing?.name ? `${state.party.backing.name} is playing in the meantime.` : 'Be the first.'}</p>
      ) : (
        <ol className="flex flex-col gap-1.5">
          {(state?.queue || []).slice(0, 12).map((i, n) => (
            <li key={i.id} className="flex items-center gap-2 px-1 py-1.5 text-sm">
              <span className="w-5 text-right text-neutral-500 tabular-nums">{n + 1}</span>
              <span className="min-w-0 flex-1 truncate"><span className="font-semibold">{i.name}</span> <span className="text-neutral-500">· {i.artists}</span></span>
              <span className="text-xs text-neutral-400 shrink-0 flex items-center gap-1">{mine[i.id] ? <Check className="w-3 h-3" /> : null}{i.guestName}</span>
              {mine[i.id] ? (
                <span className="w-14 text-right text-xs text-neutral-500 tabular-nums shrink-0">{i.votes ? `▲ ${i.votes}` : ''}</span>
              ) : (
                <button type="button" onClick={() => vote(i)} aria-pressed={voted.has(i.id)} aria-label={`${voted.has(i.id) ? 'Take back your vote for' : 'Vote for'} ${i.name}`} className={`w-14 shrink-0 flex items-center justify-end gap-0.5 rounded-full px-2 py-1 text-xs font-bold tabular-nums ${voted.has(i.id) ? 'bg-brand-gradient text-white' : 'bg-white/10 text-neutral-300 active:bg-white/20'}`}><ChevronUp className="w-4 h-4" />{i.votes || 0}</button>
              )}
            </li>
          ))}
          {waiting > 12 && <li className="text-xs text-neutral-500 pl-9">and {waiting - 12} more</li>}
        </ol>
      )}
      {waiting > 0 && <p className="text-xs text-neutral-500 mt-2">Everyone's first request plays before anyone's second. Votes settle the order within a round.</p>}
    </section>

    {history.length > 0 && (
      <section>
        <h2 className="text-xs font-bold uppercase tracking-widest text-neutral-400 mb-2">Played</h2>
        <ul className="flex flex-col gap-1.5">
          {history.map((h) => (
            <li key={`${h.id}-${h.playedAt}`} className="flex items-center gap-2 px-1 py-1.5 text-sm">
              <span className="min-w-0 flex-1 truncate"><span className="font-semibold">{h.name}</span> <span className="text-neutral-500">· {h.artists}</span></span>
              <span className="text-xs text-neutral-400 shrink-0">{h.guestName}</span>
              {spotifyUrl(h) && <a href={spotifyUrl(h)} target="_blank" rel="noreferrer" aria-label={`Open ${h.name} in Spotify`} className="p-1.5 text-neutral-400 hover:text-white shrink-0"><ExternalLink className="w-4 h-4" /></a>}
            </li>
          ))}
        </ul>
      </section>
    )}
  </>);
}
