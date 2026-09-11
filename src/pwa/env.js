// Electron serves dist/ on http://127.0.0.1:3000 and the phone dev loop uses the same loopback
// origin; neither wants a service worker adding a stale-cache failure mode.
export const shouldRegisterServiceWorker = () =>
  typeof location !== 'undefined' && !['127.0.0.1', 'localhost'].includes(location.hostname);
