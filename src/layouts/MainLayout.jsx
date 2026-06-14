import { useEffect, useState } from 'react';
import Sidebar from './Sidebar';
import PlayerBar from './PlayerBar';
import QueuePanel from './QueuePanel';       
import ContextMenu from '../components/ContextMenu'; 
import { ChevronLeft, AlertTriangle } from 'lucide-react';
import { useUserStore } from '../store/userStore';

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

  return (
    <div className="flex flex-col h-screen bg-black overflow-hidden font-sans">
      <div className="flex-1 flex overflow-hidden">
        <Sidebar />
        
        <main className="flex-1 overflow-y-auto bg-neutral-900 rounded-lg my-2 mr-2 relative shadow-2xl flex flex-col">
          
          {/* RATE LIMIT WARNING BANNER */}
          {isCoolingDown && (
            <div className="bg-red-500/90 backdrop-blur-md text-white px-8 py-3 flex items-center justify-center space-x-3 text-sm font-medium z-50 sticky top-0 shadow-lg animate-fade-in">
              <AlertTriangle className="w-5 h-5" />
              <span>Spotify API rate limit reached. Pausing network requests to cool down...</span>
            </div>
          )}

          {/* Sticky Top Navigation Bar */}
          <div className="sticky top-0 z-10 bg-neutral-900/90 backdrop-blur-md px-8 py-4 flex items-center">
            <button 
              onClick={goBack}
              disabled={viewHistory.length === 0}
              className="w-8 h-8 flex items-center justify-center bg-black/50 text-white rounded-full hover:bg-black disabled:opacity-30 transition-all"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          </div>
          
          {/* Main Content Area */}
          <div className="px-8 pb-8 pt-2">
            {children}
          </div>
        </main>

        {/* NEW: Drop the Queue Panel here so it sits next to the main content */}
        <QueuePanel />
      </div>

      <PlayerBar />
      
      {/* NEW: Drop the global Context Menu at the very bottom */}
      <ContextMenu />
    </div>
  );
}