// A rolling record of what the app did, kept on this device so that an intermittent fault (music
// stopping on a phone, the sorting card drifting) can be read back afterwards instead of guessed
// at. It survives a reload, because the moment someone notices a problem is usually after the
// page has been closed or killed. Nothing leaves the device unless the user copies or shares it.
//
// Log changes, not states: one line when the device drops, not one per poll. Never log tokens.

const STORAGE_KEY = 'jomify_debug_log';
const MAX_ENTRIES = 2000;
// Writing localStorage on every line would cost a phone more than the log is worth
const SAVE_DELAY_MS = 1000;
const MAX_DETAIL_CHARS = 600;

const listeners = new Set();
let saveTimer = null;
let entries = load();

function load() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = null;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)); } catch { /* full or blocked */ }
}

// Details are stored as text so a circular or enormous object can never break logging itself
function describe(detail) {
  if (detail === undefined) return undefined;
  let text;
  if (detail instanceof Error) text = `${detail.name}: ${detail.message}`;
  else if (typeof detail === 'string') text = detail;
  else {
    try { text = JSON.stringify(detail); } catch { text = String(detail); }
  }
  return text && text.length > MAX_DETAIL_CHARS ? `${text.slice(0, MAX_DETAIL_CHARS)}…` : text;
}

export function log(category, message, detail) {
  const now = Date.now();
  const d = describe(detail);
  // A failure that repeats on every poll becomes one line with a count, so it cannot push the
  // rest of the history out
  const last = entries[entries.length - 1];
  if (last && last.c === category && last.m === message && last.d === d) {
    last.n = (last.n || 1) + 1;
    last.u = now;
  } else {
    const entry = { t: now, c: category, m: message };
    if (d) entry.d = d;
    entries.push(entry);
  }
  if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES);
  if (!saveTimer) saveTimer = setTimeout(save, SAVE_DELAY_MS);
  listeners.forEach((fn) => fn());
}

export const getEntries = () => entries;

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function clearLog() {
  entries = [];
  save();
  listeners.forEach((fn) => fn());
}

const stamp = (t) => {
  const d = new Date(t);
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
};

export const formatEntry = (e) =>
  `${stamp(e.t)} [${e.c}] ${e.m}${e.d ? ` ${e.d}` : ''}${e.n ? ` (x${e.n}, last ${stamp(e.u).slice(11)})` : ''}`;
export const formatLog = () => entries.map(formatEntry).join('\n');

// Page-level events, errors and console output. Called once, before the app renders.
let installed = false;
export function installDebugLog() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const connection = navigator.connection;
  log('app', 'started', {
    build: typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'unknown',
    installed: standalone,
    // True when Chrome threw the page away while it was in the background, which is the browser
    // killing playback rather than anything the app did
    discarded: document.wasDiscarded === true,
    online: navigator.onLine,
    network: connection ? `${connection.type || '?'} ${connection.effectiveType || '?'}` : 'unknown',
    ua: navigator.userAgent
  });

  window.addEventListener('error', (e) => log('error', e.message || 'uncaught error', e.error || `${e.filename}:${e.lineno}`));
  window.addEventListener('unhandledrejection', (e) => log('error', 'unhandled rejection', e.reason));

  // The phone's lifecycle is the first suspect when music stops, so record every step of it.
  // `freeze` and `resume` are Chrome's: the page is suspended outright, timers and all.
  document.addEventListener('visibilitychange', () => {
    log('page', document.hidden ? 'hidden' : 'visible');
    if (document.hidden) save();
  });
  document.addEventListener('freeze', () => { log('page', 'frozen by the browser'); save(); });
  document.addEventListener('resume', () => log('page', 'resumed after freeze'));
  window.addEventListener('pagehide', (e) => { log('page', e.persisted ? 'pagehide (kept in memory)' : 'pagehide'); save(); });
  window.addEventListener('pageshow', (e) => { if (e.persisted) log('page', 'restored from memory'); });
  window.addEventListener('online', () => log('network', 'online'));
  window.addEventListener('offline', () => log('network', 'offline'));
  // Headphones or a Bluetooth speaker coming and going pauses music on most phones, which in the
  // log would otherwise look like a pause from nowhere
  navigator.mediaDevices?.addEventListener?.('devicechange', () => {
    navigator.mediaDevices.enumerateDevices()
      .then((devices) => log('audio', 'audio devices changed', `${devices.filter((d) => d.kind === 'audiooutput').length} outputs, ${devices.filter((d) => d.kind === 'audioinput').length} inputs`))
      .catch(() => log('audio', 'audio devices changed'));
  });
  // A weak signal never fires offline, but it does change the connection
  connection?.addEventListener?.('change', () => {
    log('network', 'connection changed', `${connection.type || '?'} ${connection.effectiveType || '?'}, ${connection.downlink ?? '?'}Mbps, ${connection.rtt ?? '?'}ms`);
  });

  // Every warning and error the app already prints, without touching each call site
  for (const level of ['warn', 'error']) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      original(...args);
      try {
        // "%c" marks a styled span and takes the next argument as its CSS; keep the words only
        let rest = args;
        if (typeof args[0] === 'string' && args[0].includes('%c')) {
          const styles = args[0].split('%c').length - 1;
          rest = [args[0].replaceAll('%c', ''), ...args.slice(1 + styles)];
        }
        log(`console.${level}`, rest.map((a) => (typeof a === 'string' ? a : describe(a))).join(' '));
      } catch { /* logging must never throw */ }
    };
  }
}
