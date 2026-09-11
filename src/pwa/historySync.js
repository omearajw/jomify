// Keeps the browser history the same shape as the app's own navigation so the phone's back
// button walks back through views and closes sheets instead of leaving the app. The store's
// viewHistory stays the source of truth; this mirrors it and never reads history.state.
//
// Model: `entries` is our copy of the browser stack above the base entry. A store change pushes
// or pops it (calling pushState / history.back()), and a popstate the user caused pops it and
// applies the matching store change. Pops we caused ourselves are counted in `pendingPops` and
// skipped when their popstate arrives.

// Explicit .js extension so scripts/playback-cases.mjs can import this under plain node
import { useUserStore } from '../store/userStore.js';

let installed = false;
let suppress = false;
let pendingPops = 0;
const entries = [];
const teardowns = [];

const canUseHistory = () => typeof window !== 'undefined' && Boolean(window.history?.pushState);

function popOurEntry() {
  entries.pop();
  pendingPops += 1;
  window.history.back();
}

function onPopState() {
  if (pendingPops > 0) { pendingPops -= 1; return; }
  const top = entries.pop();
  if (!top) return; // at the base entry; the browser leaves the app, as it should
  suppress = true;
  try {
    if (top.kind === 'sheet') top.close();
    else useUserStore.getState().goBack();
  } finally {
    suppress = false;
  }
}

export function installHistorySync() {
  if (installed || !canUseHistory()) return () => {};
  installed = true;
  window.history.replaceState({ jomify: 0 }, '');
  window.addEventListener('popstate', onPopState);

  teardowns.push(useUserStore.subscribe(
    (s) => s.viewHistory.length,
    (len, prev) => {
      if (suppress) return;
      if (len > prev) {
        entries.push({ kind: 'view' });
        window.history.pushState({ jomify: entries.length }, '');
      } else if (len < prev) {
        // An in-app Back: pull the browser stack back to match, one entry per frame
        for (let i = prev; i > len; i--) {
          if (entries[entries.length - 1]?.kind === 'view') popOurEntry();
        }
      }
    }
  ));

  return () => {
    window.removeEventListener('popstate', onPopState);
    teardowns.splice(0).forEach(fn => fn());
    entries.length = 0;
    installed = false;
  };
}

// Mirrors an open/closed flag in the store as one history entry, so back closes the sheet.
// `when` lets a sheet opt out (a desktop right-click menu should not touch history).
export function syncSheetWithHistory(selector, close, { tag = 'sheet', when = () => true } = {}) {
  if (!canUseHistory()) return () => {};
  return useUserStore.subscribe(selector, (open, wasOpen) => {
    if (suppress || Boolean(open) === Boolean(wasOpen)) return;
    if (open) {
      if (!when()) return;
      entries.push({ kind: 'sheet', tag, close });
      window.history.pushState({ jomify: entries.length, sheet: tag }, '');
    } else {
      const top = entries[entries.length - 1];
      if (top?.kind === 'sheet' && top.tag === tag) popOurEntry();
    }
  });
}
