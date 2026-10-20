import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { getEntries, subscribe, clearLog, formatEntry, formatLog } from '../services/debugLog';
import { checkSpotifyEndpoints } from '../services/endpointCheck';
import { checkQueueBehaviour, listenListSwap, checkSpotifyQueue } from '../services/queueCheck';

const PAGE = 300;

const toneFor = (category) => {
  if (category === 'error' || category === 'console.error') return 'text-[rgb(240,160,160)]';
  if (category === 'console.warn') return 'text-[rgb(230,200,140)]';
  if (category === 'sdk' || category === 'playback') return 'text-[var(--room-paper)]';
  return 'text-[var(--room-dim)]';
};

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older WebViews refuse the clipboard API outside a secure, focused context
    const area = document.createElement('textarea');
    area.value = text;
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

// A long log pasted as text gets truncated by most chat apps, so share it as a file where the
// platform allows
async function shareText(text) {
  const file = typeof File !== 'undefined' ? new File([text], 'jomify-log.txt', { type: 'text/plain' }) : null;
  try {
    if (file && navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: 'Jomify debug log' });
    else await navigator.share({ title: 'Jomify debug log', text });
  } catch (err) {
    if (err?.name !== 'AbortError') throw err;
  }
}

export default function DebugLogPanel({ onClose }) {
  const [, rerender] = useState(0);
  const [shown, setShown] = useState(PAGE);
  const [filter, setFilter] = useState('');
  const [copied, setCopied] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [checking, setChecking] = useState(false);
  const [queueChecking, setQueueChecking] = useState(false);
  const [confirmQueueCheck, setConfirmQueueCheck] = useState(false);
  const [listening, setListening] = useState(false);
  const [queueTesting, setQueueTesting] = useState(false);

  useEffect(() => subscribe(() => rerender((n) => n + 1)), []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const needle = filter.trim().toLowerCase();
  const matching = getEntries().filter((e) => !needle || formatEntry(e).toLowerCase().includes(needle));
  const visible = matching.slice(-shown).reverse();

  // With a filter typed in, copy and share only what it shows: a whole log is long enough that a
  // chat app cuts the paste off before the part that matters, which is usually the newest
  const textToSend = () => (needle ? matching.map(formatEntry).join('\n') : formatLog());

  const handleCopy = async () => {
    if (await copyText(textToSend())) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };
  const handleClear = () => {
    if (!confirmClear) { setConfirmClear(true); setTimeout(() => setConfirmClear(false), 3000); return; }
    clearLog();
    setConfirmClear(false);
  };

  // It plays music for about a minute and leaves it paused, so it asks first
  const handleQueueCheck = () => {
    if (!confirmQueueCheck) { setConfirmQueueCheck(true); setTimeout(() => setConfirmQueueCheck(false), 4000); return; }
    setConfirmQueueCheck(false);
    setQueueChecking(true);
    setFilter('queue check');
    checkQueueBehaviour().finally(() => setQueueChecking(false));
  };

  const button = 'ui-word inline-flex min-h-[36px] items-center';

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex flex-col pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]" style={{ background: 'var(--room-ink)', color: 'var(--room-paper)', fontFamily: 'var(--font-room)' }}>
      <div className="flex items-center gap-4 border-b border-[var(--room-hair)] px-5 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="room-mono text-[var(--room-dim)]">Debug log</h2>
          <p className="mt-1 text-[12px] text-[var(--room-faint)]">{getEntries().length} entries, kept on this device</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close debug log" className={button}>Close</button>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-[var(--room-hair)] px-5 py-2">
        <button type="button" onClick={handleCopy} className={button}>
          {copied ? 'Copied' : needle ? `Copy ${matching.length} shown` : 'Copy all'}
        </button>
        {typeof navigator !== 'undefined' && navigator.share && (
          <button type="button" onClick={() => shareText(textToSend()).catch((err) => console.warn('[debug log] share failed:', err?.message || err))} className={button}>
            Share
          </button>
        )}
        <button
          type="button"
          disabled={checking}
          onClick={() => { setChecking(true); setFilter('api check'); checkSpotifyEndpoints().finally(() => setChecking(false)); }}
          className={button}
          title="Asks Spotify, read-only, whether each endpoint Jomify uses still answers"
        >
          {checking ? 'Checking…' : 'Check Spotify'}
        </button>
        <button
          type="button"
          disabled={queueChecking}
          onClick={handleQueueCheck}
          className={button}
          title="Plays a few seconds of your liked songs here to see how Spotify handles lists of songs; takes about two minutes and leaves the music paused"
        >
          {queueChecking ? 'Checking queue…' : confirmQueueCheck ? 'Plays music here for ~2 min: tap again' : 'Check queue'}
        </button>
        <button
          type="button"
          disabled={listening}
          onClick={() => { setListening(true); setFilter('queue check'); listenListSwap().finally(() => setListening(false)); }}
          className={button}
          title="Plays a liked song here for about half a minute and swaps Spotify's list three times; listen for a hiccup"
        >
          {listening ? 'Listen…' : 'Listen: list swap'}
        </button>
        <button
          type="button"
          disabled={queueTesting}
          onClick={() => { setQueueTesting(true); setFilter('queue check'); checkSpotifyQueue().finally(() => setQueueTesting(false)); }}
          className={button}
          title="Plays music here for about a minute to see how Spotify's own queue behaves with Jomify's lists"
        >
          {queueTesting ? "Checking Spotify's queue…" : "Check Spotify's queue"}
        </button>
        <button type="button" onClick={handleClear} className={`${button} ${confirmClear ? 'text-[rgb(240,160,160)]' : ''}`}>
          {confirmClear ? 'Tap again to clear' : 'Clear'}
        </button>
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter, e.g. 2026-10-04"
          aria-label="Filter the log"
          className="ui-field min-w-[8rem] flex-1 text-[13px]"
        />
      </div>
      <div className="custom-scrollbar min-h-0 flex-1 cursor-text overflow-y-auto overscroll-contain px-5 py-2 text-[11px] leading-relaxed [font-family:var(--font-mono)]" style={{ WebkitUserSelect: 'text', userSelect: 'text' }}>
        {visible.length === 0 && <p className="py-6 text-center text-[var(--room-faint)]">Nothing logged{needle ? ' matching that' : ''}.</p>}
        {visible.map((e, i) => (
          <p key={`${e.t}-${i}`} className={`break-words border-b border-[var(--room-hair)] py-0.5 ${toneFor(e.c)}`}>{formatEntry(e)}</p>
        ))}
        {matching.length > shown && (
          <p className="my-4 text-center">
            <button type="button" onClick={() => setShown((n) => n + PAGE)} className={button}>
              Show older ({matching.length - shown} more)
            </button>
          </p>
        )}
      </div>
    </div>,
    document.body
  );
}
