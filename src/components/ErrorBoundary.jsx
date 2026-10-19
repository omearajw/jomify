import { Component } from 'react';
import JomifyMark from './JomifyMark';

// The only error boundary in the app. Without one, any render-time throw (a podcast episode in
// the queue with no `album`, an unexpected API shape, a bad merge) unmounts the whole tree and
// leaves a blank black screen with nothing to click. This keeps the failure visible and
// recoverable. Error boundaries have to be class components; there is no hook equivalent.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Jomify crashed:', error, info?.componentStack);
    // A part of the app loaded on demand that belongs to the previous build: a new version went up
    // while this page was open, and its old files are gone. Loading the page again fetches the new
    // version. Once only, so a part that is really broken still lands on this screen.
    const msg = String(error?.message || error);
    if (/Importing a module script failed|Failed to fetch dynamically imported module|error loading dynamically imported module|ChunkLoadError/i.test(msg)) {
      try {
        const last = Number(sessionStorage.getItem('jomify_chunk_reload') || 0);
        if (Date.now() - last > 60000) {
          sessionStorage.setItem('jomify_chunk_reload', String(Date.now()));
          window.location.reload();
        }
      } catch { /* storage blocked: the screen below offers the reload */ }
    }
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 px-8 text-center" style={{ background: 'var(--room-ink)', color: 'var(--room-paper)', fontFamily: 'var(--font-room)' }}>
        <JomifyMark word size={36} className="mb-4" />
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em]">Something went wrong.</h1>
        <p className="room-mono max-w-md normal-case tracking-normal text-[var(--room-dim)] [overflow-wrap:anywhere]">
          {String(this.state.error?.message || this.state.error)}
        </p>
        <p className="max-w-md text-[13px] text-[var(--room-dim)]">
          Your folders and settings are safe -- they're stored separately from anything that could
          have broken here.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="ui-pill mt-4 min-h-[44px] px-6"
        >
          Reload Jomify
        </button>
      </div>
    );
  }
}
