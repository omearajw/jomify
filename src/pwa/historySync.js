// Keeps the browser history the same shape as the app's own navigation, with a real address
// for every page, so the phone's back button walks back through views and closes sheets
// instead of leaving the app, Forward goes forward, a reload keeps its place, and a link to
// /playlist/… opens that playlist. The store's viewHistory stays the source of truth for the
// in-app Back button; this mirrors it.
//
// Model: `entries` is our copy of the browser stack above the base entry, each view entry
// carrying its frame. A store change pushes or pops it (pushState / history.back()), and a
// popstate the user caused applies the entry it landed on: a sheet closes, a view frame is
// shown as it was (Back pops the in-app history, Forward pushes). Pops we caused ourselves are
// counted in `pendingPops` and skipped when their popstate arrives.

// Explicit .js extension so scripts/playback-cases.mjs can import this under plain node
import { useUserStore } from '../store/userStore.js';
import { frameToPath, frameOf, sameFrame } from './routes.js';

let installed = false;
let suppress = false;
let pendingPops = 0;
let entries = [];
let position = 0; // index into entries of the current entry; 0 is the base
const teardowns = [];

const canUseHistory = () => typeof window !== 'undefined' && Boolean(window.history?.pushState);
// The address as the browser has it; a test's bare window has none
const here = () => (window.location ? `${window.location.pathname || '/'}${window.location.search || ''}` : null);

function popOurEntry() {
  pendingPops += 1;
  window.history.back();
}

function onPopState(event) {
  if (pendingPops > 0) { pendingPops -= 1; syncPositionFrom(event); return; }
  const target = typeof event.state?.jomify === 'number' ? event.state.jomify : 0;
  const landed = entries[target];
  const leaving = entries[position];
  const backwards = target < position;
  position = target;
  suppress = true;
  try {
    // Sheets on the way close; a sheet landed on reopens nothing (the page beneath is shown)
    if (backwards) {
      if (leaving?.kind === 'sheet') leaving.close();
      else {
        const frame = landed?.kind === 'view' ? landed.frame : entries[0]?.frame;
        if (frame) useUserStore.getState().applyFrame(frame, 'back');
      }
    } else if (landed?.kind === 'view') {
      useUserStore.getState().applyFrame(landed.frame, 'forward');
    } else if (landed?.kind === 'sheet' && landed.open) {
      landed.open();
    }
  } finally {
    suppress = false;
  }
}

function syncPositionFrom(event) {
  if (typeof event.state?.jomify === 'number') position = event.state.jomify;
}

function pushEntry(entry, path) {
  // A new push drops anything forward of here, as the browser does
  entries = entries.slice(0, position + 1);
  entries.push(entry);
  position = entries.length - 1;
  window.history.pushState({ jomify: position, frame: entry.frame || null, ...(entry.kind === 'sheet' ? { sheet: entry.tag } : {}) }, '', path);
}

export function installHistorySync() {
  if (installed || !canUseHistory()) return () => {};
  installed = true;
  // For the harness and the debug log: where the mirror thinks it is
  window.__historyMirror = { get position() { return position; }, get pendingPops() { return pendingPops; }, get entries() { return entries.map((e) => `${e.kind}:${e.tag || e.frame?.view}`); } };
  const state = useUserStore.getState();
  const base = frameOf(state);
  entries = [{ kind: 'view', frame: base }];
  position = 0;
  window.history.replaceState({ jomify: 0, frame: base }, '', frameToPath(base, { query: state.browseQuery }));
  window.addEventListener('popstate', onPopState);

  teardowns.push(useUserStore.subscribe(
    (s) => s.viewHistory.length,
    (len, prev) => {
      if (suppress) return;
      const s = useUserStore.getState();
      if (len > prev) {
        pushEntry({ kind: 'view', frame: frameOf(s) }, frameToPath(frameOf(s), { query: s.browseQuery }));
      } else if (len < prev) {
        // An in-app Back: pull the browser stack back to match, one entry per frame
        for (let i = prev; i > len; i--) {
          if (entries[position]?.kind === 'view' && position > 0) { position -= 1; popOurEntry(); }
        }
      }
    }
  ));

  // The same page under a different address (another playlist from a playlist, a folder): the
  // store pushes history for those, so only the address of the current entry needs refreshing
  teardowns.push(useUserStore.subscribe(
    (s) => frameToPath(frameOf(s), { query: s.browseQuery }),
    (path) => {
      if (suppress) return;
      const current = entries[position];
      const s = useUserStore.getState();
      if (current?.kind === 'view' && !sameFrame(current.frame, frameOf(s))) current.frame = frameOf(s);
      if (here() !== null && here() !== path) {
        window.history.replaceState({ jomify: position, frame: current?.frame || null }, '', path);
      }
    }
  ));

  return () => {
    window.removeEventListener('popstate', onPopState);
    teardowns.splice(0).forEach(fn => fn());
    entries = [];
    position = 0;
    installed = false;
  };
}

// Mirrors an open/closed flag in the store as one history entry, so back closes the sheet.
// `when` lets a sheet opt out (a desktop right-click menu should not touch history).
export function syncSheetWithHistory(selector, close, { tag = 'sheet', when = () => true, open = null } = {}) {
  if (!canUseHistory()) return () => {};
  return useUserStore.subscribe(selector, (isOpen, wasOpen) => {
    if (suppress || Boolean(isOpen) === Boolean(wasOpen)) return;
    if (isOpen) {
      if (!when()) return;
      pushEntry({ kind: 'sheet', tag, close, open }, here() ?? undefined);
    } else {
      const top = entries[position];
      if (top?.kind === 'sheet' && top.tag === tag) { position -= 1; popOurEntry(); }
    }
  });
}
