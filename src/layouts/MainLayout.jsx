import { useEffect, useState, lazy, Suspense } from 'react';
import Sidebar from './Sidebar';
import PlayerBar from './PlayerBar';
import QueuePanel from './QueuePanel';
import ContextMenu from '../components/ContextMenu';
import ToastHost from '../components/Toast';
import SyncConflictDialog from '../components/SyncConflictDialog';
import { ChevronLeft, AlertTriangle, CloudOff } from 'lucide-react';
import { useUserStore } from '../store/userStore';
import { useSyncStore } from '../store/syncStore';
import UpdatePrompt from '../pwa/registerServiceWorker';
import { useSlice } from '../store/selectors';

// Desktop-only and heavy; loaded the first time it is opened
const ZenMode = lazy(() => import('../views/ZenMode/ZenMode'));
import { shouldRegisterServiceWorker } from '../pwa/env';
import BottomTabBar from './BottomTabBar';
import MiniPlayer from './MiniPlayer';
import NowPlayingSheet from './NowPlayingSheet';
import DevicePicker from '../components/DevicePicker';
import { useIsMobile, useIsCoarsePointer } from '../hooks/useMediaQuery';
import { installLongPressContextMenu } from '../utils/longPressContextMenu';

const registerServiceWorker = shouldRegisterServiceWorker();

// Sync is allowed to be flaky for a while before it's worth interrupting anyone; the sidebar
// status line covers short blips. Past this, the user may believe folders are backing up when
// they aren't, which is the one thing sync must never let happen silently.
const SYNC_FAILURE_BANNER_AFTER_MS = 5 * 60 * 1000;

export default function MainLayout({ children }) {
  const { goBack, viewHistory, apiCooldownUntil, setApiCooldown, isZenMode } = useSlice(useUserStore, ['goBack', 'viewHistory', 'apiCooldownUntil', 'setApiCooldown', 'isZenMode']);
  const syncStatus = useSyncStore((s) => s.status);
  const syncFailingSince = useSyncStore((s) => s.failingSince);
  const syncErrorMessage = useSyncStore((s) => s.errorMessage);
  const isMobile = useIsMobile();
  const isCoarsePointer = useIsCoarsePointer();

  // Long-press opens the same menus right-click does; only touch screens need it
  useEffect(() => {
    if (!isCoarsePointer) return undefined;
    return installLongPressContextMenu();
  }, [isCoarsePointer]);

  // Time-based conditions below need a nudge to re-evaluate; nothing else in the store changes
  // just because a minute passed
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);

  const isCoolingDown = Boolean(apiCooldownUntil && apiCooldownUntil > now);

  // Clear the cooldown from the store when it lapses; the derived flag above follows
  useEffect(() => {
    if (!apiCooldownUntil || apiCooldownUntil <= Date.now()) return;
    const timeout = setTimeout(() => setApiCooldown(null), apiCooldownUntil - Date.now());
    return () => clearTimeout(timeout);
  }, [apiCooldownUntil, setApiCooldown]);

  const syncBroken =
    syncStatus === 'disabled' ||
    (syncStatus === 'error' && syncFailingSince && now - syncFailingSince > SYNC_FAILURE_BANNER_AFTER_MS);

  const canGoBack = viewHistory.length > 0;

  // Views with their own sticky sub-headers (Browse) need to know how tall this one is, so it
  // is published as a CSS variable instead of being hard-coded as a magic number over there.
  const bannerHeight = (isCoolingDown ? 44 : 0) + (syncBroken ? 44 : 0);
  const backBarHeight = canGoBack ? 64 : 0;

  return (
    <div className="flex flex-col h-dvh pt-[env(safe-area-inset-top)] bg-transparent overflow-hidden font-sans">
      <div className="flex-1 flex overflow-hidden">
        {/* Not mounted on phones: a hidden sidebar still built the folder tree and fetched every thumbnail */}
        {!isMobile && <Sidebar />}

        <main
          // Blur and a viewport-sized shadow on the element that scrolls cost a repaint per frame;
          // phones get neither, desktop keeps the frosted look
          className="flex-1 overflow-y-auto overscroll-y-contain [scrollbar-gutter:stable] md:backdrop-blur-sm md:rounded-lg md:my-2 md:mr-2 relative md:shadow-2xl flex flex-col"
          style={{ '--top-bar-h': `${bannerHeight + backBarHeight}px` }}
        >
          {/* One sticky header, so banners and the back button stack instead of all pinning to
              top:0 and covering each other. The back row only exists when there is somewhere
              to go back to. */}
          {(isCoolingDown || syncBroken || canGoBack) && (
            <div className="sticky top-0 z-30">
              {isCoolingDown && (
                <div className="bg-red-500/90 backdrop-blur-md text-white px-4 md:px-8 py-3 flex items-center justify-center space-x-3 text-sm font-medium shadow-lg animate-fade-in">
                  <AlertTriangle className="w-5 h-5" />
                  <span>Spotify API rate limit reached. Pausing network requests to cool down...</span>
                </div>
              )}

              {syncBroken && (
                <div className="bg-amber-500/90 backdrop-blur-md text-black px-4 md:px-8 py-3 flex items-center justify-center space-x-3 text-sm font-medium shadow-lg animate-fade-in">
                  <CloudOff className="w-5 h-5" />
                  <span>
                    Sync isn't reaching the server. Your folders are saved on this device but not backing up.
                    {syncErrorMessage ? ` (${syncErrorMessage})` : ''}
                  </span>
                </div>
              )}

              {canGoBack && (
                <div className="backdrop-blur-md px-4 md:px-8 py-4 flex items-center">
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

          <div className={`px-4 md:px-8 pb-4 ${canGoBack ? 'pt-2' : 'pt-6'}`}>
            {children}
          </div>
        </main>

        <QueuePanel />
      </div>

      {/* One or the other, never both: PlayerBar owns document keyboard shortcuts and its own
          progress tick, and the phone gets a strip plus tabs instead of the 96px bar */}
      {isMobile ? (
        <>
          <MiniPlayer />
          <BottomTabBar />
          <NowPlayingSheet />
        </>
      ) : (
        <PlayerBar />
      )}

      <DevicePicker />
      <ContextMenu />
      <ToastHost />
      <SyncConflictDialog />
      {isZenMode && <Suspense fallback={null}><ZenMode /></Suspense>}
      {registerServiceWorker && <UpdatePrompt />}
    </div>
  );
}
