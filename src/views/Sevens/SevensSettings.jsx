import { useEffect, useMemo, useRef, useState } from 'react';
import { useUserStore } from '../../store/userStore';
import { useSlice } from '../../store/selectors';
import { artUrl } from '../../utils/images';
import {
  fetchPlaylistDetails,
  fetchSevenTrackMeta,
  fetchSpotifyUser,
  detectPartnerCandidates
} from '../../services/spotify/api';
import ConfirmDialog from '../../components/ConfirmDialog';
import { Plus, Search, Trash2, Loader2, RefreshCw, Users, CheckCircle2, Archive } from 'lucide-react';
import NotificationToggle from '../../components/NotificationToggle';
import { motion, AnimatePresence } from 'framer-motion';

// A Seven is a collaborative playlist you trade batches of seven tracks on with one other
// person. This page is where you tell Jomify which playlists are Sevens, who each one is
// with, and whether it is still running.
export default function SevensSettings() {
  const {
    token, profile, playlists, sevens,
    addSeven, removeSeven, updateSeven,
    navigateToPlaylist
  } = useSlice(useUserStore, ['token', 'profile', 'playlists', 'sevens', 'addSeven', 'removeSeven', 'updateSeven', 'navigateToPlaylist']);

  const [query, setQuery] = useState('');
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  // Playlist metadata for Sevens that aren't in the user's own playlist list
  const [details, setDetails] = useState({});
  // playlistId -> [{ id, count }] of everyone who has added tracks except you
  const [candidates, setCandidates] = useState({});
  // Spotify user profiles, keyed by user id
  const [users, setUsers] = useState({});
  const [analysing, setAnalysing] = useState({});
  const [confirmRemove, setConfirmRemove] = useState(null);

  const analysedRef = useRef(new Set());
  const fetchedUserIds = useRef(new Set());

  const sevenIds = useMemo(() => new Set(sevens.map(s => s.playlistId)), [sevens]);

  // --- PLAYLIST METADATA FOR EACH SEVEN ---
  useEffect(() => {
    if (!token) return;

    sevens.forEach((seven) => {
      const fromLibrary = playlists.find(p => p.id === seven.playlistId);
      if (fromLibrary || details[seven.playlistId]) return;

      fetchPlaylistDetails(token, seven.playlistId)
        .then(data => setDetails(prev => ({ ...prev, [seven.playlistId]: data })))
        .catch(err => console.error('Failed to load Seven metadata:', err));
    });
  }, [token, sevens, playlists, details]);

  // --- PARTNER AUTO-DETECTION ---
  // Runs once per Seven per session. Whoever has added the most tracks that isn't you is
  // the partner, unless you have manually locked a different one.
  const analyseSeven = async (playlistId, { force = false } = {}) => {
    if (!token) return;
    if (!force && analysedRef.current.has(playlistId)) return;
    analysedRef.current.add(playlistId);

    setAnalysing(prev => ({ ...prev, [playlistId]: true }));
    try {
      const meta = await fetchSevenTrackMeta(token, playlistId);
      const found = detectPartnerCandidates(meta, profile?.id);
      setCandidates(prev => ({ ...prev, [playlistId]: found }));

      const seven = useUserStore.getState().sevens.find(s => s.playlistId === playlistId);
      if (seven && !seven.partnerLocked && found.length > 0 && found[0].id !== seven.partnerId) {
        updateSeven(playlistId, { partnerId: found[0].id });
      }

      // Pull display names for anyone we haven't seen yet
      const unknown = found.map(c => c.id).filter(id => !fetchedUserIds.current.has(id));
      unknown.forEach(id => fetchedUserIds.current.add(id));

      const profiles = await Promise.all(
        unknown.map(id => fetchSpotifyUser(token, id).catch(() => null))
      );
      const next = {};
      profiles.forEach(user => { if (user?.id) next[user.id] = user; });
      if (Object.keys(next).length > 0) setUsers(prev => ({ ...prev, ...next }));
    } catch (err) {
      console.error('Partner detection failed:', err);
      analysedRef.current.delete(playlistId);
    } finally {
      setAnalysing(prev => ({ ...prev, [playlistId]: false }));
    }
  };

  useEffect(() => {
    if (!token || !profile) return;
    sevens.forEach(seven => analyseSeven(seven.playlistId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, profile, sevens.length]);

  // Keep the cached partner name in the store in step with the profiles we've fetched, so
  // other views can label a partner without refetching.
  useEffect(() => {
    sevens.forEach((seven) => {
      if (!seven.partnerId) return;
      const user = users[seven.partnerId];
      const name = user?.display_name || user?.id;
      if (name && name !== seven.partnerName) {
        updateSeven(seven.playlistId, { partnerName: name });
      }
    });
  }, [users, sevens, updateSeven]);

  const getPlaylist = (playlistId) =>
    playlists.find(p => p.id === playlistId) || details[playlistId] || null;

  const partnerLabel = (seven) => {
    if (!seven.partnerId) return null;
    return users[seven.partnerId]?.display_name || seven.partnerName || seven.partnerId;
  };

  const availablePlaylists = useMemo(() => {
    const term = query.trim().toLowerCase();
    return playlists
      .filter(p => !sevenIds.has(p.id))
      .filter(p => !term || p.name?.toLowerCase().includes(term));
  }, [playlists, sevenIds, query]);

  const activeSevens = sevens.filter(s => s.active);
  const finishedSevens = sevens.filter(s => !s.active);

  const renderSevenCard = (seven) => {
    const playlist = getPlaylist(seven.playlistId);
    const partner = partnerLabel(seven);
    const partnerUser = seven.partnerId ? users[seven.partnerId] : null;
    const isAnalysing = analysing[seven.playlistId];
    const found = candidates[seven.playlistId] || [];

    return (
      <motion.div
        layout
        key={seven.playlistId}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97 }}
        className={`rounded-3xl border backdrop-blur-xl p-5 flex flex-col md:flex-row md:items-center gap-5 transition-colors ${
          seven.active
            ? 'bg-white/[0.03] border-white/10 hover:border-white/20'
            : 'bg-white/[0.01] border-white/5 hover:border-white/10'
        }`}
      >
        {/* Cover + identity */}
        <button
          type="button"
          onClick={() => { navigateToPlaylist(seven.playlistId); }}
          className="flex items-center gap-4 flex-1 min-w-0 text-left group"
        >
          <div className={`w-16 h-16 rounded-xl overflow-hidden bg-black/40 shrink-0 shadow-lg flex items-center justify-center ${seven.active ? '' : 'grayscale opacity-60'}`}>
            {playlist?.images?.[0]?.url
              ? <img src={artUrl(playlist.images, 128)} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
              : <span className="text-2xl">🎵</span>}
          </div>
          <div className="min-w-0">
            <h3 className="text-white font-bold text-lg truncate group-hover:underline">
              {playlist?.name || 'Loading…'}
            </h3>
            <div className="flex items-center gap-2 text-sm text-neutral-400 mt-0.5">
              {partnerUser?.images?.[0]?.url && (
                <img src={artUrl(partnerUser.images, 20)} alt="" width="20" height="20" loading="lazy" decoding="async" className="w-5 h-5 rounded-full object-cover" />
              )}
              {isAnalysing && !partner ? (
                <span className="flex items-center gap-1.5 text-neutral-500">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Working out who this is with…
                </span>
              ) : partner ? (
                <span className="truncate">with <span className="text-white font-medium">{partner}</span></span>
              ) : (
                <span className="text-amber-400/80">No partner yet — duplicate checking is off</span>
              )}
            </div>
          </div>
        </button>

        {/* Controls */}
        <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3 shrink-0 w-full md:w-auto">
          {/* Partner override */}
          <div className="flex items-center gap-1.5">
            <select
              value={seven.partnerId || ''}
              onChange={(e) => {
                const value = e.target.value;
                updateSeven(seven.playlistId, {
                  partnerId: value || null,
                  partnerLocked: Boolean(value),
                  partnerName: value ? (users[value]?.display_name || value) : null
                });
              }}
              title="Who this Seven is with"
              className="bg-black/50 border border-white/10 text-white text-xs rounded-lg px-2.5 py-2 outline-none focus:border-[var(--brand-mid)] max-w-full sm:max-w-[180px] font-medium"
            >
              <option value="">-- Partner --</option>
              {found.map(c => (
                <option key={c.id} value={c.id}>
                  {users[c.id]?.display_name || c.id} ({c.count})
                </option>
              ))}
              {/* Keep a manually set partner selectable even if they haven't added tracks yet */}
              {seven.partnerId && !found.some(c => c.id === seven.partnerId) && (
                <option value={seven.partnerId}>{partner}</option>
              )}
            </select>
            <button
              type="button"
              onClick={() => analyseSeven(seven.playlistId, { force: true })}
              title="Re-detect the partner from who has added tracks"
              className="p-2 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isAnalysing ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* Pool playlist */}
          <select
            value={seven.poolPlaylistId || ''}
            onChange={(e) => updateSeven(seven.playlistId, { poolPlaylistId: e.target.value })}
            title="The playlist you draft candidate tracks from"
            className="bg-black/50 border border-white/10 text-white text-xs rounded-lg px-2.5 py-2 outline-none focus:border-[var(--brand-mid)] max-w-full sm:max-w-[180px] font-medium"
          >
            <option value="">-- Pool playlist --</option>
            {playlists.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>

          {/* Active / finished */}
          <button
            type="button"
            onClick={() => updateSeven(seven.playlistId, { active: !seven.active })}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${
              seven.active
                ? 'bg-[var(--brand-mid)]/20 text-[var(--brand-light,#ff8e44)] border border-[var(--brand-mid)]/40 hover:bg-[var(--brand-mid)]/30'
                : 'bg-white/5 text-neutral-400 border border-white/10 hover:bg-white/10 hover:text-white'
            }`}
          >
            {seven.active ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
            {seven.active ? 'Active' : 'Finished'}
          </button>

          <button
            type="button"
            onClick={() => setConfirmRemove(seven.playlistId)}
            title="Stop treating this playlist as a Seven"
            className="p-2 rounded-lg text-neutral-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </motion.div>
    );
  };

  return (
    <div className="w-full max-w-[1400px] animate-fade-in pb-12">
      <div className="mb-10">
        <p className="text-sm font-bold text-neutral-400 uppercase tracking-widest mb-1">Settings</p>
        <h1 className="text-5xl md:text-6xl font-extrabold text-white tracking-tighter mb-3">Sevens</h1>
        <p className="text-neutral-400 font-medium max-w-2xl">
          Mark the collaborative playlists you trade batches of seven tracks on. Active Sevens
          tell you when it's your turn; finished ones stay quiet but are still checked so you
          never send the same person a track twice.
        </p>
      </div>

      <div className="mb-6 max-w-2xl"><NotificationToggle /></div>

      {/* Add a Seven */}
      <div className="mb-10">
        <button
          type="button"
          onClick={() => setIsPickerOpen(o => !o)}
          className="flex items-center gap-2 bg-brand-gradient text-white px-5 py-2.5 rounded-full text-sm font-bold shadow-brand-glow hover:scale-105 transition-transform"
        >
          <Plus className="w-4 h-4" /> Add a Seven
        </button>

        <AnimatePresence initial={false}>
          {isPickerOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: [0.04, 0.62, 0.23, 0.98] }}
              className="overflow-hidden"
            >
              <div className="mt-4 rounded-3xl bg-neutral-900/60 backdrop-blur-xl border border-white/10 p-5">
                <div className="relative mb-4">
                  <Search className="w-4 h-4 text-neutral-500 absolute left-4 top-1/2 -translate-y-1/2" />
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search your playlists…"
                    className="w-full bg-black/50 border border-white/10 rounded-full pl-11 pr-4 py-2.5 text-sm text-white outline-none focus:border-[var(--brand-mid)]"
                  />
                </div>

                <div className="max-h-72 overflow-y-auto space-y-1 pr-1">
                  {availablePlaylists.length === 0 ? (
                    <p className="text-neutral-500 text-sm font-medium py-6 text-center">
                      {playlists.length === 0 ? 'Your playlists are still loading…' : 'No playlists match that search.'}
                    </p>
                  ) : (
                    availablePlaylists.map(p => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          addSeven(p.id);
                          setQuery('');
                          setIsPickerOpen(false);
                        }}
                        className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-white/10 transition-colors text-left group"
                      >
                        <div className="w-10 h-10 rounded-lg overflow-hidden bg-black/40 shrink-0 flex items-center justify-center">
                          {p.images?.[0]?.url
                            ? <img src={artUrl(p.images, 48)} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                            : <span className="text-sm">🎵</span>}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold text-white truncate">{p.name}</p>
                          <p className="text-xs text-neutral-500 truncate">
                            {p.tracks?.total ?? 0} tracks{p.collaborative ? ' • Collaborative' : ''}
                          </p>
                        </div>
                        <Plus className="w-4 h-4 text-white/30 group-hover:text-white shrink-0 mr-2" />
                      </button>
                    ))
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {sevens.length === 0 ? (
        <div className="w-full border-2 border-dashed border-white/10 rounded-3xl p-16 flex flex-col items-center justify-center text-neutral-500 bg-neutral-900/20 backdrop-blur-sm">
          <Users className="w-10 h-10 mb-4 opacity-40" />
          <p className="font-medium text-lg text-white text-center">You haven't set up any Sevens yet.</p>
          <p className="text-sm mt-1 text-center">Add one above to unlock the workspace and duplicate checking.</p>
        </div>
      ) : (
        <div className="space-y-10">
          <section>
            <h2 className="text-xs font-bold text-neutral-400 uppercase tracking-widest mb-4">
              Active ({activeSevens.length})
            </h2>
            {activeSevens.length === 0 ? (
              <p className="text-neutral-500 text-sm font-medium">Nothing running right now.</p>
            ) : (
              <motion.div layout className="space-y-3">
                <AnimatePresence mode="popLayout">{activeSevens.map(renderSevenCard)}</AnimatePresence>
              </motion.div>
            )}
          </section>

          {finishedSevens.length > 0 && (
            <section>
              <h2 className="text-xs font-bold text-neutral-400 uppercase tracking-widest mb-4">
                Finished ({finishedSevens.length})
              </h2>
              <motion.div layout className="space-y-3">
                <AnimatePresence mode="popLayout">{finishedSevens.map(renderSevenCard)}</AnimatePresence>
              </motion.div>
            </section>
          )}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirmRemove)}
        title="Remove this Seven?"
        message="The playlist itself is untouched — Jomify just stops treating it as a Seven, so it loses the workspace and stops being cross-referenced for duplicates."
        confirmLabel="Remove"
        onConfirm={() => { removeSeven(confirmRemove); setConfirmRemove(null); }}
        onCancel={() => setConfirmRemove(null)}
      />
    </div>
  );
}
