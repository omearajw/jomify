// The request deadline lives here rather than in api.js so that auth.js and the sync client can
// use it without importing api.js, which now depends on them in turn.

// A mobile radio can leave a request outstanding indefinitely, and fetch has no timeout of its
// own. One such request used to stall the playback poller for the rest of the session.
export const REQUEST_TIMEOUT_MS = 15000;

// Undefined where the browser lacks it, which simply means no deadline rather than a hard failure
export const timeoutSignal = (ms) =>
  (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') ? AbortSignal.timeout(ms) : undefined;
