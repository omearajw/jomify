import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { motion, AnimatePresence, MotionConfig } from 'framer-motion';
import { useUserStore } from '../store/userStore';
import { usePartyStore } from '../store/partyStore';
import { useQueue, remove, move, clear, jumpTo } from '../queue/engine';
import { artUrl } from '../utils/images';
import { formatTime } from '../utils/formatTime';
import Artists from './Artists';
import { noteFlight } from './flight';

// The new queue (src/queue), as the room shows it: Next up (songs added by hand) and Then (the
// rest of what was pressed play on, in the order it will really play). Every row plays when
// tapped, can be dragged within its part, and comes out with ×; a song's menu has the rest
// (Play next, Remove from queue). One list, read from the queue itself, so it is always what plays.
//
// It moves (Jack, 19 Oct): a song arriving slides in and the rows below make room, a removed one
// folds away, a dragged or Play-next'd one glides to its place, and the song at the top, when it
// starts, hands its cover to the now-playing cover to fly into (flight.js). The parts are one flat
// list, so a song moving from Then to Next up travels rather than vanishing and reappearing. The
// rows are plain elements inside the animated ones, which keep the browser's own drag and drop.
// With the system's reduce-motion setting on, only the fades remain.

const EASE = [0.2, 0.75, 0.2, 1];
const MOVE = { duration: 0.5, ease: EASE };
const ENTER = { opacity: 0, y: -10 };
const SHOWN = { opacity: 1, y: 0 };
const LEAVE = { opacity: 0, scale: 0.96, transition: { duration: 0.3, ease: EASE } };

const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

// The whole queue scrolls (Jack, 20 Oct): its songs load 40 at a time as the end comes into view,
// so a 2,000-song playlist costs no more than a short one. `scroll`: the list is its own scroll
// area (the room's column); without it the page around it scrolls (the phone).
const STEP = 40;

export default function QueueList({ compact = false, maxRows = 3, scroll = false }) {
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
  const [limit, setLimit] = useState(STEP);
  const then = q.then.slice(0, compact ? Math.max(0, cap - next.length) : limit);
  const more = q.then.length - then.length;
  // more songs as the end of what is shown comes into view
  const box = useRef(null);
  const end = useRef(null);
  useEffect(() => {
    if (compact || more <= 0 || !end.current) return undefined;
    const seen = new IntersectionObserver((hits) => { if (hits.some((h) => h.isIntersecting)) setLimit((n) => n + STEP); }, { root: scroll ? box.current : null, rootMargin: '400px 0px' });
    seen.observe(end.current);
    return () => seen.disconnect();
  }, [compact, more, scroll, limit]);
  const fromName = q.source?.readOnly ? `${q.source.name || 'the playlist'}, as Spotify plays it` : q.source?.name || '';

  // the song that has just become the one playing: its cover, still on screen as it leaves, is
  // where the now-playing cover flies in from
  const covers = useRef(new Map());
  const nowKey = q.now?.key || null;
  useLayoutEffect(() => {
    if (!nowKey) return;
    const el = covers.current.get(nowKey);
    if (el) noteFlight(q.now, el);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowKey]);
  const coverRef = (key) => (el) => { if (el) covers.current.set(key, el); else covers.current.delete(key); };

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
      <motion.div key={e.key} layout="position" initial={i < 12 ? ENTER : false} animate={SHOWN} exit={LEAVE} transition={MOVE}>
      <div
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
          // the first rows step down; deeper ones (a scrolled queue) stay readable
          opacity: drag?.key === e.key ? 0.35 : part === 'then' ? 0.62 - Math.min(0.14, i * 0.035) : 1 - Math.min(0.4, i * 0.1)
        }}
      >
        {e.album?.images?.[0] ? <img ref={coverRef(e.key)} src={artUrl(e.album.images, 34)} alt="" width="34" height="34" loading="lazy" decoding="async" className="h-[34px] w-[34px] flex-none rounded-[4px] object-cover" draggable="false" /> : <span ref={coverRef(e.key)} className="h-[34px] w-[34px] flex-none rounded-[4px] bg-white/5" />}
        <div className="min-w-0 flex-1">
          <b className={`block truncate text-[var(--room-paper)] ${part === 'next' ? 'font-semibold' : 'font-medium'}`}>{e.name}</b>
          <Artists artists={e.artists} inRow className="block truncate text-[11px] text-[var(--room-dim)]" />
        </div>
        {!compact && part === 'next' && <span className="room-mono text-[var(--room-faint)]">{formatTime(e.duration_ms)}</span>}
        <button type="button" onClick={(ev) => { ev.stopPropagation(); remove(e.key); }} aria-label={`Remove ${e.name} from the queue`} className="grid h-6 w-6 flex-none place-items-center rounded-full text-[var(--room-faint)] opacity-0 transition-opacity hover:text-[var(--room-paper)] group-hover:opacity-100 pointer-coarse:opacity-100">
          <X className="h-3 w-3" />
        </button>
      </div>
      </motion.div>
    );
  };
  // a heading or a note in the flat list: it moves with the rows around it
  const line = (key, node) => <motion.div key={key} layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.2 } }} transition={MOVE}>{node}</motion.div>;

  if (partyCode) {
    const lined = q.next.filter((e) => e.request);
    const requests = [...lined.map((e) => ({ key: e.key, name: e.name, by: e.by, image: e.album?.images?.[0]?.url, lined: true })), ...(partyQueue || []).filter((r) => !lined.some((e) => e.request === r.id)).map((r) => ({ key: r.id, name: r.name, by: r.guestName, image: r.image, votes: r.votes }))];
    const shownRequests = compact ? requests.slice(0, cap) : requests.slice(0, 8);
    const rest = then.slice(0, compact ? Math.max(0, cap - shownRequests.length) : 4);
    return (
      <MotionConfig reducedMotion="user">
      <div className="relative min-w-0" data-control data-queue-list style={{ fontFamily: 'var(--font-room)' }}>
        <AnimatePresence initial={false} mode="popLayout">
        {line('h-requests', <p className="room-mono mb-4 flex justify-between text-[var(--room-dim)]"><span>Requests</span><span>{requests.length || ''}</span></p>)}
        {requests.length === 0 && line('none', <p className="text-[13px] text-[var(--room-faint)]">Nothing asked for yet.</p>)}
        {shownRequests.map((r, i) => (
          <motion.div key={r.key} layout="position" initial={ENTER} animate={SHOWN} exit={LEAVE} transition={MOVE}>
          <div className="flex min-w-0 items-center gap-3 py-2 text-[13px]" style={{ borderTop: i ? '1px solid var(--room-hair)' : 'none', opacity: 1 - Math.min(0.5, i * 0.12) }}>
            {r.image ? <img ref={coverRef(r.key)} src={r.image} alt="" width="34" height="34" className="h-[34px] w-[34px] flex-none rounded-[4px] object-cover" draggable="false" /> : <span className="h-[34px] w-[34px] flex-none rounded-[4px] bg-white/5" />}
            <div className="min-w-0 flex-1">
              <b className="block truncate font-semibold text-[var(--room-paper)]">{r.name}</b>
              <i className="block truncate text-[11px] not-italic text-[var(--room-dim)]">{r.lined ? 'next · ' : ''}{r.by}</i>
            </div>
            {r.votes > 0 && <span className="room-mono shrink-0 text-[var(--room-dim)]">▲ {r.votes}</span>}
          </div>
          </motion.div>
        ))}
        {rest.length > 0 && line('h-then', <p className="room-mono mb-1 mt-5 text-[var(--room-faint)]">Then{fromName ? ` · ${fromName}` : ''}</p>)}
        {rest.map((e, i) => row(e, i, 'then'))}
        </AnimatePresence>
      </div>
      </MotionConfig>
    );
  }

  const scrolling = scroll && !compact;
  return (
    <MotionConfig reducedMotion="user">
    <div ref={box} className={`relative min-w-0 ${scrolling ? 'custom-scrollbar -mr-3 overflow-y-auto overscroll-contain pr-3' : ''}`} data-control data-queue-list
      style={{ fontFamily: 'var(--font-room)', ...(scrolling ? { maxHeight: 'min(62vh, 640px)', maskImage: 'linear-gradient(to bottom, transparent 0, black 14px, black calc(100% - 36px), transparent)', WebkitMaskImage: 'linear-gradient(to bottom, transparent 0, black 14px, black calc(100% - 36px), transparent)', paddingTop: 6, paddingBottom: 30 } : {}) }}>
      <AnimatePresence initial={false} mode="popLayout">
      {(q.next.length > 0 || then.length === 0) && line('h-next', (
        <p className="room-mono mb-4 flex items-baseline justify-between gap-3 text-[var(--room-dim)]">
          <span>Up next</span>
          <span className="flex items-baseline gap-3">
            {q.next.length > 1 && <button type="button" onClick={clear} className="room-mono text-[var(--room-faint)] hover:text-[var(--room-paper)]">Clear</button>}
            <span>{q.next.length || ''}</span>
          </span>
        </p>
      ))}
      {q.next.length === 0 && then.length === 0 && line('none', <p className="text-[13px] text-[var(--room-faint)]">Nothing queued. Add songs from a song's menu.</p>)}
      {next.map((e, i) => row(e, i, 'next'))}
      {then.length > 0 && line('h-then', (
        <p className={`room-mono mb-1 ${q.next.length ? 'mt-5 text-[var(--room-faint)]' : 'mb-4 text-[var(--room-dim)]'}`}>{q.next.length ? 'Then' : 'Up next'}{fromName ? ` · ${fromName}` : ''}</p>
      ))}
      {then.map((e, i) => row(e, i, 'then'))}
      {!compact && more > 0 && line('more', <p ref={end} className="pt-2 text-[12px] text-[var(--room-faint)]">{more} more</p>)}
      </AnimatePresence>
    </div>
    </MotionConfig>
  );
}
