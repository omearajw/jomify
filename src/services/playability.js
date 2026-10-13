// Rows a playlist page greyed out on the strength of a song's market list alone, confirmed with
// Spotify by id. The pages ask with the listener's market, but a page that ignores it sends no
// is_playable and only the original pressing's markets, which miss songs Spotify relinks and
// plays here without a word. So the greyed rows are asked about again, fifty at a time, and
// patched with what Spotify actually says.
import { fetchPlayability } from './spotify/api';
import { idsToCheck } from '../utils/spotifyUri';
import { log } from './debugLog';

// Ask about the greyed rows among these items; resolves to the answers (possibly none)
export async function confirmPlayability(token, items, country) {
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
