import { Home, Search, Library, Users } from 'lucide-react';
import { useUserStore } from '../store/userStore';

// Views that live "under" the Library tab, so it stays lit while you're inside one
const LIBRARY_VIEWS = new Set(['library', 'playlist', 'album', 'artist', 'liked-songs']);

const TABS = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'browse', label: 'Search', icon: Search },
  { id: 'library', label: 'Library', icon: Library },
  { id: 'sevens', label: 'Sevens', icon: Users }
];

export default function BottomTabBar() {
  const currentView = useUserStore((s) => s.currentView);
  const setCurrentView = useUserStore((s) => s.setCurrentView);
  const setActiveFolderId = useUserStore((s) => s.setActiveFolderId);

  const isActive = (id) => currentView === id || (id === 'library' && LIBRARY_VIEWS.has(currentView));

  return (
    <nav
      aria-label="Main"
      className="shrink-0 bg-black/80 backdrop-blur-xl border-t border-white/5 pb-[env(safe-area-inset-bottom)] select-none"
    >
      <div className="flex items-stretch h-14">
        {TABS.map(({ id, label, icon: Icon }) => {
          const active = isActive(id);
          return (
            <button
              key={id}
              type="button"
              // Navigate first so the history frame captures the folder you were in, then leave it
              onClick={() => { setCurrentView(id); setActiveFolderId(null); }}
              aria-current={active ? 'page' : undefined}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors ${active ? 'text-white' : 'text-neutral-500 active:text-neutral-300'}`}
            >
              <Icon className={`w-6 h-6 ${active ? 'text-[var(--brand-mid)]' : ''}`} />
              {label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
