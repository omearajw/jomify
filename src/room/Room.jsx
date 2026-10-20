import { Suspense, lazy, useEffect } from 'react';
import { useUserStore } from '../store/userStore';
import Rail from './Rail';
import Layer from './Layer';
import QueueColumn from './QueueColumn';
import UnaddedEngine from './UnaddedEngine';
import OpenThing from './OpenThing';
import { useRoomState, LISTS, OPEN_VIEWS } from './useRoomState';

const ZenMode = lazy(() => import('../views/ZenMode/ZenMode'));

// The room (DESIGN.md §4–5): the now-playing room is the app's base and resting state. It is
// Zen with its chrome on: the same stage, light and glass lyrics, with the queue column, the
// controls, the rail at the left edge and the layer that slides over it. Zen is this room with
// the chrome faded. Whatever the app is showing (the library, a playlist, a mode) lives inside
// the layer.

export default function Room({ children, header }) {
  const {
    currentView, setCurrentView, isZenMode, activePlaylistId, currentAlbumId, currentArtistId,
    isSeven, pileId, suggestionsAttempt, roomPlaylist, layer, setLayer, list, backFrame, nameOf, backOverride, pageSuffix,
    goBackInRoom, close, expand, more, less, open, lit, pick
  } = useRoomState();

  // A click on the room's own ground (not a control on it) puts the layer away: the thing you
  // want is already there, so touching it brings it forward. Escape does the same, and / opens
  // the layer with the search field ready, the first job of the library.
  const onRoomPointerDown = (e) => {
    if (layer === 'closed' || e.button !== 0) return;
    if (e.target.closest('button, input, a, [role="slider"], [role="button"], [data-control]')) return;
    close();
  };
  useEffect(() => {
    const typing = (el) => Boolean(el) && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
    // a menu or a dialog on top takes Escape for itself; the layer steps only when nothing is over it
    const covered = () => Boolean(document.querySelector('[role="menu"], [role="dialog"]'));
    const onKey = (e) => {
      if (e.key === 'ArrowLeft' && e.altKey && !typing(e.target)) { e.preventDefault(); e.stopPropagation(); goBackInRoom(); return; }
      if (e.key === 'Escape' && covered()) return;
      if (e.key === 'Escape' && !typing(e.target) && !document.fullscreenElement && !useUserStore.getState().isZenMode) less();
      if (e.key === 'Escape' && typing(e.target) && e.target.hasAttribute('data-room-search')) { e.target.blur(); less(); }
      // / opens the list of whatever you are in, at half, its first job ready; a second / pulls
      // it to full (the library's search field handles its own second /)
      if (e.key === '/' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !typing(e.target) && !covered()) {
        e.preventDefault();
        more();
        requestAnimationFrame(() => document.querySelector('[data-room-search]')?.focus());
      }
    };
    // capture phase: Zen's own Escape listener runs after this and turns Zen off, so a bubbling
    // listener would see Zen as already gone and take a second step
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [less, more, setCurrentView, goBackInRoom]);

  const active = layer === 'closed' ? null : lit;
  const List = LISTS[list];

  return (
    <div className="relative h-full w-full overflow-hidden bg-[var(--room-ink)] text-[var(--room-paper)]" style={{ fontFamily: 'var(--font-room)' }}>
      <div className="absolute inset-0" onPointerDown={onRoomPointerDown}>
        <Suspense fallback={null}>
          <ZenMode inRoom mode={isZenMode ? 'zen' : 'room'} roomLayout={layer === 'closed' ? 'rest' : layer} aside={<QueueColumn compact={layer === 'full'} scroll />} />
        </Suspense>
      </div>

      <Layer state={layer} onState={setLayer} header={header} head={{ back: backOverride ? { name: backOverride.name, go: goBackInRoom } : backFrame ? { name: nameOf(backFrame.frame), go: goBackInRoom } : null, here: OPEN_VIEWS.has(currentView) ? null : currentView === 'unadded' ? 'Unadded' : currentView === 'party' ? 'Party' : currentView === 'sevens' ? 'Sevens' : 'Library' }} pageKey={`${currentView}:${activePlaylistId || currentAlbumId || currentArtistId || ''}:${pageSuffix}`} tree={List ? <List onExpand={expand} onSlash={more} /> : null}><OpenThing currentView={currentView} isSeven={isSeven} roomPlaylist={roomPlaylist}>{children}</OpenThing></Layer>
      <Rail open={layer !== 'closed'} pinned={!isZenMode} active={active} onPick={pick} onOpen={open} />
      {currentView === 'unadded' && <UnaddedEngine key={suggestionsAttempt} pileId={pileId} />}
    </div>
  );
}
