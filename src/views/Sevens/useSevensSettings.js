import { useEffect, useMemo, useRef, useState } from 'react';
import { useUserStore } from '../../store/userStore';
import { useSlice } from '../../store/selectors';
import {
  fetchPlaylistDetails,
  fetchSevenTrackMeta,
  fetchSpotifyUser,
  detectPartnerCandidates
} from '../../services/spotify/api';

// Everything the Sevens page does, with no markup: which playlists are Sevens, who each is
// with (worked out from who added what, or set by hand), the pool, active or finished. The old
// page (SevensSettings.jsx) and the room's surface (src/room/RoomSevensPage.jsx) share it.
export function useSevensSettings() {
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

  return {
    token, profile, playlists, sevens, addSeven, removeSeven, updateSeven, navigateToPlaylist, query, setQuery, isPickerOpen, setIsPickerOpen, details, setDetails, candidates, setCandidates, users, setUsers, analysing, setAnalysing, confirmRemove, setConfirmRemove, analysedRef, fetchedUserIds, sevenIds, analyseSeven, getPlaylist, partnerLabel, availablePlaylists, activeSevens, finishedSevens
  };
}
