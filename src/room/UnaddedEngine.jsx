import { useEffect } from 'react';
import { useUserStore } from '../store/userStore';
import { useUnaddedSuggestions } from '../views/Library/useUnaddedSuggestions';
import { useUnaddedStore, start, stop } from './unadded';
import { log } from '../services/debugLog';

// Mounted by the Room while Unadded is the view: starts the mode's logic (src/room/unadded.js)
// and feeds it the suggestions, which are a React hook of their own.
export default function UnaddedEngine({ pileId }) {
  const token = useUserStore((s) => s.token);
  const checkIds = useUserStore((s) => s.unaddedCheckPlaylists);
  const pile = useUnaddedStore((s) => s.pile);
  const playlists = useUserStore((s) => s.playlists);
  const { suggestionsByTrack, targets, status } = useUnaddedSuggestions({ token, enabled: Boolean(pileId), checkPlaylistIds: checkIds, items: pile });

  useEffect(() => {
    if (!pileId || !token) return undefined;
    start(pileId);
    return stop;
  }, [pileId, token]);

  // Every check playlist is a target from the start; the profiles only decide which are suggested
  useEffect(() => { log('unadded', 'suggestions', `${status}, ${checkIds.length} check playlists, ${targets.length} profiled`); }, [status, checkIds.length, targets.length]);
  useEffect(() => {
    useUnaddedStore.setState({
      suggestionsByTrack,
      suggestionStatus: status,
      targets: checkIds.map((id) => ({ id, name: targets.find((t) => t.id === id)?.name || playlists.find((p) => p.id === id)?.name || 'Playlist', images: playlists.find((p) => p.id === id)?.images }))
    });
  }, [suggestionsByTrack, targets, status, checkIds, playlists]);

  return null;
}
