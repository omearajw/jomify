import { useEffect, useState } from 'react';
import { findLyrics } from '../../lib/lrc';

// The playing song's lyrics, for the phone's room: fetched only while they are shown, once per
// song. The answer carries the song it is for, so a late answer for the last song is never shown.
export function useNowLyrics(track, durationMs, enabled) {
  const id = track?.id || null;
  const [answer, setAnswer] = useState({ id: null, synced: null, plain: [] });
  // "finding" only for a lookup that is actually slow, so a quick one doesn't flash it
  const [slow, setSlow] = useState(null);
  useEffect(() => {
    if (!enabled || !track || !id) return undefined;
    const stop = new AbortController();
    const timer = setTimeout(() => setSlow(id), 700);
    findLyrics(track, durationMs ? durationMs / 1000 : null, { signal: stop.signal })
      .then((found) => setAnswer({ id, synced: found?.synced || null, plain: found?.synced ? [] : (found?.plain || []) }))
      .catch(() => { if (!stop.signal.aborted) setAnswer({ id, synced: null, plain: [] }); });
    return () => { clearTimeout(timer); stop.abort(); };
    // keyed on the song, not the track object, which changes on every position tick
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, enabled]);
  const mine = answer.id === id;
  return {
    loading: Boolean(enabled && id && !mine && slow === id),
    answered: mine,
    synced: mine ? answer.synced : null,
    plain: mine ? answer.plain : []
  };
}
