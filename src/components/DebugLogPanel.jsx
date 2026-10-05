import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Copy, Share2, Trash2, Check } from 'lucide-react';
import { getEntries, subscribe, clearLog, formatEntry, formatLog } from '../services/debugLog';

const PAGE = 300;

const toneFor = (category) => {
  if (category === 'error' || category === 'console.error') return 'text-red-400';
  if (category === 'console.warn') return 'text-amber-300';
  if (category === 'sdk' || category === 'playback') return 'text-sky-300';
  return 'text-neutral-300';
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

  const button = 'inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 h-9 text-xs font-semibold text-white hover:bg-white/10';

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex flex-col bg-neutral-950 text-white pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold">Debug log</h2>
          <p className="text-xs text-neutral-500">{getEntries().length} entries, kept on this device</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close debug log" className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-white/10">
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-white/10">
        <button type="button" onClick={handleCopy} className={button}>
          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />} {copied ? 'Copied' : needle ? `Copy ${matching.length} shown` : 'Copy all'}
        </button>
        {typeof navigator !== 'undefined' && navigator.share && (
          <button type="button" onClick={() => shareText(textToSend()).catch((err) => console.warn('[debug log] share failed:', err?.message || err))} className={button}>
            <Share2 className="w-4 h-4" /> Share
          </button>
        )}
        <button type="button" onClick={handleClear} className={`${button} ${confirmClear ? 'border-red-400 text-red-300' : ''}`}>
          <Trash2 className="w-4 h-4" /> {confirmClear ? 'Tap again to clear' : 'Clear'}
        </button>
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter, e.g. 2026-10-04"
          className="flex-1 min-w-[8rem] h-9 rounded-full bg-white/5 border border-white/10 px-4 text-sm text-white placeholder:text-neutral-500 outline-none focus:border-white/30"
        />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-2 font-mono text-[11px] leading-relaxed">
        {visible.length === 0 && <p className="text-neutral-500 py-6 text-center">Nothing logged{needle ? ' matching that' : ''}.</p>}
        {visible.map((e, i) => (
          <p key={`${e.t}-${i}`} className={`break-words py-0.5 border-b border-white/[0.03] ${toneFor(e.c)}`}>{formatEntry(e)}</p>
        ))}
        {matching.length > shown && (
          <button type="button" onClick={() => setShown((n) => n + PAGE)} className={`${button} my-4 mx-auto flex`}>
            Show older ({matching.length - shown} more)
          </button>
        )}
      </div>
    </div>,
    document.body
  );
}
