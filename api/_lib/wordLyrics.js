// Spicy Lyrics' answer reduced to what Jomify draws: lines with their times and, where the sync
// has them, each word's (or syllable's) start and end. Times arrive in seconds and leave in ms.
//
//   { type: 'words' | 'lines', source, lines: [{ timeMs, endMs, text, words?: [{ text, startMs, endMs, joined }] }] }
//
// `joined` marks a syllable that continues the word before it, so no space goes between them.
// (Spicy flags the other end: the syllable that runs on into the next.)
// Background vocals are left out: Jomify shows one voice. Null when there is nothing timed.

const ms = (s) => Math.round(Number(s) * 1000);

export function normalizeSpicy(payload) {
  const body = payload?.Body ?? payload;
  const content = Array.isArray(body?.Content) ? body.Content : null;
  if (!content) return null;
  const source = body.source || null;

  if (body.Type === 'Syllable') {
    const lines = [];
    for (const entry of content) {
      const syllables = entry?.Lead?.Syllables;
      if (!Array.isArray(syllables) || syllables.length === 0) continue;
      // IsPartOfWord says a syllable runs on into the next one ("paci" before "fy"), so a syllable
      // is joined to the one before it when that one carries the flag
      const kept = syllables.filter((s) => typeof s?.Text === 'string' && s.Text.trim() !== '' && Number.isFinite(Number(s.StartTime)));
      const words = kept.map((s, i) => ({ text: s.Text.trim(), startMs: ms(s.StartTime), endMs: ms(s.EndTime ?? s.StartTime), joined: i > 0 && Boolean(kept[i - 1].IsPartOfWord) }));
      if (words.length === 0) continue;
      const text = words.reduce((out, w, i) => (i === 0 ? w.text : out + (w.joined ? '' : ' ') + w.text), '');
      lines.push({ timeMs: ms(entry.Lead.StartTime ?? syllables[0].StartTime), endMs: ms(entry.Lead.EndTime ?? words[words.length - 1].endMs / 1000), text, words });
    }
    return lines.length ? { type: 'words', source, lines } : null;
  }

  if (body.Type === 'Line') {
    const lines = content
      .filter((l) => typeof l?.Text === 'string' && l.Text.trim() !== '' && Number.isFinite(Number(l.StartTime)))
      .map((l) => ({ timeMs: ms(l.StartTime), endMs: ms(l.EndTime ?? l.StartTime), text: l.Text.trim() }));
    return lines.length ? { type: 'lines', source, lines } : null;
  }

  return null;
}
