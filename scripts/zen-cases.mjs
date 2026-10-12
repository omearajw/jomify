// Zen mode's pure parts: the cover's palette and which lyric lines are on stage, when and where.
import { paletteFromPixels, FALLBACK_PALETTE, SILVER, COOL_SILVER } from '../src/views/ZenMode/palette.js';
import { focusAt, fillProgress, lineAt, layoutFocus, isInstrumental, faceKey } from '../src/views/ZenMode/lyricFocus.js';
import { LYRIC_LEAD_IN_MS } from '../src/lib/lrc.js';
import { wordFill } from '../src/views/ZenMode/lyricFocus.js';
import { wordStops } from '../src/views/ZenMode/zenGl.js';
import { normalizeSpicy } from '../api/_lib/wordLyrics.js';

let pass = 0, fail = 0; const failures = [];
const check = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); console.log('  FAIL ', name); } };

const pixels = (spec) => { // [[r,g,b,count]]
  const out = [];
  for (const [r, g, b, n] of spec) for (let i = 0; i < n; i++) out.push(r, g, b, 255);
  return new Uint8Array(out);
};
const hueOf = ([r, g, b]) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); if (mx === mn) return -1; let h = mx === r ? ((g - b) / (mx - mn)) % 6 : mx === g ? (b - r) / (mx - mn) + 2 : (r - g) / (mx - mn) + 4; return (h * 60 + 360) % 360; };

{
  // Currents: mostly purple, a thin red line and a gold drip
  const p = paletteFromPixels(pixels([[150, 110, 200, 700], [230, 30, 60, 40], [240, 180, 40, 30], [20, 15, 25, 254]]));
  const h = hueOf(p[0]);
  check('a mostly purple cover leads with purple, not its thin red line', h > 250 && h < 300);
  check('the main colour is lifted to full brightness', Math.abs(Math.max(...p[0]) - 1) < 1e-9);
}
{
  const p = paletteFromPixels(pixels([[245, 245, 245, 900], [20, 20, 20, 124]]));
  check('a black-and-white cover is drawn in silver light', p[0] === SILVER && p[1] === COOL_SILVER);
}
{
  const p = paletteFromPixels(pixels([[30, 90, 220, 500], [220, 120, 30, 300], [10, 10, 10, 224]]));
  check('two strong hues: blue first, orange second', hueOf(p[0]) > 200 && hueOf(p[0]) < 240 && hueOf(p[1]) > 15 && hueOf(p[1]) < 45);
}
{
  const p = paletteFromPixels(pixels([[210, 30, 40, 120], [245, 245, 245, 800], [15, 15, 15, 104]]));
  check('one colour on white: that colour, with silver as the second shade', hueOf(p[0]) < 15 || hueOf(p[0]) > 345 ? p[1] === COOL_SILVER : false);
}
check('no pixels at all gives the fallback', paletteFromPixels(new Uint8Array(0)) === FALLBACK_PALETTE);

const L = [
  { timeMs: 5000, text: 'First line' },
  { timeMs: 9000, text: 'Second line' },
  { timeMs: 13000, text: '♪' },
  { timeMs: 30000, text: 'After the break' },
  { timeMs: 34000, text: 'Last line' },
];
const lead = LYRIC_LEAD_IN_MS;
check('isInstrumental: note, empty and "instrumental"', isInstrumental(L[2]) && isInstrumental({ text: '' }) && isInstrumental({ text: '(Instrumental)' }) && !isInstrumental(L[0]));
check('lineAt counts the lead-in', lineAt(L, 5000 - lead) === 0 && lineAt(L, 5000 - lead - 1) === -1);
{
  const f = focusAt(L, 1000);
  check('before the first line: a gap, waiting on line 0', f.gap && f.current === null && f.next === 0 && f.prev === null);
  check('…its dots run across the wait', Math.abs(focusAt(L, (5000 - lead) / 2).gapProgress - 0.5) < 0.01);
}
{
  const f = focusAt(L, 9500);
  check('mid-song: current, the line before and the line after', f.current === 1 && f.prev === 0 && f.next === 3 && !f.gap);
}
{
  const f = focusAt(L, 20000);
  check('an instrumental break is a gap: previous kept, next waiting', f.gap && f.current === null && f.prev === 1 && f.next === 3);
  check('…and the next line skips the ♪', focusAt(L, 9500).next === 3);
}
{
  const f = focusAt(L, 40000);
  check('the last line has no next', f.current === 4 && f.next === null && f.prev === 3);
}
check('fill: none before the line, done by its end', fillProgress(L, 0, 5000 - lead - 10) === 0 && fillProgress(L, 0, 8900) === 1);
{
  // "First line": 10 characters, so 850ms from 300ms before its time
  const at = (ms) => fillProgress(L, 0, 5000 - lead + ms);
  check('fill: part way through, part filled', at(300) > 0.2 && at(300) < 0.8);
  check('fill: eases out (ahead of a straight line, then slowing)', at(425) > 0.5 && at(425) - at(212) > at(637) - at(425));
}
check('fill: a line is done before the next starts', fillProgress(L, 3, 33900 - lead) === 1);
check('fill: nothing for no line', fillProgress(L, null, 9000) === 0);
{
  const box = { x: 100, y: 200, w: 800, h: 600 };
  const focus = { current: 1, prev: 0, next: 3, gap: false };
  const blocks = { [faceKey(0, 'small')]: { w: 400, h: 40 }, [faceKey(1, 'big')]: { w: 700, h: 180 }, [faceKey(3, 'small')]: { w: 500, h: 40 } };
  const t = layoutFocus({ focus, blocks, box, big: 80 });
  const cur = t[faceKey(1, 'big')], prev = t[faceKey(0, 'small')], next = t[faceKey(3, 'small')];
  check('the current line is its big face, centred in the box, glass', Math.abs(cur.y + 90 - 500) < 1e-9 && cur.glass === 1);
  check('the lines either side are small faces, soft', prev && next && prev.glass === 0 && next.glass === 0 && !t[faceKey(1, 'small')]);
  check('all left-aligned on the box edge', prev.x === 100 && cur.x === 100 && next.x === 100);
  check('previous above the current line, next below it', prev.y + 40 < cur.y && next.y > cur.y + 180);
  const gapT = layoutFocus({ focus: { current: null, prev: 1, next: 3, gap: true }, blocks, box, big: 80 });
  check('in a gap there is no big face on stage', Object.keys(gapT).sort().join() === '1:small,3:small');
}

// Word timings
{
  const spicy = { Body: { Type: 'Syllable', source: 'apple_music', Content: [
    { Type: 'Vocal', Lead: { StartTime: 1.0, EndTime: 2.5, Syllables: [
      { Text: 'May', IsPartOfWord: true, StartTime: 1.0, EndTime: 1.3 },
      { Text: 'be', IsPartOfWord: false, StartTime: 1.3, EndTime: 1.6 },
      { Text: 'you', IsPartOfWord: false, StartTime: 1.6, EndTime: 2.0 },
      { Text: ' ', IsPartOfWord: false, StartTime: 2.0, EndTime: 2.1 },
      { Text: 'know', IsPartOfWord: false, StartTime: 2.1, EndTime: 2.5 }] }, Background: [{ Syllables: [{ Text: 'ooh', StartTime: 1, EndTime: 2 }] }] },
    { Type: 'Vocal', Lead: { Syllables: [] } }] } };
  const n = normalizeSpicy(spicy);
  check('Spicy syllables: one line, joined syllables make one word', n.type === 'words' && n.lines.length === 1 && n.lines[0].text === 'Maybe you know');
  check('…times in ms, blank syllables and background vocals left out', n.lines[0].timeMs === 1000 && n.lines[0].endMs === 2500 && n.lines[0].words.length === 4 && n.lines[0].words[1].joined === true);
  // As Spicy sends it: the flag is on the syllable that runs on into the next
  const pac = normalizeSpicy({ Body: { Type: 'Syllable', Content: [{ Type: 'Vocal', Lead: { StartTime: 0, EndTime: 2, Syllables: [
    { Text: 'to', IsPartOfWord: false, StartTime: 0, EndTime: 0.5 }, { Text: 'paci', IsPartOfWord: true, StartTime: 0.5, EndTime: 1.2 }, { Text: 'fy', IsPartOfWord: false, StartTime: 1.2, EndTime: 2 }] } }] } });
  check('"paci" runs on into "fy": "to pacify", not "topaci fy"', pac.lines[0].text === 'to pacify');
  check('Spicy line sync keeps lines without words', normalizeSpicy({ Body: { Type: 'Line', Content: [{ Text: 'Hello', StartTime: 3, EndTime: 4 }] } }).lines[0].timeMs === 3000);
  check('static or empty answers are nothing', normalizeSpicy({ Body: { Type: 'Static', Lines: [] } }) === null && normalizeSpicy(null) === null);

  // Fake text measure: every character 10 wide
  const ctx = { measureText: (t) => ({ width: t.length * 10 }) };
  const words = n.lines[0].words;
  const rows = ['Maybe you', 'know']; // the line wrapped after "you"
  const stops = wordStops(ctx, rows, rows.map((r) => r.length * 10), words);
  const total = 130;
  check('word stops: "May" then "be" within the first row', Math.abs(stops[0].from) < 1e-9 && Math.abs(stops[0].to - 30 / total) < 1e-9 && Math.abs(stops[1].to - 50 / total) < 1e-9);
  check('…"you" ends the first row, "know" spans the second', Math.abs(stops[2].to - 90 / total) < 1e-9 && Math.abs(stops[3].from - 90 / total) < 1e-9 && Math.abs(stops[3].to - 1) < 1e-9);

  check('fill before the first word: nothing', wordFill(words, stops, 900) === 0);
  const mid = wordFill(words, stops, 1150);
  check('fill inside a word: part of it', mid > stops[0].from && mid < stops[0].to);
  check('fill between words rests at the last word sung', Math.abs(wordFill(words, stops, 2050) - stops[2].to) < 1e-9);
  check('fill after the last word: all of it', wordFill(words, stops, 3000) === 1);
  check('no words: no word fill (paced fill instead)', wordFill(undefined, stops, 1000) === null);
}
{
  // A long silence after a line's last word becomes a gap, a short one does not
  const W = [{ timeMs: 1000, endMs: 3000, text: 'One' }, { timeMs: 20000, endMs: 22000, text: 'Two' }, { timeMs: 23000, endMs: 24000, text: 'Three' }];
  check('right after a line ends it stays current', focusAt(W, 4000).current === 0);
  const g = focusAt(W, 9000);
  check('well into a long silence: a gap, waiting on the next line', g.gap && g.current === null && g.next === 1 && g.prev === 0);
  check('a short pause between lines is not a gap', focusAt(W, 22600).current === 1);
}

console.log(`\nzen: ${pass} passed, ${fail} failed`);
if (fail) { console.log(failures.join('\n')); process.exit(1); }
