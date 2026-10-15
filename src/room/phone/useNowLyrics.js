import { useEffect, useState } from 'react';
import { findLyrics } from '../../lib/lrc';

// The playing song's lyrics, for the phone's room: fetched only while they are shown, once per
// song. The answer carries the song it is for, so a late answer for the last song is never shown.
export function useNowLyrics(track, durationMs, enabled) {
  const id = track?.id || null;
  const [answer, setAnswer] = useState({ id: null, synced: null, plain: [] });
  useEffect(() => {
    if (!enabled || !track || !id) return undefined;
    const stop = new AbortController();
    findLyrics(track, durationMs ? durationMs / 1000 : null, { signal: stop.signal })
      .then((found) => setAnswer({ id, synced: found?.synced || null, plain: found?.synced ? [] : (found?.plain || []) }))
      .catch(() => { if (!stop.signal.aborted) setAnswer({ id, synced: null, plain: [] }); });
    return () => stop.abort();
    // keyed on the song, not the track object, which changes on every position tick
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, enabled]);
  const mine = answer.id === id;
  return {
    loading: Boolean(enabled && id && !mine),
    synced: mine ? answer.synced : null,
    plain: mine ? answer.plain : []
  };
}
