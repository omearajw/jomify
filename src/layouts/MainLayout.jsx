import Sidebar from './Sidebar';
import PlayerBar from './PlayerBar';
import { ChevronLeft } from 'lucide-react';
import { useUserStore } from '../store/userStore';

export default function MainLayout({ children }) {
  const { goBack, viewHistory } = useUserStore();

  return (
    <div className="flex flex-col h-screen bg-black overflow-hidden font-sans">
      <div className="flex-1 flex overflow-hidden">
        <Sidebar />
        
        <main className="flex-1 overflow-y-auto bg-neutral-900 rounded-lg my-2 mr-2 relative shadow-2xl">
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
      </div>

      <PlayerBar />
    </div>
  );
}