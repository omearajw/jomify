import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useQueueStore } from '../store/queueStore';
import { useUserStore } from '../store/userStore';
import { usePlayerStore } from '../store/playerStore';
import { fetchQueue } from '../services/spotify/api';
import { withoutQueued } from '../services/queueLogic';
import { artUrl } from '../utils/images';
import { formatTime } from '../utils/formatTime';
import { usePlayingFrom } from '../hooks/usePlayingFrom';

// The room's right-hand column: Jomify's own queue (services/queueConductor.js), always on
// screen on the Mac. Rows on hairlines, the one row design the whole room uses; a remove at the
// row's end. Below it, a word on what Spotify plays after: the context, by name.

export default function QueueColumn({ compact = false }) {
  const items = useQueueStore((s) => s.items);
  const remove = useQueueStore((s) => s.remove);
  const setContextMenu = useUserStore((s) => s.setContextMenu);
  const from = usePlayingFrom();
  // what Spotify plays after the hand-added songs: its queue, once per song, less what Jomify
  // has already handed over
  const token = useUserStore((s) => s.token);
  const nowUri = usePlayerStore((s) => s.playbackState?.track_window?.current_track?.uri || null);
  const [then, setThen] = useState([]);
  useEffect(() => {
    if (!token || !nowUri || compact) return undefined;
    let gone = false;
    fetchQueue(token).then((q) => { if (!gone) setThen((q?.queue || []).slice(0, 8)); }).catch(() => {});
    return () => { gone = true; };
  }, [token, nowUri, compact]);
  const upcoming = withoutQueued(then, items).slice(0, Math.max(2, 6 - items.length));
  const openMenu = (e, track) => { e.preventDefault(); setContextMenu({ type: 'track', x: e.pageX, y: e.pageY, track }); };
  const shown = compact ? items.slice(0, 3) : items;

  return (
    <div className="min-w-0" data-control style={{ fontFamily: 'var(--font-room)' }}>
      {(items.length > 0 || upcoming.length === 0) && <p className="room-mono mb-4 flex justify-between text-[var(--room-dim)]"><span>Up next</span><span>{items.length || ''}</span></p>}
      {shown.length === 0 && upcoming.length === 0 && <p className="text-[13px] text-[var(--room-faint)]">Nothing queued. Add songs from a song's menu.</p>}
      {shown.map((t, i) => (
        <div
          key={t.key}
          onContextMenu={(e) => openMenu(e, t)}
          className="group flex min-w-0 items-center gap-3 py-2 text-[13px]"
          style={{ borderTop: i ? '1px solid var(--room-hair)' : 'none', opacity: 1 - Math.min(0.5, i * 0.12) }}
        >
          {t.album?.images?.[0] && <img src={artUrl(t.album.images, 34)} alt="" width="34" height="34" loading="lazy" decoding="async" className="h-[34px] w-[34px] flex-none rounded-[4px] object-cover" draggable="false" />}
          <div className="min-w-0 flex-1">
            <b className="block truncate font-semibold text-[var(--room-paper)]">{t.name}</b>
            <i className="block truncate text-[11px] not-italic text-[var(--room-dim)]">{(t.artists || []).map((a) => a.name).join(', ')}</i>
          </div>
          {!compact && <span className="room-mono text-[var(--room-faint)]">{formatTime(t.duration_ms)}</span>}
          <button type="button" onClick={() => remove(t.key)} aria-label={`Remove ${t.name} from the queue`} className="grid h-6 w-6 place-items-center rounded-full text-[var(--room-faint)] opacity-0 transition-opacity hover:text-[var(--room-paper)] group-hover:opacity-100 pointer-coarse:opacity-100">
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
      {!compact && (from || upcoming.length > 0) && (
        <p className={`room-mono mb-1 ${items.length ? 'mt-5 text-[var(--room-faint)]' : 'mb-4 text-[var(--room-dim)]'}`}>{items.length ? 'Then' : 'Up next'}{from ? ` · ${from.name || from.type}` : ''}</p>
      )}
      {!compact && upcoming.map((t, i) => (
        <div key={`${t.uri}-${i}`} onContextMenu={(e) => openMenu(e, t)} className="flex min-w-0 items-center gap-3 py-2 text-[13px]" style={{ borderTop: '1px solid var(--room-hair)', opacity: 0.55 - Math.min(0.3, i * 0.07) }}>
          {t.album?.images?.[0] && <img src={artUrl(t.album.images, 34)} alt="" width="34" height="34" loading="lazy" decoding="async" className="h-[34px] w-[34px] flex-none rounded-[4px] object-cover" draggable="false" />}
          <div className="min-w-0 flex-1">
            <b className="block truncate font-medium text-[var(--room-paper)]">{t.name}</b>
            <i className="block truncate text-[11px] not-italic text-[var(--room-dim)]">{(t.artists || []).map((a) => a.name).join(', ')}</i>
          </div>
        </div>
      ))}
    </div>
  );
}
