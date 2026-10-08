import { useEffect, useState } from 'react';
import { Music2, ChevronUp, Maximize, WifiOff } from 'lucide-react';
import { guestApi, partyLink } from '../../party/client';
import { qrSvg, requestedBy } from '../../party/view';

// A screen on the wall at a party: the join QR, what is playing and who asked for it, and what
// comes next. No account, no buttons to press; it keeps its screen awake and takes a tap to go
// fullscreen. Any browser will do: a TV, an old tablet, a spare laptop.

const POLL_MS = 3000;

export default function PartyScreen({ code }) {
  const [state, setState] = useState(null);
  const [gone, setGone] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const s = await guestApi.state(code);
        if (!cancelled) { setState(s); setGone(''); }
      } catch (err) {
        if (!cancelled && err?.status === 404) setGone(err.message);
      }
    };
    load();
    const timer = setInterval(load, POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [code]);

  // A wall screen that dims after a minute is no use
  useEffect(() => {
    let lock = null;
    const acquire = async () => { try { lock = await navigator.wakeLock?.request('screen'); } catch { lock = null; } };
    const onVisible = () => { if (document.visibilityState === 'visible') acquire(); };
    acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => { document.removeEventListener('visibilitychange', onVisible); lock?.release?.().catch(() => {}); };
  }, []);

  const fullscreen = () => { if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {}); };
  const link = partyLink(code);

  if (gone) {
    return (
      <div className="fixed inset-0 bg-black text-white flex flex-col items-center justify-center gap-4 text-center p-8">
        <p className="text-7xl">🎉</p>
        <h1 className="text-5xl font-extrabold">{gone}</h1>
        <p className="text-2xl text-neutral-400">Thanks for coming.</p>
      </div>
    );
  }

  const np = state?.nowPlaying;
  const by = requestedBy(np, state || {});
  const next = (state?.queue || []).slice(0, 5);

  return (
    <div onClick={fullscreen} className="fixed inset-0 overflow-hidden bg-black text-white select-none cursor-none">
      {np?.image && <div className="absolute inset-0 bg-cover bg-center opacity-25 blur-3xl scale-110" style={{ backgroundImage: `url(${np.image})` }} />}
      <div className="absolute inset-0 bg-gradient-to-br from-black/70 via-black/50 to-black/80" />
      <div className="relative h-full grid grid-cols-1 landscape:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-[4vmin] p-[5vmin]">
        {/* Join */}
        <section className="flex flex-col items-center justify-center gap-[2vmin] min-h-0">
          <div className="bg-white rounded-[3vmin] p-[3vmin] shadow-2xl">
            <div className="w-[34vmin] h-[34vmin] max-w-full [&>svg]:w-full [&>svg]:h-full" dangerouslySetInnerHTML={{ __html: qrSvg(link) }} />
          </div>
          <p className="text-[3.6vmin] font-extrabold text-center leading-tight">Scan to pick the music</p>
          <p className="text-[2.4vmin] text-neutral-300 text-center">or go to <span className="font-semibold text-white">{link.replace(/^https?:\/\//, '')}</span></p>
          <p className="font-mono text-[6vmin] font-extrabold tracking-[0.3em]">{code}</p>
        </section>

        {/* Now and next */}
        <section className="flex flex-col justify-center gap-[4vmin] min-h-0 min-w-0">
          <div className="flex items-center gap-[3vmin] min-w-0">
            {np?.image ? <img src={np.image} alt="" className="w-[26vmin] h-[26vmin] rounded-[2vmin] object-cover shadow-2xl shrink-0" /> : <div className="w-[26vmin] h-[26vmin] rounded-[2vmin] bg-white/10 flex items-center justify-center shrink-0"><Music2 className="w-[10vmin] h-[10vmin] text-neutral-500" /></div>}
            <div className="min-w-0">
              <p className="text-[2.2vmin] font-bold uppercase tracking-[0.3em] text-neutral-400">{np ? (np.paused ? 'Paused' : 'Now playing') : 'Waiting for music'}</p>
              <p className="text-[6vmin] font-black leading-[1.05] tracking-tight line-clamp-2">{np?.name || '…'}</p>
              <p className="text-[3.4vmin] text-neutral-300 truncate">{np?.artists || ''}</p>
              {by && <p className="text-[3vmin] font-bold text-[var(--brand-mid)] mt-[1vmin] truncate">Requested by {by}</p>}
            </div>
          </div>
          <div className="min-h-0">
            <p className="text-[2.2vmin] font-bold uppercase tracking-[0.3em] text-neutral-400 mb-[1.5vmin]">{next.length ? 'Coming up' : 'Nothing requested yet'}</p>
            {next.length === 0 ? (
              <p className="text-[3vmin] text-neutral-400">{state?.party?.backing?.name ? `${state.party.backing.name} is playing until someone asks for a song.` : 'Be the first.'}</p>
            ) : (
              <ol className="flex flex-col gap-[1.4vmin]">
                {next.map((i, n) => (
                  <li key={i.id} className="flex items-center gap-[2vmin] min-w-0">
                    <span className="w-[4vmin] text-right text-[3vmin] font-black text-neutral-500 tabular-nums">{n + 1}</span>
                    {i.image ? <img src={i.image} alt="" className="w-[6vmin] h-[6vmin] rounded-[0.8vmin] object-cover" /> : <div className="w-[6vmin] h-[6vmin] rounded-[0.8vmin] bg-white/10" />}
                    <span className="min-w-0 flex-1">
                      <span className="block text-[3vmin] font-bold truncate">{i.name}</span>
                      <span className="block text-[2.2vmin] text-neutral-400 truncate">{i.artists} · {i.guestName}</span>
                    </span>
                    {i.votes > 0 && <span className="text-[2.6vmin] font-bold text-[var(--brand-mid)] flex items-center tabular-nums"><ChevronUp className="w-[3vmin] h-[3vmin]" />{i.votes}</span>}
                  </li>
                ))}
              </ol>
            )}
          </div>
          {state?.hostAway && <p className="text-[2vmin] text-amber-300 flex items-center gap-2"><WifiOff className="w-[2.4vmin] h-[2.4vmin]" /> The host's Jomify is away; requests still land.</p>}
        </section>
      </div>
      <p className="absolute bottom-[2vmin] right-[2.5vmin] text-[1.6vmin] text-neutral-600 flex items-center gap-1"><Maximize className="w-[1.8vmin] h-[1.8vmin]" /> Tap for full screen</p>
    </div>
  );
}
