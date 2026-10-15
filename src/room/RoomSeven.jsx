import { useEffect, useRef, useState } from 'react';
import { Play, Shuffle, X } from 'lucide-react';
import { useSevenView, formatBatchDate } from '../views/Library/useSevenView';
import { searchSpotify } from '../services/spotify/api';
import { artUrl } from '../utils/images';
import { formatTime } from '../utils/formatTime';
import { rowButtonProps } from '../utils/a11y';
import { isSameTrack, isUnplayable, TRACK_DRAG_TYPE } from '../utils/spotifyUri';
import LikeButton from '../components/LikeButton';

// A Seven on the room's language (DESIGN.md §7): two faces. Building, when it is your turn:
// the batch on the left as rows on hairlines with "Send the batch · n of 7" as the one pill, the
// pool on the right with a find field and a word to search Spotify instead, each candidate
// marked "in this Seven" or "sent before" in mono; a pool row dragged across lands in the slot it
// is dropped on, a click fills the first empty slot, batch rows drag to reorder by shifting.
// Shift-click and Ctrl/Cmd-click select rows in either list, and a drag carries the selection.
// Reading, when it is theirs: the batches so far as sections, newest first, a mono heading per
// batch. A third face, "The playlist", is the Seven in plain order, newest first. Play and
// Shuffle for the whole Seven. The logic is useSevenView, shared with the old page.

const Mono = ({ children, className = '' }) => <p className={`room-mono ${className}`}>{children}</p>;
const Word = ({ onClick, children, lit, disabled, tip }) => <button type="button" data-tip={tip} onClick={onClick} disabled={disabled} aria-pressed={lit || undefined} className="ui-word">{children}</button>;
const POOL_DRAG = 'application/x-jomify-pool';
const BATCH_DRAG = 'application/x-jomify-batch';

export default function RoomSeven() {
  const {
    token, activePlaylistId, playlists, profile, view, playlist, stillLoading, loadError, chunks, turnIndicator, collaborators,
    stagedSeven, removeStagedTrack, setStagedSeven, handlePublishSeven, isPublishing, publishError, playPoolTrack, reorderPool,
    poolPlaylist, poolError, setPoolError, setPoolAttempt, poolQuery, setPoolQuery, poolMatches, poolPlaylistId, setPoolPlaylistId,
    thisSeven, partnerDisplayName, partnerSevens, isCheckingHistory, crossSevenMatches, mainPlaylistUris,
    isWorkspaceOpen, setIsWorkspaceOpen, handleTrackSelect, playFromTop, shufflePlay, isShuffled, openTrackMenu,
    currentPlayingTrack, isCurrentTrackPaused, navigateToArtist, navigateToAlbum
  } = useSevenView();

  // the face the turn calls for, once; after that the word decides
  const yourTurn = playlist ? (() => { const last = playlist.tracks.items[playlist.tracks.items.length - 1]; return !last || last.added_by?.id !== profile?.id; })() : false;
  const [facePicked, setFacePicked] = useState(false);
  if (playlist && !facePicked) { setFacePicked(true); setIsWorkspaceOpen(yourTurn && thisSeven?.active !== false); }
  const [plain, setPlain] = useState(false); // "The playlist": the Seven in order, newest first
  const building = isWorkspaceOpen && !plain;

  // the pool's find field can search Spotify instead
  const [onSpotify, setOnSpotify] = useState(false);
  // the hits carry the words they answer, so stale ones are never shown for new words
  const [spotifyAnswer, setSpotifyAnswer] = useState(null);
  const words = poolQuery.trim();
  useEffect(() => {
    if (!onSpotify || !token || !words) return undefined;
    let gone = false;
    const t = setTimeout(() => searchSpotify(token, words).then((d) => { if (!gone) setSpotifyAnswer({ words, items: (d?.tracks?.items || []).filter(Boolean).slice(0, 25) }); }).catch(() => { if (!gone) setSpotifyAnswer({ words, items: [] }); }), 350);
    return () => { gone = true; clearTimeout(t); };
  }, [onSpotify, words, token]);
  const spotifyHits = onSpotify && words && spotifyAnswer?.words === words ? spotifyAnswer.items : null;

  // Seven slots, so a song can sit in slot five with four still to fill. The slots are this
  // surface's own (kept per Seven on this device); the store keeps the batch as the slots'
  // order with the gaps closed, which is what gets sent.
  const [overSlot, setOverSlot] = useState(null);
  const staged = stagedSeven;
  const stagedUris = new Set(staged.map((t) => t.uri));
  const slotKey = `jomify_seven_slots_${activePlaylistId}`;
  const [slotMap, setSlotMap] = useState(() => { try { return JSON.parse(localStorage.getItem(`jomify_seven_slots_${activePlaylistId}`) || '{}'); } catch { return {}; } });
  const slots = (() => {
    const out = new Array(7).fill(null);
    const byUri = new Map(staged.map((t) => [t.uri, t]));
    for (const [uri, k] of Object.entries(slotMap)) if (byUri.has(uri) && k >= 0 && k < 7 && !out[k]) { out[k] = byUri.get(uri); byUri.delete(uri); }
    for (const t of byUri.values()) { const k = out.indexOf(null); if (k !== -1) out[k] = t; }
    return out;
  })();
  const commit = (next) => {
    const map = {}; next.forEach((t, k) => { if (t) map[t.uri] = k; });
    setSlotMap(map); try { localStorage.setItem(slotKey, JSON.stringify(map)); } catch { /* fine */ }
    setStagedSeven(next.filter(Boolean), activePlaylistId);
  };
  // Shifting, never swapping: a song dropped on slot k takes slot k and the songs between its old
  // slot and k move one along, empties included (the seven slots are a list of seven, some blank).
  // A group moves as one, in slot order, the grabbed song landing on k.
  const moveWithin = (uris, k, grabbed) => {
    const group = slots.filter((t) => t && uris.has(t.uri));
    if (group.length === 0) return;
    const rest = slots.filter((t) => !(t && uris.has(t.uri)));
    const at = Math.max(0, group.findIndex((t) => t.uri === grabbed));
    const start = Math.max(0, Math.min(7 - group.length, k - at));
    rest.splice(start, 0, ...group);
    commit(rest.slice(0, 7));
  };
  // Songs from the pool land on slot k and the ones after: each takes an empty slot to make room,
  // the first empty below k if there is one (the run below shifts down into it), else the last
  // empty above (the run above shifts up). A full batch takes nothing.
  const placeFrom = (tracks, k) => {
    let next = [...slots];
    let at = Math.max(0, Math.min(6, k));
    for (const track of tracks) {
      if (mainPlaylistUris.has(track.uri) || next.some((t) => t && t.uri === track.uri)) continue;
      let e = next.findIndex((t, i) => i >= at && !t);
      if (e === -1) { for (let i = at - 1; i >= 0; i--) if (!next[i]) { e = i; break; } }
      if (e === -1) break;
      if (e < at) at -= 1;
      next.splice(e, 1); next.splice(at, 0, track);
      at = Math.min(6, at + 1);
    }
    commit(next);
  };
  const placeAt = (track, at) => placeFrom([track], at);
  const removeAt = (track) => { commit(slots.map((t) => (t && t.uri === track.uri ? null : t))); removeStagedTrack(track.uri, activePlaylistId); };

  // Selection in the batch or the pool: Ctrl/Cmd-click toggles, Shift-click runs from the last
  // click, a plain click on a batch row picks it alone, Escape or a click elsewhere lets go.
  const [sel, setSel] = useState({ zone: null, uris: [], anchor: null });
  const selected = new Set(sel.uris);
  const pick = (zone, order, uri, e) => {
    const toggle = e.metaKey || e.ctrlKey;
    if (e.shiftKey && sel.zone === zone && sel.anchor) {
      const a = order.indexOf(sel.anchor), b = order.indexOf(uri);
      if (a !== -1 && b !== -1) { setSel({ zone, uris: order.slice(Math.min(a, b), Math.max(a, b) + 1), anchor: sel.anchor }); return; }
    }
    if (toggle && sel.zone === zone) { setSel({ zone, uris: selected.has(uri) ? sel.uris.filter((u) => u !== uri) : [...sel.uris, uri], anchor: uri }); return; }
    setSel({ zone, uris: [uri], anchor: uri });
  };
  const letGo = () => setSel({ zone: null, uris: [], anchor: null });
  const holding = sel.uris.length > 0;
  useEffect(() => {
    if (!holding) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setSel({ zone: null, uris: [], anchor: null }); } };
    // on window, ahead of the room's own capture listener on document
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [holding]);
  const [overPool, setOverPool] = useState(null); // { uri, after }
  const dragPool = useRef(null);

  if (loadError?.id === activePlaylistId && !playlist) return <p className="pt-6 text-[13px] text-[var(--room-dim)]">{loadError.message}</p>;
  if (!view) return <Mono className="pt-6 text-[var(--room-faint)]">Loading</Mono>;

  const coverUrl = view.images?.[0]?.url || '';
  const total = view.tracks?.total ?? 0;
  const facts = [thisSeven?.partnerName ? `with ${partnerDisplayName || thisSeven.partnerName}` : 'A Seven', `${total} songs`, thisSeven?.active === false ? 'finished' : turnIndicator.replace('Next up: ', '').replace(profile?.display_name || '\u0000', 'your') + (turnIndicator.includes(profile?.display_name || '\u0000') ? ' turn' : "'s turn")].join(' · ');

  const markOf = (track) => {
    if (mainPlaylistUris.has(track.uri)) return 'in this Seven';
    const sent = crossSevenMatches[track.uri];
    return sent ? `sent before · ${sent.playlistName}` : stagedUris.has(track.uri) ? 'in the batch' : null;
  };
  const poolItems = (poolPlaylist?.tracks?.items || []).map((i) => i.track).filter(Boolean);
  const poolOrder = poolItems.map((t) => t.uri);
  const poolRow = (track, i) => {
    const mark = markOf(track);
    const taken = Boolean(mark);
    const current = isSameTrack(track, currentPlayingTrack);
    const isSel = sel.zone === 'pool' && selected.has(track.uri);
    const canSort = !onSpotify && !poolQuery.trim();
    return (
      <div
        key={`${track.uri}-${i}`}
        draggable={!taken || canSort}
        onDragStart={(e) => {
          const tracks = isSel ? candidates.filter((t) => selected.has(t.uri)) : [track];
          dragPool.current = tracks.map((t) => t.uri);
          e.dataTransfer.effectAllowed = 'copyMove';
          e.dataTransfer.setData(POOL_DRAG, JSON.stringify(tracks.filter((t) => !markOf(t))));
          e.dataTransfer.setData(TRACK_DRAG_TYPE, track.uri); e.dataTransfer.setData('text/plain', track.uri);
        }}
        onDragEnd={() => { dragPool.current = null; setOverPool(null); }}
        onDragOver={(e) => { if (!canSort || !dragPool.current) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; const r = e.currentTarget.getBoundingClientRect(); const after = e.clientY - r.top > r.height / 2; if (overPool?.uri !== track.uri || overPool.after !== after) setOverPool({ uri: track.uri, after }); }}
        onDragLeave={() => setOverPool((o) => (o?.uri === track.uri ? null : o))}
        onDrop={(e) => {
          if (!canSort || !dragPool.current) return;
          e.preventDefault(); const moving = dragPool.current; dragPool.current = null; setOverPool(null);
          const r = e.currentTarget.getBoundingClientRect(); const after = e.clientY - r.top > r.height / 2;
          // one move per song, from the top of the group, each landing just after the one before
          let to = poolOrder.indexOf(track.uri) + (after ? 1 : 0);
          let order = [...poolOrder];
          for (const uri of moving) {
            const from = order.indexOf(uri);
            if (from === -1 || uri === track.uri) continue;
            if (from === to || from === to - 1) { to = from + 1; continue; }
            reorderPool(from, to);
            const landing = to > from ? to - 1 : to;
            order.splice(from, 1); order.splice(landing, 0, uri);
            to = landing + 1;
          }
        }}
        onClick={(e) => { if (e.shiftKey || e.metaKey || e.ctrlKey) { pick('pool', candidates.map((t) => t.uri), track.uri, e); return; } if (sel.uris.length) letGo(); if (!taken && !stagedUris.has(track.uri) && staged.length < 7) placeAt(track, slots.indexOf(null)); }}
        onContextMenu={(e) => openTrackMenu(e, track)}
        className={`group flex items-center gap-3 py-[8px] text-[13px] ${taken ? 'opacity-45' : 'cursor-pointer hover:bg-white/[0.03]'} ${isSel ? 'bg-white/[0.08]' : ''}`}
        style={{ borderTop: `1px solid ${overPool?.uri === track.uri && !overPool.after ? 'var(--room-paper)' : 'var(--room-hair)'}`, boxShadow: overPool?.uri === track.uri && overPool.after ? 'inset 0 -1px 0 var(--room-paper)' : undefined }}
      >
        <button type="button" onClick={(e) => { e.stopPropagation(); playPoolTrack(track); }} aria-label={`Play ${track.name}`} className="grid h-6 w-5 shrink-0 place-items-center text-[var(--room-paper)]">
          {current && !isCurrentTrackPaused ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--room-paper)]" aria-label="Playing" /> : <Play className="h-3 w-3 fill-current opacity-0 group-hover:opacity-100" />}
        </button>
        <span className="h-[32px] w-[32px] shrink-0 overflow-hidden rounded-[3px] bg-white/5">{track.album?.images?.[0]?.url && <img src={artUrl(track.album.images, 32)} alt="" width="32" height="32" loading="lazy" decoding="async" draggable="false" className="h-full w-full object-cover" />}</span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate font-medium ${current ? 'text-[var(--room-paper)]' : 'text-[var(--room-paper)]/90'}`}>{track.name}</span>
          <span className="block truncate text-[11.5px] text-[var(--room-dim)]">{(track.artists || []).map((a) => a.name).join(', ')}</span>
        </span>
        {mark ? <Mono className="shrink-0 text-[var(--room-faint)]">{mark}</Mono> : <Mono className="shrink-0 text-[var(--room-faint)] opacity-0 group-hover:opacity-100">Add</Mono>}
      </div>
    );
  };

  const fromPool = (e) => { try { const v = JSON.parse(e.dataTransfer.getData(POOL_DRAG) || 'null'); return Array.isArray(v) ? v : v ? [v] : []; } catch { return []; } };
  const dropInto = (e, k) => {
    e.preventDefault(); setOverSlot(null);
    const fromBatch = e.dataTransfer.getData(BATCH_DRAG);
    if (fromBatch) { try { const { uris, grabbed } = JSON.parse(fromBatch); moveWithin(new Set(uris), k, grabbed); } catch { /* not ours */ } return; }
    const tracks = fromPool(e);
    if (tracks.length) placeFrom(tracks, k);
  };
  const batchOrder = slots.filter(Boolean).map((t) => t.uri);
  const slotRow = (track, k) => {
    const isSel = track && sel.zone === 'batch' && selected.has(track.uri);
    return (
    <div
      key={track ? track.uri : `slot-${k}`}
      draggable={Boolean(track)}
      onDragStart={track ? (e) => { const uris = isSel ? sel.uris : [track.uri]; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData(BATCH_DRAG, JSON.stringify({ uris, grabbed: track.uri })); } : undefined}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (overSlot !== k) setOverSlot(k); }}
      onDragLeave={() => setOverSlot((o) => (o === k ? null : o))}
      onDrop={(e) => dropInto(e, k)}
      onClick={track ? (e) => pick('batch', batchOrder, track.uri, e) : () => letGo()}
      onContextMenu={track ? (e) => openTrackMenu(e, track) : undefined}
      className={`group flex items-center gap-3 py-[8px] text-[13px] transition-colors ${overSlot === k ? 'bg-white/[0.06]' : isSel ? 'bg-white/[0.08]' : ''}`}
      style={{ borderTop: '1px solid var(--room-hair)', minHeight: 49, transitionDuration: 'var(--room-mid)' }}
    >
      <Mono className="w-4 text-center text-[var(--room-faint)]">{k + 1}</Mono>
      {track ? (
        <>
          <span className="h-[32px] w-[32px] shrink-0 overflow-hidden rounded-[3px] bg-white/5">{track.album?.images?.[0]?.url && <img src={artUrl(track.album.images, 32)} alt="" width="32" height="32" draggable="false" className="h-full w-full object-cover" />}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-[var(--room-paper)]">{track.name}</span>
            <span className="block truncate text-[11.5px] text-[var(--room-dim)]">{(track.artists || []).map((a) => a.name).join(', ')}</span>
          </span>
          <button type="button" onClick={(e) => { e.stopPropagation(); removeAt(track); }} aria-label={`Remove ${track.name} from the batch`} className="grid h-6 w-6 place-items-center text-[var(--room-faint)] opacity-0 hover:text-[var(--room-paper)] group-hover:opacity-100"><X className="h-3.5 w-3.5" /></button>
        </>
      ) : (
        <span className="room-mono text-[var(--room-faint)] opacity-60">{overSlot === k ? 'Drop here' : 'Empty'}</span>
      )}
    </div>
    );
  };

  const trackRow = (track, i, number) => {
    const current = isSameTrack(track, currentPlayingTrack);
    const unplayable = isUnplayable(track);
    return (
      <div key={`${track.uri}-${i}`} onClick={() => handleTrackSelect(track.uri)} {...rowButtonProps(() => handleTrackSelect(track.uri))} onContextMenu={(e) => openTrackMenu(e, track)} aria-disabled={unplayable || undefined}
        className={`group grid cursor-pointer grid-cols-[28px_34px_minmax(0,1.3fr)_minmax(0,1fr)_24px_44px] items-center gap-3 py-[9px] text-[13px] transition-colors hover:bg-white/[0.03] ${unplayable ? 'opacity-40' : ''}`} style={{ borderTop: i ? '1px solid var(--room-hair)' : 'none', transitionDuration: 'var(--room-mid)' }}>
        <span className="room-mono flex items-center justify-center text-[var(--room-faint)]">{current && !isCurrentTrackPaused ? <span className="h-1.5 w-1.5 rounded-full bg-[var(--room-paper)] animate-pulse" aria-label="Playing" /> : <><span className="group-hover:hidden">{number}</span><Play className="hidden h-3 w-3 fill-current text-[var(--room-paper)] group-hover:block" /></>}</span>
        <span className="h-[34px] w-[34px] overflow-hidden rounded-[3px] bg-white/5">{track.album?.images?.[0]?.url && <img src={artUrl(track.album.images, 34)} alt="" width="34" height="34" loading="lazy" decoding="async" draggable="false" className="h-full w-full object-cover" />}</span>
        <span className="min-w-0 pr-3">
          <span className={`block truncate ${current ? 'font-semibold text-[var(--room-paper)]' : 'font-medium text-[var(--room-paper)]/90'}`}>{track.name}</span>
          <span className="block truncate text-[11.5px] text-[var(--room-dim)]">{(track.artists || []).map((a, j) => <span key={a.id || j}><button type="button" onClick={(e) => { e.stopPropagation(); if (a.id) navigateToArtist(a.id); }} className="hover:text-[var(--room-paper)]">{a.name}</button>{j < track.artists.length - 1 ? ', ' : ''}</span>)}</span>
        </span>
        <span className="min-w-0 truncate pr-3 text-[var(--room-dim)]">{track.album?.id ? <button type="button" onClick={(e) => { e.stopPropagation(); navigateToAlbum(track.album.id); }} className="block w-full truncate text-left hover:text-[var(--room-paper)]">{track.album.name}</button> : track.album?.name}</span>
        <span className="room-like flex items-center justify-center [&_svg]:h-4 [&_svg]:w-4"><LikeButton trackId={track.id} /></span>
        <Mono className="text-right text-[var(--room-faint)]">{formatTime(track.duration_ms)}</Mono>
      </div>
    );
  };

  const poolTracks = poolItems.filter(poolMatches);
  const candidates = onSpotify ? (spotifyHits || []) : poolTracks;

  return (
    <div className="relative min-h-full pb-12" style={{ fontFamily: 'var(--font-room)' }}>
      {/* the head: the Seven, its facts, the two faces */}
      <header className="flex items-end gap-6">
        <div className="h-[112px] w-[112px] shrink-0 overflow-hidden rounded-[5px] bg-white/5">{coverUrl && <img src={coverUrl} alt="" className="h-full w-full object-cover" draggable="false" />}</div>
        <div className="min-w-0 flex-1 pb-1">
          <Mono className="text-[var(--room-faint)]">Seven · {facts}</Mono>
          <h1 className="mt-2 truncate text-[30px] font-semibold leading-[1.05] tracking-[-0.025em] text-[var(--room-paper)]">{view.name}</h1>
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
            <button type="button" onClick={() => (isShuffled ? shufflePlay() : playFromTop())} aria-label={`Play ${view.name}`} className="grid h-[40px] w-[40px] place-items-center rounded-full bg-[var(--room-paper)] text-[#0a0810] transition-transform hover:scale-105 active:scale-95"><Play className="ml-0.5 h-4 w-4 fill-current" /></button>
            <button type="button" onClick={shufflePlay} aria-label="Shuffle play" className={`transition-colors ${isShuffled ? 'text-[var(--room-paper)]' : 'text-[var(--room-faint)] hover:text-[var(--room-dim)]'}`}><Shuffle className="h-4 w-4" /></button>
            <span className="ml-1 flex items-center gap-4">
              <Word lit={building} tip="Choose your seven songs from the pool and send them" onClick={() => { setPlain(false); setIsWorkspaceOpen(true); }}>Build{staged.length ? ` · ${staged.length} of 7` : ''}</Word>
              <Word lit={!building && !plain} tip="Every batch sent so far, newest first, by who sent it" onClick={() => { setPlain(false); setIsWorkspaceOpen(false); }}>The Seven so far</Word>
              <Word lit={plain} tip="The whole playlist in order, newest song first" onClick={() => setPlain(true)}>The playlist</Word>
            </span>
          </div>
        </div>
      </header>

      {building ? (
        <div className="mt-8 grid gap-10" style={{ gridTemplateColumns: 'minmax(0, 5fr) minmax(0, 6fr)' }}>
          {/* the batch: it holds its place at the top of the column while the pool scrolls past */}
          <section
            className="sticky top-0 self-start"
            onDragOver={(e) => { if (Array.from(e.dataTransfer.types).includes(POOL_DRAG)) { e.preventDefault(); } }}
            onDrop={(e) => { if (e.defaultPrevented) return; const tracks = fromPool(e); if (tracks.length && staged.length < 7) { e.preventDefault(); placeFrom(tracks, slots.indexOf(null)); } }}
          >
            <div className="flex items-center justify-between border-b border-[var(--room-hair)] pb-2">
              <Mono className="text-[var(--room-faint)]">The batch · {staged.length} of 7</Mono>
              <button type="button" onClick={handlePublishSeven} disabled={staged.length !== 7 || isPublishing} className="ui-pill">{isPublishing ? 'Sending…' : 'Send the batch'}</button>
            </div>
            {publishError && <p className="pt-3 text-[13px] text-[rgb(240,160,160)]">{publishError}</p>}
            {slots.map(slotRow)}
            {staged.length === 0 && <p className="pt-4 text-[13px] text-[var(--room-faint)]">Click or drag songs across from the pool; drop one on any slot. Drag a slot onto another to shift it there.</p>}
          </section>

          {/* the pool */}
          <section>
            <div className="flex items-center gap-4 border-b border-[var(--room-hair)] pb-2">
              <input type="search" value={poolQuery} onChange={(e) => setPoolQuery(e.target.value)} placeholder={onSpotify ? 'Search Spotify' : 'Find in the pool'} aria-label={onSpotify ? 'Search Spotify' : 'Find in the pool'} className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--room-paper)] outline-none placeholder:text-[var(--room-faint)] [&::-webkit-search-cancel-button]:hidden" />
              <Word lit={!onSpotify} onClick={() => setOnSpotify(false)}>The pool</Word>
              <Word lit={onSpotify} onClick={() => setOnSpotify(true)}>On Spotify</Word>
            </div>
            {!onSpotify && (
              <div className="flex items-center gap-3 pt-3">
                <Mono className="text-[var(--room-faint)]">Pool</Mono>
                <select value={poolPlaylistId} onChange={(e) => setPoolPlaylistId(e.target.value)} aria-label="Pool playlist" className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--room-dim)] outline-none [&>option]:bg-[var(--room-solid)]">
                  <option value="">Choose a playlist to draft from</option>
                  {playlists.filter((p) => p.id !== activePlaylistId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                {isCheckingHistory && <Mono className="shrink-0 text-[var(--room-faint)]">Checking other Sevens</Mono>}
                {!isCheckingHistory && partnerSevens.length > 0 && <Mono className="shrink-0 text-[var(--room-faint)]">{partnerSevens.length} other Seven{partnerSevens.length === 1 ? '' : 's'} checked</Mono>}
              </div>
            )}
            {!onSpotify && poolError && !poolPlaylist && <p className="pt-4 text-[13px] text-[var(--room-dim)]">{poolError} <Word onClick={() => { setPoolError(''); setPoolAttempt((n) => n + 1); }}>Try again</Word></p>}
            {!onSpotify && poolPlaylistId && !poolPlaylist && !poolError && <Mono className="pt-4 text-[var(--room-faint)]">Loading the pool</Mono>}
            {onSpotify && !poolQuery.trim() && <p className="pt-4 text-[13px] text-[var(--room-faint)]">Type above to search Spotify.</p>}
            {onSpotify && poolQuery.trim() && spotifyHits === null && <Mono className="pt-4 text-[var(--room-faint)]">Searching</Mono>}
            <div className="mt-2">{candidates.map(poolRow)}</div>
            {!onSpotify && poolPlaylist && poolTracks.length === 0 && <p className="pt-4 text-[13px] text-[var(--room-faint)]">Nothing in the pool matches.</p>}
          </section>
        </div>
      ) : plain ? (
        <div className="mt-8">
          <Mono className="mb-1 flex justify-between border-b border-[var(--room-hair)] pb-2 text-[var(--room-faint)]"><span>Newest first</span><span>{total}</span></Mono>
          {stillLoading && !playlist?.tracks?.items?.length && <Mono className="pt-4 text-[var(--room-faint)]">Loading</Mono>}
          {(playlist?.tracks?.items || []).filter((it) => it.track).slice().reverse().map((it, i, all) => trackRow(it.track, i, all.length - i))}
        </div>
      ) : (
        <div className="mt-8">
          {stillLoading && chunks.length === 0 && <Mono className="text-[var(--room-faint)]">Loading the batches</Mono>}
          {chunks.map((chunk, k) => {
            const name = collaborators[chunk.adderId]?.display_name || (chunk.adderId === profile?.id ? 'You' : partnerDisplayName) || chunk.adderId;
            return (
              <div key={`${chunk.adderId}-${chunk.addedAt}-${k}`}>
                <Mono className={`mb-1 flex justify-between border-b border-[var(--room-hair)] pb-2 text-[var(--room-faint)] ${k === 0 ? '' : 'mt-9'}`}><span>{name} · {formatBatchDate(chunk.addedAt)}</span><span>{chunk.tracks.length}</span></Mono>
                {chunk.tracks.map((item, i) => trackRow(item.track, i, i + 1))}
              </div>
            );
          })}
          {!stillLoading && chunks.length === 0 && <p className="text-[13px] text-[var(--room-faint)]">No batches yet. Build the first.</p>}
        </div>
      )}
    </div>
  );
}
