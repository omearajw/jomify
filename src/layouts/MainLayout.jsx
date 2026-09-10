import { useEffect, useState } from 'react';
import Sidebar from './Sidebar';
import PlayerBar from './PlayerBar';
import QueuePanel from './QueuePanel';       
import ContextMenu from '../components/ContextMenu'; 
import { ChevronLeft, AlertTriangle } from 'lucide-react';
import { useUserStore } from '../store/userStore';
import ZenMode from '../views/ZenMode/ZenMode';

export default function MainLayout({ children }) {
  const { goBack, viewHistory, apiCooldownUntil, setApiCooldown } = useUserStore();
  const [isCoolingDown, setIsCoolingDown] = useState(false);

  // Countdown timer watcher
  useEffect(() => {
    if (apiCooldownUntil && apiCooldownUntil > Date.now()) {
      setIsCoolingDown(true);
      
      // Automatically dismiss the banner when the time is up
      const timeout = setTimeout(() => {
        setIsCoolingDown(false);
        setApiCooldown(null);
      }, apiCooldownUntil - Date.now());
      
      return () => clearTimeout(timeout);
    } else {
      setIsCoolingDown(false);
    }
  }, [apiCooldownUntil, setApiCooldown]);

  const canGoBack = viewHistory.length > 0;

  // Views with their own sticky sub-headers (Browse) need to know how tall this one is, so it
  // is published as a CSS variable instead of being hard-coded as a magic number over there.
  const bannerHeight = isCoolingDown ? 44 : 0;
  const backBarHeight = canGoBack ? 64 : 0;

  return (
    <div className="flex flex-col h-screen bg-transparent overflow-hidden font-sans">
      <div className="flex-1 flex overflow-hidden">
        <Sidebar />

        <main
          className="flex-1 overflow-y-auto [scrollbar-gutter:stable] backdrop-blur-sm rounded-lg my-2 mr-2 relative shadow-2xl flex flex-col"
          style={{ '--top-bar-h': `${bannerHeight + backBarHeight}px` }}
        >
          {/* One sticky header, so the rate-limit banner and the back button stack instead of
              both pinning to top:0 with the banner covering the button. The back row only exists
              when there is somewhere to go back to -- no more permanent 64px strip on Home. */}
          {(isCoolingDown || canGoBack) && (
            <div className="sticky top-0 z-30">
              {isCoolingDown && (
                <div className="bg-red-500/90 backdrop-blur-md text-white px-8 py-3 flex items-center justify-center space-x-3 text-sm font-medium shadow-lg animate-fade-in">
                  <AlertTriangle className="w-5 h-5" />
                  <span>Spotify API rate limit reached. Pausing network requests to cool down...</span>
                </div>
              )}

              {canGoBack && (
                <div className="backdrop-blur-md px-8 py-4 flex items-center">
                  <button
                    onClick={goBack}
                    aria-label="Go back"
                    className="w-8 h-8 flex items-center justify-center bg-black/50 text-white rounded-full hover:bg-black transition-all"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Main Content Area */}
          <div className={`px-8 pb-4 ${canGoBack ? 'pt-2' : 'pt-6'}`}>
            {children}
          </div>
        </main>

        {/* NEW: Drop the Queue Panel here so it sits next to the main content */}
        <QueuePanel />
      </div>

      <PlayerBar />
      
      {/* NEW: Drop the global Context Menu at the very bottom */}
      <ContextMenu />

      {/* NEW: Drops the massive z-100 overlay on top of the entire app */}
      <ZenMode />
    </div>
  );
}