import { Component } from 'react';

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
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex flex-col items-center justify-center h-screen bg-black text-white gap-4 px-8 text-center">
        <p className="text-2xl font-extrabold tracking-tight">Something went wrong.</p>
        <p className="text-neutral-400 max-w-md text-sm">
          {String(this.state.error?.message || this.state.error)}
        </p>
        <p className="text-neutral-500 text-xs max-w-md">
          Your folders and settings are safe -- they're stored separately from anything that could
          have broken here.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-2 px-6 py-2.5 rounded-full bg-brand-gradient text-white font-bold shadow-brand-glow hover:scale-105 transition-transform"
        >
          Reload Jomify
        </button>
      </div>
    );
  }
}
