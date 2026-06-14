import { Home, Library, Disc3 } from 'lucide-react';
import { useUserStore } from '../store/userStore';

export default function Sidebar() {
  const { currentView, setCurrentView, logout } = useUserStore();

  const navItems = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'browse', label: 'Browse', icon: Disc3 },
    { id: 'library', label: 'Your Library', icon: Library },
  ];

  return (
    <aside className="w-64 bg-black flex flex-col p-6 space-y-8">
      <div className="text-green-500 font-extrabold text-3xl tracking-tighter">
        Jomify
      </div>
      
      <nav className="flex flex-col space-y-4 font-semibold">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentView === item.id;
          
          return (
            <button
              key={item.id}
              onClick={() => setCurrentView(item.id)}
              className={`flex items-center space-x-4 transition-colors duration-200 text-left ${
                isActive ? 'text-white font-bold' : 'text-neutral-400 hover:text-white'
              }`}
            >
              <Icon className={`w-6 h-6 ${isActive ? 'text-green-500' : ''}`} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

    {/* Put this at the very bottom of the sidebar, replacing your "Built for pure audio" text */}
      <div className="mt-auto border-t border-neutral-800 pt-6 flex flex-col space-y-2 text-xs text-neutral-600">
        <p>Built for pure audio.</p>
        <button 
          onClick={() => {
            logout();
            window.location.href = "/";
          }}
          className="text-left hover:text-white transition-colors"
        >
          Disconnect Account
        </button>
      </div>
    </aside>
  );
}