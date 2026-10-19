import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { usePlayerStore } from '../../store/playerStore';
import { useUserStore } from '../../store/userStore';
import { findLyrics } from '../../lib/lrc';
import { seek } from '../../services/spotify/playbackController';
import { useSlice } from '../../store/selectors';

// The lyrics page's logic, shared by the old page (LyricsView.jsx) and the room's (RoomLyrics.jsx).

// findLyrics rejects with this exact message (lrc.js NOT_FOUND) when the song has no lyrics; any
// other rejection is a lookup that failed and is worth asking again, since failures aren't cached
const NOT_FOUND = "We couldn't find lyrics for this song.";

// `bottomGap` is the space kept under the page when it is fitted to its scroll box: a number of
// pixels, or 'padding' for the box's own bottom padding (so the box never scrolls by a few pixels)
export function useLyricsView({ minHeight = 320, bottomGap = 16 } = {}) {
  const { playbackState } = useSlice(usePlayerStore, ['playbackState']);
  const goBack = useUserStore((s) => s.goBack);
  const currentTrack = playbackState?.track_window?.current_track;
  const albumArt = currentTrack?.album?.images?.[0]?.url || '';

  // Full screen on this page alone, without Zen mode; Escape leaves full screen as usual
  const containerRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === containerRef.current && Boolean(containerRef.current));
    document.addEventListener('fullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    };
  }, []);
  // The page fits the visible area, so its lyrics scroll inside it and the header stays: sized by
  // its content instead, the whole page scrolled to centre a line and took the header with it
  const [fitHeight, setFitHeight] = useState(null);
  useLayoutEffect(() => {
    const root = containerRef.current;
    if (!root) return undefined;
    let box = root.parentElement;
    while (box && !/(auto|scroll)/.test(getComputedStyle(box).overflowY)) box = box.parentElement;
    if (!box) return undefined;
    const measure = () => {
      const top = root.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
      const gap = bottomGap === 'padding' ? parseFloat(getComputedStyle(box).paddingBottom) || 0 : bottomGap;
      setFitHeight(Math.max(minHeight, Math.floor(box.clientHeight - top - gap)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, [minHeight, bottomGap]);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else containerRef.current?.requestFullscreen?.().catch(() => {});
  };
  const close = () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    goBack();
  };

  const [plainLyrics, setPlainLyrics] = useState([]);
  const [syncedLyrics, setSyncedLyrics] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Which song the lyrics above are the answer for, and where they came from: until the first
  // answer lands, the empty state above belongs to no song and must not read as "none found"
  const [answer, setAnswer] = useState({ id: null, timing: null, source: null });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  // Cancellation matters here: skip tracks quickly and a slow response for track A used to
  // land after track B's and paint B with A's lyrics. Every state write is guarded.
  useEffect(() => {
    if (!currentTrack) return;
    let cancelled = false;
    const stop = new AbortController();
    const id = currentTrack.id;
    // Used to pick the right VERSION -- the first search hit is often a live cut or a remix
    const trackDurationSec = playbackState?.duration ? playbackState.duration / 1000 : null;

    const fetchLyrics = async () => {
      setLoading(true);
      setError('');
      setPlainLyrics([]);
      setSyncedLyrics(null);

      try {
        const found = await findLyrics(currentTrack, trackDurationSec, { signal: stop.signal });
        if (cancelled) return;
        if (found.synced) setSyncedLyrics(found.synced);
        else setPlainLyrics(found.plain);
        setAnswer({ id, timing: found.timing || null, source: found.source || null });
      } catch (err) {
        if (cancelled) return;
        console.error("Lyrics Engine Error:", err);
        setError(err.message || "Failed to load lyrics.");
        setAnswer({ id, timing: null, source: null });
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchLyrics();
    return () => { cancelled = true; stop.abort(); };
  // Deliberately keyed on the track id, not the track object or playbackState.duration: those
  // change on every position tick and would refetch lyrics several times a second
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.id, attempt]);

  const handleSeek = (timeMs) => { seek(timeMs); };

  return {
    currentTrack, albumArt, containerRef, fitHeight, isFullscreen, toggleFullscreen, close,
    plainLyrics, syncedLyrics, loading, error, notFound: error === NOT_FOUND, retry,
    answeredFor: answer.id, timing: answer.id === currentTrack?.id ? answer.timing : null, source: answer.id === currentTrack?.id ? answer.source : null,
    handleSeek
  };
}
