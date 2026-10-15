// Rows a playlist page greyed out on the strength of a song's market list alone, confirmed with
// Spotify by id. The pages ask with the listener's market, but a page that ignores it sends no
// is_playable and only the original pressing's markets, which miss songs Spotify relinks and
// plays here without a word. So the greyed rows are asked about again, fifty at a time, and
// patched with what Spotify actually says.
import { fetchPlayability } from './spotify/api';
import { idsToCheck, availabilitySource, isUnplayable, unplayableWhy } from '../utils/spotifyUri';
import { log } from './debugLog';

// One line per page in the debug log: how many songs Spotify answered for itself and how many
// only the release's market list decided (the weaker word), and each song that can't play with
// its reason. That says which way a disagreement with Spotify's app runs. It costs no request:
// it reads what the page already brought.
function logPage(items, country) {
  const tracks = (items || []).map((it) => it?.track).filter(Boolean);
  if (!tracks.length) return;
  const count = { spotify: 0, markets: 0, unknown: 0, local: 0 };
  for (const t of tracks) count[availabilitySource(t)] += 1;
  const blocked = tracks.filter((t) => isUnplayable(t, country));
  const fromList = tracks.filter((t) => availabilitySource(t) === 'markets' && !isUnplayable(t, country));
  const name = (t) => `${t.name || '?'}${t.artists?.[0]?.name ? ` (${t.artists[0].name})` : ''}`;
  const parts = [
    `${tracks.length} songs: Spotify answered ${count.spotify}, the market list decided ${count.markets}${count.unknown ? `, no word on ${count.unknown}` : ''}${count.local ? `, ${count.local} local` : ''}`,
    blocked.length ? `can't play: ${blocked.slice(0, 8).map((t) => `${name(t)}: ${unplayableWhy(t, country)}${t.restrictions?.reason ? ` [${t.restrictions.reason}]` : ''}`).join('; ')}${blocked.length > 8 ? `; and ${blocked.length - 8} more` : ''}` : null,
    fromList.length ? `shown as playable on the market list alone: ${fromList.slice(0, 8).map(name).join('; ')}${fromList.length > 8 ? `; and ${fromList.length - 8} more` : ''}` : null
  ].filter(Boolean);
  log('playback', 'availability on this page', parts.join('. '));
}

// Ask about the greyed rows among these items; resolves to the answers (possibly none)
export async function confirmPlayability(token, items, country) {
  logPage(items, country);
  const ids = idsToCheck(items, country);
  if (!ids.length) return {};
  try {
    const answers = await fetchPlayability(token, ids);
    const plays = ids.filter((id) => answers[id]?.is_playable).length;
    log('playback', 'availability', `${ids.length} rows greyed by the market list; Spotify plays ${plays} of them here`);
    return answers;
  } catch (err) {
    log('playback', 'availability check failed', err?.message || String(err));
    return {};
  }
}
