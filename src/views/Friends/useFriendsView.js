import { useEffect, useMemo, useState } from 'react';
import { useUserStore } from '../../store/userStore';
import { useSlice } from '../../store/selectors';
import { useUserProfilesStore, ensureUserProfiles } from '../../store/userProfilesStore';
import { fetchSpotifyUser } from '../../services/spotify/api';
import { userIdFromInput } from '../../utils/spotifyUri';
import { toast } from '../../store/toastStore';
import { artUrl } from '../../utils/images';
import { scanCollaborators, knownCollaborators } from '../../services/collaborators';

// Everything the Friends page does, with no markup. The old page (Friends.jsx) and the room's
// (src/room/RoomFriends.jsx) are two faces on it.
// Spotify's API can't list who you follow or search for people, so friends are added by
// pasting a profile link. People you already share playlists with are offered as shortcuts.
export function useFriendsView() {
  const { token, profile, friends, sevens, playlists, addFriend, removeFriend, navigateToUser } = useSlice(useUserStore, [
    'token', 'profile', 'friends', 'sevens', 'playlists', 'addFriend', 'removeFriend', 'navigateToUser'
  ]);
  // people you share a collaborative playlist with: what is known at once, then read afresh
  const [sharers, setSharers] = useState(() => knownCollaborators(profile?.id));
  const sharedKey = (playlists || []).filter((p) => p?.collaborative).map((p) => `${p.id}:${p.snapshot_id || ''}`).join(',');
  useEffect(() => {
    if (!token || !profile?.id || !sharedKey) return undefined;
    let gone = false;
    scanCollaborators(token, useUserStore.getState().playlists, profile.id).then((found) => { if (!gone) setSharers(found); }).catch(() => {});
    return () => { gone = true; };
  }, [token, profile?.id, sharedKey]);
  useEffect(() => {
    const friendIds = new Set(friends.map((f) => f.id));
    ensureUserProfiles(token, Object.keys(sharers).filter((id) => !friendIds.has(id)).slice(0, 20));
  }, [token, sharers, friends]);
  const profiles = useUserProfilesStore((s) => s.profiles);
  const [input, setInput] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    ensureUserProfiles(token, friends.map(f => f.id));
  }, [token, friends]);

  const suggestions = useMemo(() => {
    const friendIds = new Set(friends.map(f => f.id));
    const seen = new Map();
    sevens.forEach((seven) => {
      if (seven.partnerId) seen.set(seven.partnerId, { id: seven.partnerId, name: seven.partnerName || seven.partnerId, why: 'Sevens partner' });
    });
    // shared collaborative playlists, most shared first: "adds to Road trips with you"
    Object.entries(sharers)
      .sort((a, b) => b[1].length - a[1].length || b[1].reduce((n, x) => n + x.songs, 0) - a[1].reduce((n, x) => n + x.songs, 0))
      .forEach(([id, where]) => {
        const name = profiles[id]?.display_name || id;
        const first = where[0]?.name || 'a playlist';
        const why = where.length > 1 ? `Shares ${first} and ${where.length - 1} more with you` : `Shares ${first} with you`;
        const before = seen.get(id);
        seen.set(id, { id, name: before?.name && before.name !== id ? before.name : name, why: before ? `${before.why} · ${why}` : why });
      });
    Object.values(profiles).forEach((p) => {
      if (p?.id && !seen.has(p.id)) seen.set(p.id, { id: p.id, name: p.display_name || p.id, why: 'Playlist collaborator' });
    });
    return [...seen.values()].filter(s => s.id !== profile?.id && !friendIds.has(s.id));
  }, [sevens, profiles, profile?.id, friends, sharers]);

  const addById = async (id) => {
    if (!token) return;
    if (id === profile?.id) { toast("That's you", { tone: 'info' }); return; }
    const already = friends.find((f) => f.id === id);
    if (already) { toast(`${already.name || id} is already a friend`, { tone: 'info' }); setInput(''); return; }
    setAdding(true);
    try {
      const user = await fetchSpotifyUser(token, id);
      addFriend(user);
      useUserProfilesStore.getState().setProfiles({ [user.id]: user });
      setInput('');
      toast(`Added ${user.display_name || user.id}`, { tone: 'success' });
    } catch (err) {
      toast(err?.message === 'RATE_LIMITED' ? 'Spotify is rate-limiting requests; try again in a moment' : "Couldn't find that Spotify user", { tone: 'error' });
    } finally {
      setAdding(false);
    }
  };

  const removeWithUndo = (friend) => {
    removeFriend(friend.id);
    toast(`Removed ${friend.name || friend.id}`, { action: { label: 'Undo', onClick: () => addFriend(friend) } });
  };

  const submit = (e) => {
    e.preventDefault();
    const id = userIdFromInput(input);
    if (id?.shortLink) {
      toast('Short spotify.link links can\'t be read here. Open it in Spotify and copy the profile link from there.', { tone: 'error', duration: 7000 });
      return;
    }
    if (!id) { toast("That doesn't look like a Spotify profile link", { tone: 'error' }); return; }
    addById(id);
  };

  // The stored friend is only who they were when added; the live profile, once fetched, wins
  const faceOf = (friend) => {
    const live = profiles[friend.id];
    return {
      name: live?.display_name || friend.name || friend.id,
      image: artUrl(live?.images, 160) || friend.image,
      followers: live?.followers?.total ?? null
    };
  };

  return { token, profile, friends, profiles, input, setInput, adding, suggestions, addById, removeWithUndo, submit, faceOf, navigateToUser };
}
