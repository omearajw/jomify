import { Monitor } from 'lucide-react';
import { usePartyStore } from '../store/partyStore';
import { useUserStore } from '../store/userStore';
import { useSlice } from '../store/selectors';
import { partyLink, partyScreenLink } from '../party/client';
import { qrSvg } from '../party/view';

// The Party layer's left column (DESIGN.md §9): the party's facts, the ones you show people:
// the code and its QR, how many are in, the link, the wall screen. Beside the room with the music
// playing and the queue showing the request order, this is nearly the wall display with the
// room still there. The host's controls and the set-up are the open thing, at full.

export default function PartyColumn({ onExpand }) {
  const { code, guestCount, dormant } = useSlice(usePartyStore, ['code', 'guestCount', 'dormant']);
  const setCurrentView = useUserStore((s) => s.setCurrentView);
  const currentView = useUserStore((s) => s.currentView);
  const open = () => { if (currentView !== 'party') setCurrentView('party'); onExpand?.(); };

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ fontFamily: 'var(--font-room)' }}>
      <p className="room-mono flex justify-between border-b border-[var(--room-hair)] pb-3 text-[var(--room-dim)]">
        <span>Party</span>
        <button type="button" onClick={open} aria-current={currentView === 'party' ? 'page' : undefined} className={`ui-headword transition-colors ${currentView === 'party' ? 'text-[var(--room-paper)]' : 'text-[var(--room-faint)] hover:text-[var(--room-paper)]'}`}>{code ? 'Host' : 'Start'}</button>
      </p>
      {!code ? (
        <div className="pt-5">
          <p className="text-[13px] leading-relaxed text-[var(--room-dim)]">No party on. Guests join with a code from their phones, ask for songs and vote; the laptop plays them in a fair order.</p>
          <button type="button" onClick={open} className="mt-5 rounded-full bg-[var(--room-paper)] px-4 py-2 text-[13px] font-semibold text-[#0a0810]">Start a party</button>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto pt-5">
          {dormant && <p className="room-mono mb-4 text-[var(--room-faint)]">Left open from earlier</p>}
          <p className="room-mono text-[var(--room-faint)]">Join with</p>
          <p className="mt-1 font-mono text-[34px] font-semibold tracking-[0.28em] text-[var(--room-paper)]" style={{ fontFamily: 'var(--font-mono)' }}>{code}</p>
          <p className="room-mono mt-1 truncate text-[var(--room-dim)]">{partyLink(code).replace(/^https?:\/\//, '')}</p>
          <div className="mt-5 w-full rounded-[6px] bg-[var(--room-paper)] p-3">
            <div className="aspect-square w-full [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: qrSvg(partyLink(code)) }} />
          </div>
          <p className="room-mono mt-5 flex justify-between text-[var(--room-dim)]"><span>In the party</span><span>{guestCount}</span></p>
          <a href={partyScreenLink(code)} target="_blank" rel="noreferrer" className="room-mono mt-3 flex items-center gap-2 text-[var(--room-faint)] transition-colors hover:text-[var(--room-paper)]"><Monitor className="h-3.5 w-3.5" /> Wall screen</a>
          <button type="button" onClick={open} className="mt-6 rounded-full bg-[var(--room-paper)] px-4 py-2 text-[13px] font-semibold text-[#0a0810]">Requests and controls</button>
        </div>
      )}
    </div>
  );
}
