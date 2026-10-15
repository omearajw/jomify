import Tooltips from '../components/Tooltips';
import { useEffect, useState, lazy, Suspense } from 'react';
import Sidebar from './Sidebar';
import PlayerBar from './PlayerBar';
import QueuePanel from './QueuePanel';
import ContextMenu from '../components/ContextMenu';
import ToastHost from '../components/Toast';
import SyncConflictDialog from '../components/SyncConflictDialog';
import ShortcutsHelp from '../components/ShortcutsHelp';
import { ChevronLeft, AlertTriangle, CloudOff, WifiOff, PartyPopper } from 'lucide-react';
import { usePartyStore } from '../store/partyStore';
import { endParty, rejoinParty } from '../party/conductor';
import { useUserStore } from '../store/userStore';
import { useSyncStore } from '../store/syncStore';
import UpdatePrompt from '../pwa/registerServiceWorker';
import { useSlice } from '../store/selectors';

// Desktop-only and heavy; loaded the first time it is opened
const ZenMode = lazy(() => import('../views/ZenMode/ZenMode'));
const Room = lazy(() => import('../room/Room'));
const PhoneRoom = lazy(() => import('../room/phone/PhoneRoom'));
import { shouldRegisterServiceWorker } from '../pwa/env';
import BottomTabBar from './BottomTabBar';
import MiniPlayer from './MiniPlayer';
import NowPlayingSheet from './NowPlayingSheet';
import DevicePicker from '../components/DevicePicker';
import AccountSheet from './AccountSheet';
import { useIsMobile, useIsCoarsePointer } from '../hooks/useMediaQuery';
import { installLongPressContextMenu } from '../utils/longPressContextMenu';
import { installTouchDrag } from '../utils/touchDrag';

const registerServiceWorker = shouldRegisterServiceWorker();

// Sync is allowed to be flaky for a while before it's worth interrupting anyone; the sidebar
// status line covers short blips. Past this, the user may believe folders are backing up when
// they aren't, which is the one thing sync must never let happen silently.
const SYNC_FAILURE_BANNER_AFTER_MS = 5 * 60 * 1000;

export default function MainLayout({ children }) {
  const { goBack, viewHistory, apiCooldownUntil, setApiCooldown, isZenMode, playbackSettings } = useSlice(useUserStore, ['goBack', 'viewHistory', 'apiCooldownUntil', 'setApiCooldown', 'isZenMode', 'playbackSettings']);
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

  // and every drag in the room starts from a held finger (utils/touchDrag.js)
  useEffect(() => {
    if (!isCoarsePointer) return undefined;
    return installTouchDrag();
  }, [isCoarsePointer]);

  // Ctrl/Cmd+K jumps to Search from any page; the Search page itself focuses the box
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        useUserStore.getState().requestSearchFocus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Time-based conditions below need a nudge to re-evaluate; nothing else in the store changes
  // just because a minute passed
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);

  const isCoolingDown = Boolean(apiCooldownUntil && apiCooldownUntil > now);

  // No connection: the shelves still show from the cache, playback can't
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false);
  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

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
  // A party left open from another night: not running, but worth a word
  const dormantParty = usePartyStore((s) => (s.dormant ? s.code : null));
  const bannerHeight = (isCoolingDown ? 44 : 0) + (syncBroken ? 44 : 0) + (offline ? 44 : 0) + (dormantParty ? 44 : 0);
  const backBarHeight = canGoBack ? 64 : 0;

  // `withBack` is the old layout's corner arrow; the room has its own Back, in the open thing's head
  const headerFor = (withBack) => (
    <>
          {(isCoolingDown || syncBroken || (withBack && canGoBack) || offline || dormantParty) && (
            <div className="sticky top-0 z-30">
              {dormantParty && (
                <div className="bg-neutral-900/95 backdrop-blur-md text-white px-4 md:px-8 py-2.5 flex items-center justify-center gap-3 text-sm font-medium shadow-lg animate-fade-in">
                  <PartyPopper className="w-5 h-5 text-[var(--brand-mid)] shrink-0" />
                  <span className="min-w-0 truncate">Party {dormantParty} is still open from earlier.</span>
                  <button type="button" onClick={() => { rejoinParty(); useUserStore.getState().setCurrentView('party'); }} className="rounded-full bg-white/10 hover:bg-white/15 px-3 py-1 text-xs font-bold">Resume</button>
                  <button type="button" onClick={() => endParty()} className="rounded-full border border-white/15 hover:bg-white/10 px-3 py-1 text-xs font-bold">End it</button>
                </div>
              )}
              {offline && (
                <div className="bg-neutral-800/95 backdrop-blur-md text-white px-4 md:px-8 py-3 flex items-center justify-center space-x-3 text-sm font-medium shadow-lg animate-fade-in">
                  <WifiOff className="w-5 h-5 text-neutral-400" />
                  <span>No connection. Your library is shown as it was last seen; playback needs Spotify.</span>
                </div>
              )}
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

              {withBack && canGoBack && (
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
    </>
  );
  const header = headerFor(true);

  // The room (DESIGN.md): the now-playing room is the base and the app's views live in a layer
  // over it. Behind a setting while it is lived with; Mac only for now.
  // The contrast mode follows the OS "more contrast" switch unless set by hand. No text size of
  // our own: Jack's dad scales the whole system, so the app has to hold up under that instead.
  const contrast = playbackSettings?.contrast || 'auto';
  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia('(prefers-contrast: more)');
    const apply = () => {
      const high = contrast === 'high' || (contrast === 'auto' && mq.matches);
      if (high) root.setAttribute('data-contrast', 'high'); else root.removeAttribute('data-contrast');
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [contrast]);
  // The room: on the Mac a panel beside the rail, on the phone a sheet from the bottom (DESIGN.md §5).
  // Behind the Layout setting on both until it is the default.
  // the room is the default since 15 Oct; 'off' is only ever a choice someone made in Settings
  const newLayout = (playbackSettings?.newLayout ?? 'on') === 'on';
  if (newLayout && isMobile) {
    return (
      <div className="relative h-dvh overflow-hidden">
        <Suspense fallback={null}><PhoneRoom>{children}</PhoneRoom></Suspense>
        <DevicePicker />
        <AccountSheet />
        <ContextMenu />
        <ToastHost />
        <SyncConflictDialog />
        {registerServiceWorker && <UpdatePrompt />}
      </div>
    );
  }
  if (newLayout) {
    return (
      <div className="relative h-dvh overflow-hidden pt-[env(safe-area-inset-top)]">
        <Suspense fallback={null}><Room header={headerFor(false)}>{children}</Room></Suspense>
        <PlayerBar hidden />
        <DevicePicker />
        <AccountSheet />
        <ContextMenu />
        <ToastHost />
        <Tooltips />
        <SyncConflictDialog />
        <ShortcutsHelp />
        {registerServiceWorker && <UpdatePrompt />}
      </div>
    );
  }

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
          {header}

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
      <AccountSheet />
      <ContextMenu />
      <ToastHost />
        <Tooltips />
      <SyncConflictDialog />
      <ShortcutsHelp />
      {isZenMode && <Suspense fallback={null}><ZenMode /></Suspense>}
      {registerServiceWorker && <UpdatePrompt />}
    </div>
  );
}
