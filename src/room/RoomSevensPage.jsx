import { useState } from 'react';
import { useSevensSettings } from '../views/Sevens/useSevensSettings';
import { artUrl } from '../utils/images';
import ConfirmDialog from '../components/ConfirmDialog';
import NotificationToggle from '../components/NotificationToggle';

// The Sevens page on the room's language: which playlists are Sevens, who each is with, the
// pool it drafts from, running or finished. Two sections: "Add a Seven", a find field over your
// playlists with a word to make one a Seven; "Your Sevens", each as a block of words and two
// plain selects. The logic is useSevensSettings, shared with the old page.

const Mono = ({ children, className = '' }) => <p className={`room-mono ${className}`}>{children}</p>;
const Word = ({ onClick, children, lit, danger }) => <button type="button" onClick={onClick} aria-pressed={lit || undefined} className={`ui-word ${danger ? 'ui-row-danger' : ''}`}>{children}</button>;
const Select = ({ value, onChange, children, label }) => (
  <select value={value} onChange={onChange} aria-label={label} className="min-w-0 max-w-[260px] truncate bg-transparent text-[13px] text-[var(--room-dim)] outline-none hover:text-[var(--room-paper)] [&>option]:bg-[var(--room-solid)]">{children}</select>
);

export default function RoomSevensPage() {
  const {
    playlists, sevens, addSeven, removeSeven, updateSeven, navigateToPlaylist, query, setQuery, candidates, users, analysing, analyseSeven, getPlaylist, partnerLabel, availablePlaylists, activeSevens, finishedSevens, confirmRemove, setConfirmRemove
  } = useSevensSettings();
  const [adding, setAdding] = useState(false);

  const block = (seven) => {
    const playlist = getPlaylist(seven.playlistId);
    const partner = partnerLabel(seven);
    const found = candidates[seven.playlistId] || [];
    const busy = analysing[seven.playlistId];
    return (
      <div key={seven.playlistId} className={`py-4 ${seven.active ? '' : 'opacity-60'}`} style={{ borderTop: '1px solid var(--room-hair)' }}>
        <div className="flex items-center gap-4">
          <button type="button" onClick={() => navigateToPlaylist(seven.playlistId)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
            <span className="h-[44px] w-[44px] shrink-0 overflow-hidden rounded-[4px] bg-white/5">{playlist?.images?.[0]?.url && <img src={artUrl(playlist.images, 44)} alt="" loading="lazy" decoding="async" draggable="false" className="h-full w-full object-cover" />}</span>
            <span className="min-w-0">
              <span className="block truncate text-[14px] font-semibold text-[var(--room-paper)]">{playlist?.name || 'Loading…'}</span>
              <Mono className="truncate text-[var(--room-faint)]">{busy && !partner ? 'Working out who this is with' : partner ? `with ${partner}` : 'No partner yet · songs sent to them elsewhere cannot be flagged'}</Mono>
            </span>
          </button>
          <span className="flex shrink-0 items-center gap-5">
            <Word onClick={() => updateSeven(seven.playlistId, { active: !seven.active })} lit={seven.active}>{seven.active ? 'Running' : 'Finished'}</Word>
            <Word onClick={() => setConfirmRemove(seven.playlistId)} danger>Remove</Word>
          </span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-8 gap-y-2 pl-[56px]">
          <span className="flex items-center gap-2">
            <Mono className="text-[var(--room-faint)]">With</Mono>
            <Select label="Who this Seven is with" value={seven.partnerId || ''} onChange={(e) => { const value = e.target.value; updateSeven(seven.playlistId, { partnerId: value || null, partnerLocked: Boolean(value), partnerName: value ? (users[value]?.display_name || value) : null }); }}>
              <option value="">Not sure yet</option>
              {found.map((c) => <option key={c.id} value={c.id}>{users[c.id]?.display_name || c.id} · {c.count}</option>)}
              {seven.partnerId && !found.some((c) => c.id === seven.partnerId) && <option value={seven.partnerId}>{partner}</option>}
            </Select>
            <Word onClick={() => analyseSeven(seven.playlistId, { force: true })}>{busy ? 'Looking' : 'Work it out'}</Word>
          </span>
          <span className="flex items-center gap-2">
            <Mono className="text-[var(--room-faint)]">Pool</Mono>
            <Select label="The playlist this Seven drafts from" value={seven.poolPlaylistId || ''} onChange={(e) => updateSeven(seven.playlistId, { poolPlaylistId: e.target.value })}>
              <option value="">None chosen</option>
              {playlists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="relative min-h-full pb-12" style={{ fontFamily: 'var(--font-room)' }}>
      <Mono className="text-[var(--room-faint)]">Sevens</Mono>
      <h1 className="mt-2 text-[30px] font-semibold leading-[1.05] tracking-[-0.025em] text-[var(--room-paper)]">Manage your Sevens</h1>
      <p className="mt-3 max-w-xl text-[13px] text-[var(--room-dim)]">A Seven is a playlist you and one other person take turns adding seven songs to. Running ones tell you when it's your turn; finished ones stay quiet but are still checked, so the same person never gets a song twice.</p>

      <div className="mt-8 flex items-center justify-between border-b border-[var(--room-hair)] pb-2">
        <Mono className="text-[var(--room-faint)]">Add a Seven</Mono>
        <Word onClick={() => setAdding((a) => !a)} lit={adding}>{adding ? 'Done' : 'Choose a playlist'}</Word>
      </div>
      {adding && (
        <div className="mt-2">
          <input autoFocus type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find one of your playlists" aria-label="Find one of your playlists" className="ui-field [&::-webkit-search-cancel-button]:hidden" />
          <div className="mt-1 max-h-[40vh] overflow-y-auto">
            {availablePlaylists.length === 0 && <p className="py-5 text-[13px] text-[var(--room-faint)]">{playlists.length === 0 ? 'Your playlists are still loading.' : 'No playlist matches.'}</p>}
            {availablePlaylists.map((p) => (
              <button key={p.id} type="button" onClick={() => { addSeven(p.id); setQuery(''); setAdding(false); }} className="flex w-full items-center gap-3 py-2 text-left text-[13px] text-[var(--room-dim)] hover:text-[var(--room-paper)]" style={{ borderTop: '1px solid var(--room-hair)' }}>
                <span className="h-[30px] w-[30px] shrink-0 overflow-hidden rounded-[3px] bg-white/5">{p.images?.[0]?.url && <img src={artUrl(p.images, 30)} alt="" loading="lazy" decoding="async" draggable="false" className="h-full w-full object-cover" />}</span>
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                <Mono className="shrink-0 text-[var(--room-faint)]">{p.tracks?.total ?? 0} songs{p.collaborative ? ' · collaborative' : ''}</Mono>
                <Mono className="shrink-0 text-[var(--room-faint)]">Make it a Seven</Mono>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-9 border-b border-[var(--room-hair)] pb-2"><Mono className="text-[var(--room-faint)]">Your Sevens{sevens.length ? ` · ${sevens.length}` : ''}</Mono></div>
      {sevens.length === 0 && <p className="py-5 text-[13px] text-[var(--room-faint)]">None yet. Add one above to get the batch builder and the duplicate check.</p>}
      {activeSevens.map(block)}
      {finishedSevens.length > 0 && <>
        <div className="mt-9 border-b border-[var(--room-hair)] pb-2"><Mono className="text-[var(--room-faint)]">Finished · {finishedSevens.length}</Mono></div>
        {finishedSevens.map(block)}
      </>}

      <div className="mt-10 border-b border-[var(--room-hair)] pb-2"><Mono className="text-[var(--room-faint)]">Notifications</Mono></div>
      <NotificationToggle compact />

      <ConfirmDialog open={Boolean(confirmRemove)} title="Remove this Seven?" message="The playlist itself is untouched. Jomify just stops treating it as a Seven, so it loses the batch builder and the duplicate check." confirmLabel="Remove" onConfirm={() => { removeSeven(confirmRemove); setConfirmRemove(null); }} onCancel={() => setConfirmRemove(null)} />
    </div>
  );
}
