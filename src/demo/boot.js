// Demo mode: Jomify without a Spotify account, for showing people. Opened at /demo (or from the
// sign-in page), it lasts until the tab is closed or the visitor signs in properly.
//
// The first part runs from index.html, before any of the app: it gives the demo its own storage
// for the tab only (so nothing a visitor does reaches a real account's saved data on the same
// device) and a demo session. This part, imported first by main.jsx, answers Spotify's requests
// from the demo library (src/demo/spotify.js) and stands in for Spotify's in-browser player.

import { answerSpotify, answerJomify, installDemoPlayer, DEMO_TOKEN } from './spotify.js';
import { startClock } from './engine.js';

const FLAG = 'jomify_demo';
const PREFIX = 'jomify-demo:';

export const DEMO = typeof window !== 'undefined' && Boolean(window.__jomifyDemo);
export const isDemo = () => DEMO;

export function enterDemo() {
  location.assign('/demo');
}

export function exitDemo() {
  try {
    sessionStorage.removeItem(FLAG);
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(PREFIX)) sessionStorage.removeItem(key);
    }
  } catch { /* nothing to clear */ }
  location.assign('/');
}

function install() {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    let url;
    try { url = new URL(raw, location.href); } catch { return realFetch(input, init); }
    const method = String(init?.method || (typeof input === 'object' && input.method) || 'GET').toUpperCase();
    if (url.hostname === 'api.spotify.com') return answerSpotify(url, method, init);
    if (url.hostname === 'accounts.spotify.com' && url.pathname === '/api/token') {
      return new Response(JSON.stringify({ access_token: DEMO_TOKEN, refresh_token: 'jomify-demo-refresh', expires_in: 3600, token_type: 'Bearer' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname.startsWith('/api/') && (url.origin === location.origin || url.hostname.endsWith('jomify.vercel.app'))) return answerJomify(url, init, realFetch);
    return realFetch(input, init);
  };

  installDemoPlayer();
  startClock();
  // The controller only fetches Spotify's player script when this element is missing, and uses
  // window.Spotify as it finds it otherwise
  const plant = () => {
    if (document.getElementById('spotify-player-script')) return;
    const marker = document.createElement('script');
    marker.id = 'spotify-player-script';
    document.body.appendChild(marker);
  };
  if (document.body) plant(); else document.addEventListener('DOMContentLoaded', plant, { once: true });
}

if (DEMO) install();
