import { useEffect, useState } from 'react';
import Sidebar from './Sidebar';
import PlayerBar from './PlayerBar';
import QueuePanel from './QueuePanel';       
import ContextMenu from '../components/ContextMenu'; 
import { ChevronLeft, AlertTriangle, Menu, X } from 'lucide-react';
import { useUserStore } from '../store/userStore';
import ZenMode from '../views/ZenMode/ZenMode';
import { motion, AnimatePresence } from 'framer-motion';

export default function MainLayout({ children }) {
  const { goBack, viewHistory, apiCooldownUntil, setApiCooldown } = useUserStore();
  const [isCoolingDown, setIsCoolingDown] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

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
    <div className="flex flex-col h-dvh bg-transparent overflow-hidden font-sans">
      <div className="flex-1 flex overflow-hidden">
        
        {/* Desktop Sidebar */}
        <div className="hidden md:block">
          <Sidebar />
        </div>

        {/* Mobile Sidebar Overlay */}
        <AnimatePresence>
          {isMobileSidebarOpen && (
            <div className="fixed inset-0 z-50 md:hidden flex">
              {/* Backdrop */}
              <motion.div 
                initial={{ opacity: 0 }} 
                animate={{ opacity: 1 }} 
                exit={{ opacity: 0 }} 
                className="absolute inset-0 bg-black/80 backdrop-blur-sm" 
                onClick={() => setIsMobileSidebarOpen(false)} 
              />
              
              {/* Sliding Sidebar */}
              <motion.div 
                initial={{ x: '-100%' }} 
                animate={{ x: 0 }} 
                exit={{ x: '-100%' }} 
                transition={{ type: 'spring', damping: 25, stiffness: 250 }}
                className="relative z-10 h-full shadow-2xl"
              >
                <Sidebar onClose={() => setIsMobileSidebarOpen(false)} />
                
                {/* Floating Close Button */}
                <button 
                  onClick={() => setIsMobileSidebarOpen(false)}
                  className="absolute top-4 -right-12 w-10 h-10 bg-black/50 backdrop-blur border border-white/10 rounded-full flex items-center justify-center text-white shadow-xl"
                >
                  <X className="w-5 h-5" />
                </button>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
        
        <main className="flex-1 overflow-y-auto [scrollbar-gutter:stable] backdrop-blur-sm m-0 md:my-2 md:mr-2 rounded-none md:rounded-lg relative shadow-2xl flex flex-col">
          
          {/* RATE LIMIT WARNING BANNER */}
          {isCoolingDown && (
            <div className="bg-red-500/90 backdrop-blur-md text-white px-4 md:px-8 py-3 flex items-center justify-center space-x-3 text-xs md:text-sm font-medium z-50 sticky top-0 shadow-lg animate-fade-in">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <span>Spotify API rate limit reached. Pausing network requests to cool down...</span>
            </div>
          )}

          {/* Sticky Top Navigation Bar */}
          <div className="sticky top-0 z-10 backdrop-blur-md px-4 md:px-8 py-3 md:py-4 flex items-center gap-3 bg-transparent">
            <button 
              onClick={() => setIsMobileSidebarOpen(true)}
              className="md:hidden w-8 h-8 flex items-center justify-center bg-black/50 text-white rounded-full hover:bg-black transition-all border border-white/5"
            >
              <Menu className="w-4 h-4" />
            </button>
            <button 
              onClick={goBack}
              disabled={viewHistory.length === 0}
              className="w-8 h-8 flex items-center justify-center bg-black/50 text-white rounded-full hover:bg-black disabled:opacity-30 transition-all border border-white/5"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          </div>
          
          {/* Main Content Area */}
          <div className="px-4 md:px-8 pb-4 pt-2">
            {children}
          </div>
        </main>

        <div className="hidden lg:block">
          <QueuePanel />
        </div>
      </div>

      <PlayerBar />
      
      <ContextMenu />
      <ZenMode />
    </div>
  );
}