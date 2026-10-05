// Shared lyrics helpers. LyricsView and ZenMode each carried their own copy of these, and the
// copies had already drifted: one applied a 300ms lead-in when picking the active line and the
// other didn't, so the two views highlighted different lines for the same song.

// How far ahead of the timestamp a line lights up. Slightly early reads as "in time"; exactly
// on time reads as late, because the eye needs a moment to find the new line.
export const LYRIC_LEAD_IN_MS = 300;

export function parseLrc(lrcString) {
  const lines = lrcString.split('\n');
  const synced = [];
  const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/;

  lines.forEach((line) => {
    const match = timeRegex.exec(line);
    if (!match) return;

    const min = parseInt(match[1], 10);
    const sec = parseInt(match[2], 10);
    const msRaw = match[3];
    const ms = msRaw.length === 2 ? parseInt(msRaw, 10) * 10 : parseInt(msRaw, 10);

    synced.push({
      timeMs: (min * 60000) + (sec * 1000) + ms,
      text: line.replace(timeRegex, '').trim()
    });
  });

  return synced;
}

// lrclib returns several versions of a song; prefer the one whose length matches what's
// actually playing, within a tolerance. Falls back to the first hit when nothing is close.
export function pickClosestByDuration(results, durationSec, toleranceSec = 10) {
  if (!Array.isArray(results) || results.length === 0) return null;
  if (!durationSec) return results[0];

  let best = results[0];
  let bestDiff = Infinity;
  for (const candidate of results) {
    if (typeof candidate.duration !== 'number') continue;
    const diff = Math.abs(candidate.duration - durationSec);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = candidate;
    }
  }
  return bestDiff <= toleranceSec ? best : results[0];
}

// One search for both the Lyrics page and Zen mode. They used to search differently: Zen
// trimmed "feat." and fell back to a second database, the page did neither, so the same song
// had lyrics in one and not the other. Resolves {synced, plain} and rejects with a message
// the view can show.
export async function findLyrics(track, durationSec) {
  const artist = track?.artists?.[0]?.name || '';
  const title = String(track?.name || '').split(/[-()]/)[0].replace(/feat\..*/i, '').trim();
  if (!artist || !title) throw new Error("We couldn't find lyrics for this song.");
  const query = encodeURIComponent(`${artist} ${title}`);

  let reachedAnything = false;
  try {
    const res = await fetch(`https://lrclib.net/api/search?q=${query}`);
    if (res.ok) {
      reachedAnything = true;
      const data = await res.json();
      const best = pickClosestByDuration(data, durationSec);
      if (best?.syncedLyrics) return { synced: parseLrc(best.syncedLyrics), plain: [] };
      if (best?.plainLyrics) return { synced: null, plain: best.plainLyrics.split('\n') };
    }
  } catch { /* try the next one */ }

  try {
    const res = await fetch(`https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`);
    if (res.ok) {
      reachedAnything = true;
      const data = await res.json();
      if (data?.lyrics) return { synced: null, plain: data.lyrics.replace(/Paroles de la chanson .+\r?\n/i, '').split('\n') };
    }
  } catch { /* fall through */ }

  throw new Error(reachedAnything
    ? "We couldn't find lyrics for this song in the open databases."
    : 'Could not reach the public lyrics databases.');
}
