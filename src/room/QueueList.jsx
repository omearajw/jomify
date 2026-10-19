import { useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useUserStore } from '../store/userStore';
import { usePartyStore } from '../store/partyStore';
import { useQueue, remove, move, clear, jumpTo } from '../queue/engine';
import { artUrl } from '../utils/images';
import { formatTime } from '../utils/formatTime';
import Artists from './Artists';

// The new queue (src/queue), as the room shows it: Next up (songs added by hand) and Then (the
// rest of what was pressed play on, in the order it will really play). Every row plays when
// tapped, can be dragged within its part, and comes out with ×; a song's menu has the rest
// (Play next, Remove from queue). One list, read from the queue itself, so it is always what plays.

const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

export default function QueueList({ compact = false, maxRows = 3 }) {
  const q = useQueue((s) => s.q);
  const setContextMenu = useUserStore((s) => s.setContextMenu);
  // At a party the guests' requests are what plays next: the one lined up (already in the queue),
  // then the rest in the party's order. They are changed in the party view (pin, remove, block).
  const partyCode = usePartyStore((s) => s.code);
  const partyQueue = usePartyStore((s) => s.queue);
  // the row being dragged: a ref for the handlers (drag events can arrive before a re-render),
  // state for how the rows look
  const dragRef = useRef(null);              // { key, part }
  const [drag, setDragShown] = useState(null);
  const setDrag = (d) => { dragRef.current = d; setDragShown(d); };
  const [over, setOver] = useState(null);   // { part, index }
  const cap = Math.max(1, maxRows);
  const next = compact ? q.next.slice(0, cap) : q.next;
  const then = q.then.slice(0, compact ? Math.max(0, cap - next.length) : Math.max(4, 10 - q.next.length));
  const more = q.then.length - then.length;
  const fromName = q.source?.readOnly ? `${q.source.name || 'the playlist'}, as Spotify plays it` : q.source?.name || '';

  const openMenu = (e, entry, part) => {
    e.preventDefault();
    setContextMenu({ type: 'track', x: e.pageX, y: e.pageY, track: entry, queueKey: entry.key, queuePart: part });
  };
  const drop = (part, index) => {
    const d = dragRef.current;
    if (d && d.part === part) move(d.key, index);
    setDrag(null);
    setOver(null);
  };

  const row = (e, i, part) => {
    const lit = over && over.part === part && over.index === i && drag && drag.key !== e.key;
    return (
      <div
        key={e.key}
        draggable={!coarse}
        onDragStart={(ev) => { setDrag({ key: e.key, part }); try { ev.dataTransfer.effectAllowed = 'move'; } catch { /* a drag not started by the pointer */ } }}
        onDragOver={(ev) => { if (dragRef.current?.part !== part) return; ev.preventDefault(); if (over?.index !== i || over?.part !== part) setOver({ part, index: i }); }}
        onDrop={(ev) => { ev.preventDefault(); drop(part, i); }}
        onDragEnd={() => { setDrag(null); setOver(null); }}
        onContextMenu={(ev) => openMenu(ev, e, part)}
        onClick={() => jumpTo(e.key)}
        className="group flex min-w-0 cursor-pointer items-center gap-3 py-2 text-[13px]"
        style={{
          borderTop: i ? '1px solid var(--room-hair)' : 'none',
          boxShadow: lit ? 'inset 0 2px 0 var(--room-paper)' : 'none',
          opacity: drag?.key === e.key ? 0.35 : part === 'then' ? 0.6 - Math.min(0.3, i * 0.05) : 1 - Math.min(0.5, i * 0.12)
        }}
      >
        {e.album?.images?.[0] ? <img src={artUrl(e.album.images, 34)} alt="" width="34" height="34" loading="lazy" decoding="async" className="h-[34px] w-[34px] flex-none rounded-[4px] object-cover" draggable="false" /> : <span className="h-[34px] w-[34px] flex-none rounded-[4px] bg-white/5" />}
        <div className="min-w-0 flex-1">
          <b className={`block truncate text-[var(--room-paper)] ${part === 'next' ? 'font-semibold' : 'font-medium'}`}>{e.name}</b>
          <Artists artists={e.artists} inRow className="block truncate text-[11px] text-[var(--room-dim)]" />
        </div>
        {!compact && part === 'next' && <span className="room-mono text-[var(--room-faint)]">{formatTime(e.duration_ms)}</span>}
        <button type="button" onClick={(ev) => { ev.stopPropagation(); remove(e.key); }} aria-label={`Remove ${e.name} from the queue`} className="grid h-6 w-6 flex-none place-items-center rounded-full text-[var(--room-faint)] opacity-0 transition-opacity hover:text-[var(--room-paper)] group-hover:opacity-100 pointer-coarse:opacity-100">
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  };

  if (partyCode) {
    const lined = q.next.filter((e) => e.request);
    const requests = [...lined.map((e) => ({ key: e.key, name: e.name, by: e.by, image: e.album?.images?.[0]?.url, lined: true })), ...(partyQueue || []).filter((r) => !lined.some((e) => e.request === r.id)).map((r) => ({ key: r.id, name: r.name, by: r.guestName, image: r.image, votes: r.votes }))];
    const shownRequests = compact ? requests.slice(0, cap) : requests.slice(0, 8);
    const rest = then.slice(0, compact ? Math.max(0, cap - shownRequests.length) : 4);
    return (
      <div className="min-w-0" data-control data-queue-list style={{ fontFamily: 'var(--font-room)' }}>
        <p className="room-mono mb-4 flex justify-between text-[var(--room-dim)]"><span>Requests</span><span>{requests.length || ''}</span></p>
        {requests.length === 0 && <p className="text-[13px] text-[var(--room-faint)]">Nothing asked for yet.</p>}
        {shownRequests.map((r, i) => (
          <div key={r.key} className="flex min-w-0 items-center gap-3 py-2 text-[13px]" style={{ borderTop: i ? '1px solid var(--room-hair)' : 'none', opacity: 1 - Math.min(0.5, i * 0.12) }}>
            {r.image ? <img src={r.image} alt="" width="34" height="34" className="h-[34px] w-[34px] flex-none rounded-[4px] object-cover" draggable="false" /> : <span className="h-[34px] w-[34px] flex-none rounded-[4px] bg-white/5" />}
            <div className="min-w-0 flex-1">
              <b className="block truncate font-semibold text-[var(--room-paper)]">{r.name}</b>
              <i className="block truncate text-[11px] not-italic text-[var(--room-dim)]">{r.lined ? 'next · ' : ''}{r.by}</i>
            </div>
            {r.votes > 0 && <span className="room-mono shrink-0 text-[var(--room-dim)]">▲ {r.votes}</span>}
          </div>
        ))}
        {rest.length > 0 && <p className="room-mono mb-1 mt-5 text-[var(--room-faint)]">Then{fromName ? ` · ${fromName}` : ''}</p>}
        {rest.map((e, i) => row(e, i, 'then'))}
      </div>
    );
  }

  return (
    <div className="min-w-0" data-control data-queue-list style={{ fontFamily: 'var(--font-room)' }}>
      {(q.next.length > 0 || then.length === 0) && (
        <p className="room-mono mb-4 flex items-baseline justify-between gap-3 text-[var(--room-dim)]">
          <span>Up next</span>
          <span className="flex items-baseline gap-3">
            {q.next.length > 1 && <button type="button" onClick={clear} className="room-mono text-[var(--room-faint)] hover:text-[var(--room-paper)]">Clear</button>}
            <span>{q.next.length || ''}</span>
          </span>
        </p>
      )}
      {q.next.length === 0 && then.length === 0 && <p className="text-[13px] text-[var(--room-faint)]">Nothing queued. Add songs from a song's menu.</p>}
      {next.map((e, i) => row(e, i, 'next'))}
      {then.length > 0 && (
        <p className={`room-mono mb-1 ${q.next.length ? 'mt-5 text-[var(--room-faint)]' : 'mb-4 text-[var(--room-dim)]'}`}>{q.next.length ? 'Then' : 'Up next'}{fromName ? ` · ${fromName}` : ''}</p>
      )}
      {then.map((e, i) => row(e, i, 'then'))}
      {!compact && more > 0 && <p className="pt-2 text-[12px] text-[var(--room-faint)]">and {more} more</p>}
    </div>
  );
}
