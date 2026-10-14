// The last few playlists songs were added to, so they come first wherever a playlist is picked
const KEY = 'jomify_recent_targets';
export const recentTargets = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
export const noteTarget = (id) => { try { localStorage.setItem(KEY, JSON.stringify([id, ...recentTargets().filter((x) => x !== id)].slice(0, 5))); } catch { /* fine */ } };
