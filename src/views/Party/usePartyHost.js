import { useEffect, useRef, useState } from 'react';
import { useUserStore } from '../../store/userStore';
import { usePlayerStore } from '../../store/playerStore';
import { usePartyStore } from '../../store/partyStore';
import { useSlice, usePlaybackSummary } from '../../store/selectors';
import { hostApi, partyLink } from '../../party/client';
import { startConductor, stopConductor, heartbeat, isConducting } from '../../party/conductor';
import { setShuffle } from '../../services/spotify/playbackController';
import { startPlaying } from '../../queue/play';
import { searchSpotify, playContext } from '../../services/spotify/api';
import { artUrl } from '../../utils/images';
import { isPile } from '../../utils/unaddedSync';
import { toast } from '../../store/toastStore';


const slim = (t) => ({ uri: t.uri, id: t.id, name: t.name, artists: (t.artists || []).map((a) => a.name).join(', '), image: artUrl(t.album?.images, 96) || null, durationMs: t.duration_ms || 0 });

// Everything the host's view does, with no markup: the party's state, starting and ending it,
// the ops (add, pin, remove, block, settings), the song search, the volume. The old page
// (PartyMode.jsx) and the room's surface (src/room/RoomParty.jsx) are two faces on it.
export function usePartyHost() {
  const { token, profile, playlists } = useSlice(useUserStore, ['token', 'profile', 'playlists']);
  const savedVolume = useUserStore((s) => s.savedVolume);
  const { code, party, queue, upNext, history, guestCount, conductor, hostAway, error, skipping, applyState, setCode, clear } = useSlice(usePartyStore, ['code', 'party', 'queue', 'upNext', 'history', 'guestCount', 'conductor', 'hostAway', 'error', 'skipping', 'applyState', 'setCode', 'clear']);
  const { currentPlayingTrack: track, isCurrentTrackPaused: paused } = usePlaybackSummary();
  const { isLocalActive, remoteVolume, activeDevice } = useSlice(usePlayerStore, ['isLocalActive', 'remoteVolume', 'activeDevice']);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [copied, setCopied] = useState(false);
  const [endArmed, setEndArmed] = useState(false);
  const [showPlaylists, setShowPlaylists] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [blockArmed, setBlockArmed] = useState(null); // a guest id, waiting for the second tap
  const blocked = usePartyStore((s) => s.blocked);
  const dormant = usePartyStore((s) => s.dormant);
  const rejoinChecked = usePartyStore((s) => s.rejoinChecked);
  const searchTimer = useRef(null);

  // the Unadded pile is Jomify's working list, shown nowhere but Unadded (DESIGN.md §8)
  const pickable = playlists.filter((p) => !isPile(p));
  const own = pickable.filter((p) => p.owner?.id === profile?.id || p.collaborative);
  const choices = own.length ? own : pickable;

  // The conductor runs whether or not this page is open; opening it just makes sure
  useEffect(() => {
    // Only once the launch check has spoken: a party left open from earlier waits for Resume
    // rather than starting because the app happened to reopen on this page
    if (code && token && rejoinChecked && !dormant && !isConducting()) startConductor();
    else if (code && token) heartbeat();
  }, [code, token, rejoinChecked, dormant]);

  useEffect(() => {
    clearTimeout(searchTimer.current);
    const q = query.trim();
    if (!token || q.length < 2) return undefined;
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await searchSpotify(token, q);
        setResults((res?.tracks?.items || []).slice(0, 8).map(slim));
      } catch { setResults([]); }
    }, 350);
    return () => clearTimeout(searchTimer.current);
  }, [query, token]);
  const shownResults = query.trim().length < 2 ? null : results;

  const start = async (backing) => {
    setBusy(true);
    try {
      const u = useUserStore.getState();
      const { party: created } = await hostApi.create({ hostName: profile?.display_name || 'The host', backing: { uri: `spotify:playlist:${backing.id}`, name: backing.name, image: artUrl(backing.images, 200) || null }, token: u.token, tokenExpiresAt: u.tokenExpiresAt });
      setCode(created.code);
      startConductor();
      // Off we go: the backing playlist, shuffled, wherever Spotify plays
      await startPlaying({ uri: `spotify:playlist:${backing.id}`, kind: 'playlist', name: backing.name, shuffle: true },
        async (deviceId) => { await playContext(token, deviceId, `spotify:playlist:${backing.id}`, 0); await setShuffle(true, deviceId).catch(() => {}); });
    } catch (err) {
      toast(err?.message || "Couldn't start the party", { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const op = async (body, okText) => {
    try {
      const res = await hostApi.op(code, body);
      if (res?.queue) applyState({ ...res, conductor });
      if (okText) toast(okText, { tone: 'success' });
      return res;
    } catch (err) {
      toast(err?.message || 'That did not work', { tone: 'error' });
      return null;
    }
  };

  const end = async () => {
    if (!endArmed) { setEndArmed(true); setTimeout(() => setEndArmed(false), 4000); return; }
    await op({ op: 'end' });
    stopConductor();
    clear();
    toast('Party over. Thanks for hosting.', { tone: 'info' });
  };

  const copyLink = async () => {
    const link = partyLink(code);
    try {
      if (navigator.share) { await navigator.share({ title: 'Join my Jomify party', text: `Request songs at my party: ${link}`, url: link }); return; }
      await navigator.clipboard.writeText(link);
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    } catch { /* cancelled share */ }
  };

  const changeBacking = async (p) => {
    const backing = { uri: `spotify:playlist:${p.id}`, name: p.name, image: artUrl(p.images, 200) || null };
    setShowPlaylists(false);
    await op({ op: 'settings', backing });
    await startPlaying({ uri: backing.uri, kind: 'playlist', name: backing.name, shuffle: true },
      async (deviceId) => { await playContext(token, deviceId, backing.uri, 0); await setShuffle(true, deviceId).catch(() => {}); });
  };

  const volume = isLocalActive ? savedVolume : (remoteVolume ?? activeDevice?.volumePercent ?? 50);

  return {
    token, profile, playlists, savedVolume, code, party, queue, upNext, history, guestCount, conductor, hostAway, error, skipping, applyState, setCode, clear, track, paused, isLocalActive, remoteVolume, activeDevice, busy, setBusy, query, setQuery, results, setResults, copied, setCopied, endArmed, setEndArmed, showPlaylists, setShowPlaylists, showQr, setShowQr, blockArmed, setBlockArmed, blocked, dormant, rejoinChecked, searchTimer, own, choices, shownResults, start, op, end, copyLink, changeBacking, volume
  };
}
