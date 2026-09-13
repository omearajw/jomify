import { create } from 'zustand';
import { fetchSpotifyUser } from '../services/spotify/api';

// One cache of other people's public profiles for the whole app. PlaylistView, the Sevens
// workspace and the Sevens settings page each used to fetch and hold their own copies of the
// same collaborators, so opening three screens fetched the same profile three times.
export const useUserProfilesStore = create((set) => ({
  profiles: {},
  setProfiles: (updates) => set((state) => ({ profiles: { ...state.profiles, ...updates } }))
}));

const inFlight = new Set();
const failed = new Set(); // ids Spotify refused; don't hammer them on every render

export async function ensureUserProfiles(token, ids) {
  if (!token) return;
  const known = useUserProfilesStore.getState().profiles;
  const wanted = [...new Set((ids || []).filter(Boolean))]
    .filter(id => !known[id] && !inFlight.has(id) && !failed.has(id));
  if (wanted.length === 0) return;

  wanted.forEach(id => inFlight.add(id));
  const results = await Promise.allSettled(wanted.map(id => fetchSpotifyUser(token, id)));
  const updates = {};
  results.forEach((result, i) => {
    const id = wanted[i];
    inFlight.delete(id);
    if (result.status === 'fulfilled' && result.value?.id) updates[result.value.id] = result.value;
    else failed.add(id);
  });
  if (Object.keys(updates).length) useUserProfilesStore.getState().setProfiles(updates);
}

export const useUserProfile = (id) => useUserProfilesStore((s) => (id ? s.profiles[id] : undefined));
