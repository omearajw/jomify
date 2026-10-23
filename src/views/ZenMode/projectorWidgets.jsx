import { useEffect, useState } from 'react';
import { useUserStore } from '../../store/userStore';
import { usePartyStore } from '../../store/partyStore';
import { useProgress } from '../../hooks/useProgress';
import { fetchQueue } from '../../services/spotify/api';
import { findLyrics, LYRIC_LEAD_IN_MS } from '../../lib/lrc';
import { formatTime } from '../../utils/formatTime';
import { fitFontSize } from '../../utils/fitText';
import { isProjectorWindow, requestQueue } from './projectorBridge';
import { partyLink } from '../../party/client';
import { useQueue, upcomingSongs } from '../../queue/engine';
import { qrSvg, requestedBy } from '../../party/view';

// What the projector draws, in the room's language: one typeface, white on black, nothing thin.
// A projector is dim and soft, so everything here is sized for reading across a room: text is
// sized from the asset's box and never shrunk below a readable floor to squeeze more in; a list
// shows fewer rows rather than smaller ones, and long names are cut, not shrunk.

const FONT = 'var(--font-room)';
const px = (box) => ({ left: box.left, top: box.top, width: box.width, height: box.height });
const names = (artists) => (artists || []).map((a) => a.name).join(', ');

export function Placeholder({ box, label }) {
  return (
    <div className="absolute flex items-center justify-center text-center text-white/45" style={{ ...px(box), fontFamily: FONT, fontSize: Math.max(11, Math.min(box.height * 0.14, box.width * 0.07)), outline: '1px dashed rgba(255,255,255,0.3)', outlineOffset: -1 }}>
      {label}
    </div>
  );
}

function ArtWidget({ track, box }) {
  const url = track?.album?.images?.[0]?.url;
  if (!url) return <Placeholder box={box} label="Album art" />;
  return <img src={url} alt="" draggable="false" className="absolute object-cover" style={{ ...px(box), borderRadius: box.width * 0.02 }} />;
}

// The song and who it is by. The album is gone: on a wall it was clutter nobody could read.
function TitleWidget({ track, box, options }) {
  const align = options?.align || 'left';
  const name = track?.name || 'Song title';
  const artists = track ? names(track.artists) : 'Artist';
  const titleSize = fitFontSize(name, box.width, box.height * 0.64, 2, { charWidth: 0.52, lineHeight: 1.02 });
  const artistSize = Math.min(titleSize * 0.5, fitFontSize(artists, box.width, box.height * 0.24, 1, { charWidth: 0.5 }));
  return (
    <div className="absolute flex flex-col justify-center text-white" style={{ ...px(box), fontFamily: FONT, textAlign: align, alignItems: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center' }}>
      <p className="w-full font-semibold leading-[1.02] tracking-[-0.03em] [text-wrap:balance]" style={{ fontSize: titleSize, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{name}</p>
      <p className="w-full truncate font-medium tracking-[-0.01em] text-white/65" style={{ fontSize: artistSize, marginTop: titleSize * 0.22 }}>{artists}</p>
    </div>
  );
}

// The bar, and the times under it if wanted. The times are sized from the bar's length, so they
// read the same at any height of box.
function ProgressWidget({ box, options }) {
  const { position, duration } = useProgress();
  const pct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;
  const numbers = options?.numbers !== false;
  // the times from the bar's length, but never taller than the box allows
  const font = Math.max(12, Math.min(box.width * 0.042, box.height * 0.42));
  const bar = Math.max(4, numbers ? Math.min(box.height * 0.16, font * 0.4) : box.height * 0.5);
  return (
    <div className="absolute flex flex-col justify-center text-white" style={{ ...px(box), fontFamily: FONT }}>
      <div className="w-full overflow-hidden rounded-full bg-white/20" style={{ height: bar }}>
        <div className="h-full rounded-full bg-white" style={{ width: `${pct}%`, transition: 'width 1s linear' }} />
      </div>
      {numbers && (
        <div className="flex justify-between font-semibold tabular-nums text-white/80" style={{ fontSize: font, marginTop: font * 0.35, lineHeight: 1 }}>
          <span>{formatTime(position)}</span>
          <span>{duration ? `-${formatTime(Math.max(0, duration - position))}` : '0:00'}</span>
        </div>
      )}
    </div>
  );
}

const lyricCache = new Map(); // track id -> { synced, plain } | 'none'

// The lines roll: each line keeps its element as it moves from below, to the middle, to above,
// so the change is a movement (slide, grow, brighten) rather than text swapping in place.
function LyricsWidget({ track, box }) {
  const { position, duration } = useProgress();
  const trackId = track?.id;
  const [, setLoaded] = useState(0);
  useEffect(() => {
    if (!trackId || lyricCache.has(trackId)) return undefined;
    let cancelled = false;
    findLyrics(track, duration ? duration / 1000 : null)
      .then((found) => { lyricCache.set(trackId, found); })
      .catch(() => { lyricCache.set(trackId, 'none'); })
      .finally(() => { if (!cancelled) setLoaded((n) => n + 1); });
    return () => { cancelled = true; };
    // Keyed on the track, not its duration ticks
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId]);

  if (!track) return <Placeholder box={box} label="Lyrics" />;
  const found = trackId ? lyricCache.get(trackId) : null;
  const synced = found && found !== 'none' ? found.synced : null;
  if (!synced?.length) {
    const why = found === undefined ? '' : found === 'none' || !found?.plain?.length ? 'No lyrics for this one' : "These lyrics aren't timed";
    return <div className="absolute flex items-center justify-center text-white/35" style={{ ...px(box), fontFamily: FONT, fontSize: box.height * 0.08 }}>{why}</div>;
  }
  const idx = synced.findLastIndex((l) => l.timeMs <= position + LYRIC_LEAD_IN_MS);
  const text = (k) => synced[k]?.text?.trim() || '♪';
  const main = fitFontSize(text(Math.max(0, idx)), box.width * 0.96, box.height * 0.42, 2, { charWidth: 0.52, lineHeight: 1.08 });
  // Every line is set at the main size and scaled, so it wraps as it would in the middle; its
  // height on the wall is its wrapped lines at its scale. Lines stack edge to edge from the
  // middle out, so a two-line lyric pushes its neighbours away instead of sitting under them.
  const perLine = Math.max(1, Math.floor((box.width * 0.96) / (main * 0.52)));
  const scaleOf = (d) => (d === 0 ? 1 : 0.6);
  const heightOf = (k, d) => Math.min(2, Math.ceil(text(k).length / perLine)) * main * 1.08 * scaleOf(d);
  const space = main * 0.32;
  const offsetOf = (k) => {
    const d = k - idx;
    if (d === 0) return 0;
    const dir = Math.sign(d);
    let y = heightOf(idx, 0) / 2;
    for (let j = idx + dir; j !== k; j += dir) y += space + heightOf(j, j - idx);
    return dir * (y + space + heightOf(k, d) / 2);
  };
  const shown = [];
  for (let k = Math.max(0, idx - 2); k <= Math.min(synced.length - 1, idx + 2); k++) shown.push(k);
  return (
    <div className="absolute overflow-hidden text-center text-white" style={{ ...px(box), fontFamily: FONT }}>
      {shown.map((k) => {
        const d = k - idx;
        const far = Math.abs(d);
        return (
          <p
            key={k}
            className="absolute left-0 right-0 font-semibold leading-[1.08] tracking-[-0.02em] [text-wrap:balance]"
            style={{
              top: '50%',
              fontSize: main,
              transform: `translateY(calc(-50% + ${offsetOf(k)}px)) scale(${scaleOf(d)})`,
              opacity: d === 0 ? 1 : far === 1 ? 0.32 : 0,
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
              transition: 'transform 700ms cubic-bezier(0.2, 0.75, 0.2, 1), opacity 700ms ease',
              padding: `0 ${box.width * 0.02}px`
            }}
          >
            {text(k)}
          </p>
        );
      })}
    </div>
  );
}

function ClockWidget({ box }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="absolute flex items-center justify-center font-semibold tabular-nums tracking-[-0.03em] text-white" style={{ ...px(box), fontFamily: FONT, fontSize: Math.min(box.height * 0.75, box.width * 0.34) }}>
      {now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
    </div>
  );
}

// A list on a wall: as many rows as fit at a readable size, never more. `rows` are
// { title, sub }; the first is the next to play and is the brightest.
function WallList({ box, heading, rows, empty }) {
  const floor = box.width * 0.055;                     // the smallest a row's title may be
  const fit = Math.max(1, Math.floor((box.height / floor - 1.2) / 2.05));
  const count = Math.min(rows.length, fit, 5);
  const font = Math.max(floor, Math.min(box.height / ((Math.max(1, count) * 2.05) + 1.2), box.width * 0.085));
  return (
    <div className="absolute flex flex-col justify-center text-white" style={{ ...px(box), fontFamily: FONT }}>
      <p className="font-semibold uppercase text-white/50" style={{ fontSize: font * 0.5, letterSpacing: '0.18em', marginBottom: font * 0.45 }}>{heading}</p>
      {rows.length === 0 ? (
        <p className="font-semibold text-white/55" style={{ fontSize: font * 0.8 }}>{empty}</p>
      ) : rows.slice(0, count).map((r, n) => (
        <div key={r.key} style={{ marginTop: n ? font * 0.45 : 0, opacity: n === 0 ? 1 : 0.72 }}>
          <p className="truncate font-semibold leading-[1.1] tracking-[-0.02em]" style={{ fontSize: font }}>{r.title}</p>
          {r.sub && <p className="truncate font-medium leading-[1.15] text-white/60" style={{ fontSize: font * 0.62 }}>{r.sub}</p>}
        </div>
      ))}
    </div>
  );
}

function NextWidget({ track, box }) {
  const token = useUserStore((s) => s.token);
  // the new queue changes without a song change (an edit); follow it
  const queueRev = useQueue((s) => s.q);
  const [upNext, setUpNext] = useState([]);
  const trackId = track?.id;
  useEffect(() => {
    if (!token) return undefined;
    let cancelled = false;
    // the projector's own window asks the main window, which holds the sign-in
    const load = () => (isProjectorWindow()
      ? requestQueue().then((q) => { if (!cancelled && q) setUpNext(q.slice(0, 5)); })
      : upcomingSongs(5) ? Promise.resolve(setUpNext(upcomingSongs(5)))
      : fetchQueue(token)
        .then((data) => { if (!cancelled) setUpNext((data?.queue || []).filter((t) => t && t.type !== 'episode').slice(0, 5)); })
        .catch(() => {}));
    load();
    const id = setInterval(load, 20000);
    return () => { cancelled = true; clearInterval(id); };
  }, [token, trackId, queueRev]);
  return <WallList box={box} heading="Up next" empty={track ? 'Nothing queued' : 'Up next'} rows={upNext.map((t, i) => ({ key: `${t.id}-${i}`, title: t.name, sub: names(t.artists) }))} />;
}

// ---- party assets: blank outside a party, except in the editor so they can be placed

function PartyQrWidget({ box, editing, label, options }) {
  const code = usePartyStore((s) => s.code);
  if (!code) return editing ? <Placeholder box={box} label={`${label} (no party running)`} /> : null;
  const show = options?.show || 'both';
  const host = partyLink(code).replace(/^https?:\/\//, '').replace(/\/p\/.*$/, '');
  if (show === 'code') {
    const font = Math.min(box.height * 0.5, box.width * 0.2);
    return (
      <div className="absolute flex flex-col items-center justify-center text-white" style={{ ...px(box), fontFamily: FONT }}>
        <p className="font-semibold text-white/60" style={{ fontSize: font * 0.32 }}>Pick the music at {host}</p>
        <p className="font-semibold tabular-nums" style={{ fontFamily: 'var(--font-mono)', fontSize: font, letterSpacing: '0.22em', lineHeight: 1.05 }}>{code}</p>
      </div>
    );
  }
  // Halloween: the code on a gravestone, engraved
  if (show === 'grave') {
    const sw = Math.min(box.width, box.height * 0.74);
    const qr = sw * 0.56;
    const ink = { color: '#2a2d33', textShadow: '0 1px 0 rgba(255,255,255,0.28), 0 -1px 0 rgba(0,0,0,0.35)' };
    return (
      <div className="absolute flex items-end justify-center" style={px(box)}>
        <div className="flex flex-col items-center" style={{ width: sw, height: Math.min(box.height, sw / 0.74), paddingTop: sw * 0.13, borderRadius: `${sw * 0.5}px ${sw * 0.5}px ${sw * 0.03}px ${sw * 0.03}px`, background: 'linear-gradient(170deg, #9a9ea7 0%, #7c8089 45%, #5d6169 100%)', boxShadow: `inset 0 ${-sw * 0.05}px ${sw * 0.12}px rgba(0,0,0,0.45), inset 0 ${sw * 0.02}px ${sw * 0.03}px rgba(255,255,255,0.25)` }}>
          <p style={{ ...ink, fontFamily: "'Creepster', var(--font-room), cursive", fontSize: sw * 0.17, lineHeight: 1, letterSpacing: '0.06em' }}>R.I.P.</p>
          <div style={{ width: qr, height: qr, marginTop: sw * 0.05, padding: qr * 0.05, borderRadius: qr * 0.04, background: '#fff' }}>
            <div className="h-full w-full [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: qrSvg(partyLink(code)) }} />
          </div>
          <p className="font-semibold" style={{ ...ink, fontFamily: FONT, fontSize: sw * 0.058, marginTop: sw * 0.05 }}>scan to request a song</p>
          <p className="tabular-nums" style={{ ...ink, fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: sw * 0.1, letterSpacing: '0.22em', marginTop: sw * 0.02 }}>{code}</p>
        </div>
      </div>
    );
  }
  const side = show === 'qr' ? Math.min(box.width, box.height) : Math.min(box.width, box.height * 0.74);
  return (
    <div className="absolute flex flex-col items-center justify-center text-white" style={{ ...px(box), fontFamily: FONT }}>
      <div style={{ width: side, height: side, padding: side * 0.06, borderRadius: side * 0.04, background: '#fff' }}>
        <div className="h-full w-full [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: qrSvg(partyLink(code)) }} />
      </div>
      {show === 'both' && (
        <p className="font-semibold tabular-nums" style={{ fontFamily: 'var(--font-mono)', fontSize: side * 0.17, letterSpacing: '0.22em', marginTop: side * 0.05, lineHeight: 1 }}>{code}</p>
      )}
    </div>
  );
}

function RequestedByWidget({ track, box, editing, label }) {
  const history = usePartyStore((s) => s.history);
  const upNext = usePartyStore((s) => s.upNext);
  const by = requestedBy(track, { history, upNext });
  if (!by) return editing ? <Placeholder box={box} label={label} /> : null;
  const size = fitFontSize(`Asked for by ${by}`, box.width, box.height * 0.8, 1, { charWidth: 0.5 });
  return (
    <div className="absolute flex items-center truncate font-semibold tracking-[-0.02em] text-white" style={{ ...px(box), fontFamily: FONT, fontSize: size }}>
      <span className="text-white/55">Asked for by&nbsp;</span>{by}
    </div>
  );
}

function PartyQueueWidget({ box, editing, label }) {
  const code = usePartyStore((s) => s.code);
  const queue = usePartyStore((s) => s.queue);
  if (!code) return editing ? <Placeholder box={box} label={`${label} (no party running)`} /> : null;
  return <WallList box={box} heading="Coming up" empty="Scan the code and pick a song" rows={queue.map((i) => ({ key: i.id, title: i.name, sub: `${i.guestName}${i.votes > 0 ? ` · ▲ ${i.votes}` : ''}` }))} />;
}

const WIDGET_VIEW = { art: ArtWidget, title: TitleWidget, progress: ProgressWidget, lyrics: LyricsWidget, clock: ClockWidget, next: NextWidget, partyqr: PartyQrWidget, requestedby: RequestedByWidget, partyqueue: PartyQueueWidget };

export function WidgetView({ widget, ...props }) {
  const View = WIDGET_VIEW[widget] || Placeholder;
  return <View {...props} />;
}
