import { useCallback, useState } from 'react';
import { X } from 'lucide-react';
import { useRoomStore } from '../roomStore';
import { useRoomState, LISTS, OPEN_VIEWS, PAGE_VIEWS, MODE_VIEWS } from '../useRoomState';
import OpenThing from '../OpenThing';
import UnaddedEngine from '../UnaddedEngine';
import PhoneNowPlaying from './PhoneNowPlaying';
import PhoneUnadded from './PhoneUnadded';
import PhoneSheet from './PhoneSheet';
import PhoneMiniPlayer from './PhoneMiniPlayer';

// The room on a phone (DESIGN.md §5): the playing room underneath, the sheet over it. The state is
// the Mac room's own (useRoomState): the same lists, stops, Back and launcher picks. One column:
// at half the sheet is the list; an open thing takes it to full and stands over the list, with Back
// in its head (the system's back gesture walks the same history).

export default function PhoneRoom({ children }) {
  const {
    currentView, isSeven, pileId, suggestionsAttempt, roomPlaylist, layer, setLayer, list,
    backFrame, nameOf, backOverride, goBackInRoom, expand, less, lit, pick
  } = useRoomState({ phone: true });
  const [closedH, setClosedH] = useState(76);
  const onHeadHeight = useCallback((h) => setClosedH(h), []);
  // the player bar beneath the raised sheet moves with it
  const [lift, setLift] = useState({ to: 0, dragging: false });
  const onLift = useCallback((to, dragging) => setLift((was) => (was.to === to && was.dragging === dragging ? was : { to, dragging })), []);
  const List = LISTS[list];

  // what the sheet shows at full: the open thing (a playlist, search, a mode, a list's own page),
  // else the list
  // Unadded is a screen of its own under the sheet (PhoneUnadded); raised, the sheet shows its pile
  const unadded = currentView === 'unadded';
  const opensThing = isSeven || OPEN_VIEWS.has(currentView) || (MODE_VIEWS.has(currentView) && !unadded) || PAGE_VIEWS.has(currentView);
  const showThing = layer === 'full' && opensThing;
  const back = backOverride ? { name: backOverride.name, go: goBackInRoom } : backFrame ? { name: nameOf(backFrame.frame), go: goBackInRoom } : null;
  const listName = { library: 'Library', sevens: 'Sevens', party: 'Party', unadded: 'Unadded' }[list] || 'Library';
  // Search on the Mac uses the library list's field beside the results; here the results fill the
  // sheet, so the field sits in its head (the same words, in the room's store)
  const searchQuery = useRoomStore((s) => s.searchQuery);
  const setSearchQuery = useRoomStore((s) => s.setSearchQuery);
  const head = showThing ? (
    <div className="flex shrink-0 items-center justify-between border-b border-[var(--room-hair)] px-5 pb-1">
      <button type="button" onClick={back ? back.go : less} className="ui-word inline-flex min-h-[44px] max-w-[70%] shrink-0 items-center truncate">← {back ? back.name : listName}</button>
      {currentView === 'browse' && (
        <label className="ml-4 flex min-w-0 flex-1 items-center gap-2 border-b border-[var(--room-hair)]">
          <input type="search" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} data-room-search enterKeyHint="search" autoCapitalize="none" autoCorrect="off" spellCheck={false}
            placeholder="Songs, artists, albums" aria-label="Search Spotify"
            className="min-w-0 flex-1 bg-transparent py-2 text-[16px] text-[var(--room-paper)] outline-none placeholder:text-[var(--room-faint)] [&::-webkit-search-cancel-button]:hidden" style={{ WebkitUserSelect: 'text', userSelect: 'text' }} />
          {searchQuery && <button type="button" onClick={() => setSearchQuery('')} aria-label="Clear" className="grid h-11 w-8 place-items-center text-[var(--room-faint)]"><X className="h-4 w-4" /></button>}
        </label>
      )}
    </div>
  ) : back && layer !== 'closed' ? (
    // over a list too, when there is somewhere to go back to (the Mac's layer has it on every page)
    <div className="flex shrink-0 items-center border-b border-[var(--room-hair)] px-5 pb-1">
      <button type="button" onClick={back.go} className="ui-word inline-flex min-h-[44px] max-w-[70%] shrink-0 items-center truncate">← {back.name}</button>
    </div>
  ) : null;

  return (
    <div className="fixed inset-0 overflow-hidden" style={{ background: 'var(--room-ink)' }}>
      {unadded ? <PhoneUnadded bottomInset={closedH} /> : <PhoneNowPlaying bottomInset={closedH + 12} />}
      <PhoneSheet state={layer} onState={setLayer} lit={lit} litAtRest={unadded ? 'unadded' : null} onPick={pick} onProfile={() => pick('profile')} head={head} onHeadHeight={onHeadHeight} onLift={onLift}>
        {showThing
          ? <OpenThing currentView={currentView} isSeven={isSeven} roomPlaylist={roomPlaylist}>{children}</OpenThing>
          : List ? <List onExpand={unadded ? () => setLayer('closed') : expand} /> : null}
      </PhoneSheet>
      <PhoneMiniPlayer lift={lift.to} dragging={lift.dragging} onOpen={() => setLayer('closed')} />
      {currentView === 'unadded' && <UnaddedEngine key={suggestionsAttempt} pileId={pileId} />}
    </div>
  );
}
