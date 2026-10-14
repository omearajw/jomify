import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, X } from 'lucide-react';
import { useUserStore } from '../store/userStore';
import { artUrl } from '../utils/images';
import { isPile } from '../utils/unaddedSync';

// Which playlists count as "added" for the Unadded check, and so are the targets to file into.
// A plane over the room: a find field, your playlists as rows, a tick on the chosen ones.

export default function CheckPlaylistsDialog({ open, onClose }) {
  const playlists = useUserStore((s) => s.playlists);
  const chosen = useUserStore((s) => s.unaddedCheckPlaylists);
  const setChosen = useUserStore((s) => s.setUnaddedCheckPlaylists);
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);
  if (!open) return null;
  const needle = query.trim().toLowerCase();
  const list = playlists.filter((p) => !isPile(p) && (!needle || (p.name || '').toLowerCase().includes(needle)));
  const toggle = (id) => setChosen((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  return createPortal(
    <div role="dialog" aria-label="Playlists to check against" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="ui-plane relative flex max-h-[80vh] w-full max-w-md flex-col p-7" onClick={(e) => e.stopPropagation()} style={{ fontFamily: 'var(--font-room)' }}>
        <p className="room-mono flex justify-between text-[var(--room-dim)]"><span>Playlists to check against · {chosen.length}</span><button type="button" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></button></p>
        <p className="mt-2 text-[12px] text-[var(--room-faint)]">A liked song in none of these is unadded. These are also where a song can be filed.</p>
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a playlist" aria-label="Find a playlist" autoFocus className="ui-field mt-4 [&::-webkit-search-cancel-button]:hidden" />
        <div className="mt-2 min-h-0 flex-1 overflow-y-auto">
          {list.length === 0 && <p className="py-8 text-center text-[13px] text-[var(--room-faint)]">{needle ? 'No playlist matches.' : 'No playlists yet.'}</p>}
          {list.map((p) => {
            const on = chosen.includes(p.id);
            return (
              <button key={p.id} type="button" onClick={() => toggle(p.id)} aria-pressed={on} className={`flex w-full items-center gap-3 py-2 text-left text-[13px] ${on ? 'text-[var(--room-paper)]' : 'text-[var(--room-dim)] hover:text-[var(--room-paper)]'}`} style={{ borderTop: '1px solid var(--room-hair)' }}>
                <span className="h-7 w-7 shrink-0 overflow-hidden rounded-[3px] bg-white/5">{p.images?.[0]?.url && <img src={artUrl(p.images, 28)} alt="" className="h-full w-full object-cover" />}</span>
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                {on && <Check className="h-3.5 w-3.5" />}
              </button>
            );
          })}
        </div>
        <p className="mt-4 text-right"><button type="button" onClick={onClose} className="ui-word" aria-pressed="true">Done</button></p>
      </div>
    </div>,
    document.body
  );
}
