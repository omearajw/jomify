import { usePlayerStore } from '../../store/playerStore';
import { usePartyStore } from '../../store/partyStore';
import { useUserStore } from '../../store/userStore';
import { fetchQueue } from '../../services/spotify/api';
import { useProjectorStore, persistProjectorLayouts } from './projectorStore';

// The projector in its own window (/projector), for a second screen: the laptop keeps Jomify
// with its controls, the projector shows the projection. The window is a display only. It never
// plays, never polls Spotify and never renews the sign-in: a second window renewing the token
// would rotate it out from under the main one. Everything it shows arrives from the main window
// over a BroadcastChannel (same browser, same origin): playback, the party, the up-next list.

const CHANNEL = 'jomify-projector';
export const isProjectorWindow = () => typeof location !== 'undefined' && /^\/projector\/?$/.test(location.pathname);

// What crosses the channel: plain data only (the SDK player and the store's functions do not clone)
const plain = (state) => {
  const out = {};
  for (const [k, v] of Object.entries(state)) {
    if (typeof v === 'function') continue;
    try { out[k] = structuredClone(v); } catch { /* not plain data: stays behind */ }
  }
  return out;
};

// --- the main window ---
let feed = null;
export function startProjectorFeed() {
  if (feed || typeof BroadcastChannel === 'undefined' || isProjectorWindow()) return () => {};
  const ch = new BroadcastChannel(CHANNEL);
  const sendPlayer = () => ch.postMessage({ type: 'player', state: plain(usePlayerStore.getState()) });
  const sendParty = () => ch.postMessage({ type: 'party', state: plain(usePartyStore.getState()) });
  // the layouts and the guides, edited here and drawn there
  const sendLayout = () => { const p = useProjectorStore.getState(); ch.postMessage({ type: 'layout', layouts: p.layouts, guides: p.guides }); };
  persistProjectorLayouts();
  ch.onmessage = async (e) => {
    const m = e.data || {};
    if (m.type === 'hello') { sendPlayer(); sendParty(); sendLayout(); }
    if (m.type === 'frame' && m.w > 0 && m.h > 0) useProjectorStore.getState().setFrame(m.w, m.h);
    if (m.type === 'bye') useProjectorStore.getState().setGuides({ on: false });
    // edits made by dragging on the projector itself: this window owns the layouts, saves them and
    // sends them back out like any other change
    if (m.type === 'edit' && m.layouts) useProjectorStore.getState().setLayouts(m.layouts);
    if (m.type === 'pick' && m.picked) useProjectorStore.getState().setPicked(m.picked);
    if (m.type === 'queue?') {
      const token = useUserStore.getState().token;
      if (!token) return;
      try {
        const data = await fetchQueue(token);
        ch.postMessage({ type: 'queue', id: m.id, queue: (data?.queue || []).filter((t) => t && t.type !== 'episode').slice(0, 10) });
      } catch { ch.postMessage({ type: 'queue', id: m.id, queue: [] }); }
    }
  };
  const offPlayer = usePlayerStore.subscribe(sendPlayer);
  const offParty = usePartyStore.subscribe(sendParty);
  const offLayout = useProjectorStore.subscribe((s, prev) => { if (s.layouts !== prev.layouts || s.guides !== prev.guides) sendLayout(); });
  feed = () => { offPlayer(); offParty(); offLayout(); ch.close(); feed = null; };
  return feed;
}

export function openProjectorWindow() {
  const w = window.open('/projector', 'jomify-projector', 'popup,width=1280,height=720');
  w?.focus?.();
  return Boolean(w);
}

// --- the projector window ---
let display = null;
const waiting = new Map();
export function startProjectorDisplay() {
  if (display || typeof BroadcastChannel === 'undefined') return;
  display = new BroadcastChannel(CHANNEL);
  display.onmessage = (e) => {
    const m = e.data || {};
    if (m.type === 'player') usePlayerStore.setState(m.state);
    if (m.type === 'party') usePartyStore.setState(m.state);
    if (m.type === 'queue') { waiting.get(m.id)?.(m.queue); waiting.delete(m.id); }
    if (m.type === 'layout') {
      // while a drag here is under way the main window's echo of an earlier step would pull the
      // shape back for a moment; the drag's own state wins until it settles
      if (Date.now() < holdUntil) useProjectorStore.setState({ guides: m.guides });
      else useProjectorStore.setState({ layouts: m.layouts, guides: m.guides });
    }
  };
  // the screen it is on, so the editor's stage has the projector's shape
  const sendFrame = () => display?.postMessage({ type: 'frame', w: window.innerWidth, h: window.innerHeight });
  window.addEventListener('resize', sendFrame);
  window.addEventListener('pagehide', () => display?.postMessage({ type: 'bye' }));
  display.postMessage({ type: 'hello' });
  sendFrame();
  // a main window opened after this one says hello by sending its first change; asking again
  // now and then covers one that was reloaded
  setInterval(() => { display.postMessage({ type: 'hello' }); sendFrame(); }, 15000);
}

// Edits made on the projector itself, sent to the main window, which owns the layouts
let holdUntil = 0;
export function sendEdit(layouts) {
  holdUntil = Date.now() + 500;
  display?.postMessage({ type: 'edit', layouts });
}
export function sendPick(picked) {
  display?.postMessage({ type: 'pick', picked });
}

// The up-next list, from the main window (null when there is no main window to ask)
export function requestQueue() {
  if (!display) return Promise.resolve(null);
  const id = Math.random().toString(36).slice(2);
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    display.postMessage({ type: 'queue?', id });
    setTimeout(() => { if (waiting.has(id)) { waiting.delete(id); resolve(null); } }, 4000);
  });
}
