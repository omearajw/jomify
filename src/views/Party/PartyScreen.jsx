import { useEffect, useRef, useState } from 'react';
import { guestApi, partyLink } from '../../party/client';
import { qrSvg, requestedBy } from '../../party/view';

// A screen on the wall at a party, on the room's language: the join QR on a paper tile, what is
// playing and who asked for it, and the requests in the order they will play, the one already
// lined up first. No account and nothing to press except a word for full screen, which appears
// with the cursor when the mouse moves and goes again when it rests. Escape leaves full screen as
// anywhere; a click no longer puts it back. It keeps its screen awake. Any browser will do.

const POLL_MS = 3000;
const IDLE_MS = 2500;

export default function PartyScreen({ code }) {
  const [state, setState] = useState(null);
  const [gone, setGone] = useState('');
  const [stirred, setStirred] = useState(true);
  const [isFull, setIsFull] = useState(false);
  const idle = useRef(null);

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

  useEffect(() => {
    const onChange = () => setIsFull(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    idle.current = setTimeout(() => setStirred(false), IDLE_MS);
    return () => { document.removeEventListener('fullscreenchange', onChange); clearTimeout(idle.current); };
  }, []);
  const stir = () => { setStirred(true); clearTimeout(idle.current); idle.current = setTimeout(() => setStirred(false), IDLE_MS); };
  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen?.().catch(() => {});
  };
  const link = partyLink(code);

  if (gone) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-[2vmin] p-8 text-center" style={{ background: 'var(--room-ink)', color: 'var(--room-paper)', fontFamily: 'var(--font-room)' }}>
        <p className="room-mono text-[var(--room-faint)]" style={{ fontSize: '1.6vmin' }}>Party {code}</p>
        <h1 className="font-semibold tracking-[-0.025em]" style={{ fontSize: '6vmin' }}>{gone}</h1>
        <p className="text-[var(--room-dim)]" style={{ fontSize: '2.6vmin' }}>Thanks for coming.</p>
      </div>
    );
  }

  const np = state?.nowPlaying;
  const by = requestedBy(np, state || {});
  // the request already handed to Spotify plays next, so it heads the list
  const lined = state?.upNext && (!np || state.upNext.uri !== np.uri) ? [{ ...state.upNext, lined: true }] : [];
  const next = [...lined, ...(state?.queue || [])].slice(0, 6);

  return (
    <div
      onPointerMove={stir}
      className={`fixed inset-0 overflow-hidden select-none ${stirred ? '' : 'cursor-none'}`}
      style={{ background: 'var(--room-ink)', color: 'var(--room-paper)', fontFamily: 'var(--font-room)' }}
    >
      {np?.image && <div aria-hidden="true" className="absolute inset-0 scale-110 bg-cover bg-center opacity-30 blur-3xl" style={{ backgroundImage: `url(${np.image})` }} />}
      <div aria-hidden="true" className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at center, rgba(13,12,18,0.45) 0%, rgba(13,12,18,0.85) 100%)' }} />
      <div className="relative grid h-full grid-cols-1 gap-[5vmin] p-[6vmin] landscape:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        {/* join */}
        <section className="flex min-h-0 flex-col items-center justify-center gap-[2.4vmin]">
          <div className="rounded-[1.2vmin] p-[2.4vmin]" style={{ background: 'var(--room-paper)' }}>
            <div className="h-[34vmin] w-[34vmin] max-w-full [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: qrSvg(link) }} />
          </div>
          <p className="text-center font-semibold tracking-[-0.02em]" style={{ fontSize: '3.4vmin' }}>Scan to pick the music</p>
          <p className="text-center text-[var(--room-dim)]" style={{ fontSize: '2.2vmin' }}>or go to <span className="text-[var(--room-paper)]">{link.replace(/^https?:\/\//, '')}</span></p>
          <p className="font-semibold tracking-[0.3em]" style={{ fontFamily: 'var(--font-mono)', fontSize: '6vmin' }}>{code}</p>
        </section>

        {/* now, and what follows */}
        <section className="flex min-h-0 min-w-0 flex-col justify-center gap-[5vmin]">
          <div className="flex min-w-0 items-center gap-[3vmin]">
            <span className="h-[24vmin] w-[24vmin] shrink-0 overflow-hidden rounded-[1vmin]" style={{ background: 'rgba(241,239,233,0.06)' }}>
              {np?.image && <img src={np.image} alt="" className="h-full w-full object-cover" />}
            </span>
            <div className="min-w-0">
              <p className="room-mono text-[var(--room-faint)]" style={{ fontSize: '1.7vmin' }}>{np ? (np.paused ? 'Paused' : 'Playing') : 'Waiting for music'}</p>
              <p className="line-clamp-2 font-semibold leading-[1.05] tracking-[-0.025em]" style={{ fontSize: '5.6vmin' }}>{np?.name || '…'}</p>
              <p className="room-mono mt-[1vmin] truncate text-[var(--room-dim)]" style={{ fontSize: '2vmin' }}>{np?.artists || ''}</p>
              {by && <p className="mt-[1.2vmin] truncate text-[var(--room-paper)]" style={{ fontSize: '2.6vmin' }}>Asked for by {by}</p>}
            </div>
          </div>
          <div className="min-h-0">
            <p className="room-mono pb-[1.2vmin] text-[var(--room-faint)]" style={{ fontSize: '1.7vmin', borderBottom: '1px solid var(--room-hair)' }}>{next.length ? 'Coming up' : 'Nothing asked for yet'}</p>
            {next.length === 0 ? (
              <p className="pt-[2vmin] text-[var(--room-dim)]" style={{ fontSize: '2.6vmin' }}>{state?.party?.backing?.name ? `${state.party.backing.name} plays until someone asks for a song.` : 'Be the first.'}</p>
            ) : (
              <ol>
                {next.map((i, n) => (
                  <li key={i.id || i.uri} className="flex min-w-0 items-center gap-[2vmin] py-[1.2vmin]" style={{ borderTop: n ? '1px solid var(--room-hair)' : 'none' }}>
                    <span className="room-mono w-[4vmin] text-right text-[var(--room-faint)]" style={{ fontSize: '1.8vmin' }}>{i.lined ? 'Next' : n + (lined.length ? 0 : 1)}</span>
                    <span className="h-[6vmin] w-[6vmin] shrink-0 overflow-hidden rounded-[0.6vmin]" style={{ background: 'rgba(241,239,233,0.06)' }}>{i.image && <img src={i.image} alt="" className="h-full w-full object-cover" />}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium" style={{ fontSize: '2.8vmin' }}>{i.name}</span>
                      <span className="block truncate text-[var(--room-dim)]" style={{ fontSize: '2vmin' }}>{i.artists}{i.guestName ? ` · ${i.guestName}` : ''}</span>
                    </span>
                    {i.votes > 0 && <span className="room-mono shrink-0 text-[var(--room-dim)]" style={{ fontSize: '2vmin' }}>▲ {i.votes}</span>}
                  </li>
                ))}
              </ol>
            )}
          </div>
          {state?.hostAway && <p className="text-[var(--room-dim)]" style={{ fontSize: '2vmin' }}>The host's Jomify is away for the moment; requests still land.</p>}
        </section>
      </div>
      <button
        type="button"
        onClick={toggleFull}
        className="ui-word absolute bottom-[2.4vmin] right-[3vmin] transition-opacity"
        style={{ opacity: stirred ? 1 : 0, pointerEvents: stirred ? 'auto' : 'none', transitionDuration: 'var(--room-mid)' }}
      >
        {isFull ? 'Leave full screen · Esc' : 'Full screen'}
      </button>
    </div>
  );
}
