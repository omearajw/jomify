import { useEffect, useState } from 'react';
import { useUserStore } from '../../store/userStore';
import { useSlice } from '../../store/selectors';
import { useUserProfilesStore } from '../../store/userProfilesStore';
import { fetchSpotifyUser, fetchUserPublicPlaylists, checkFollowingUsers, followUsers, unfollowUsers } from '../../services/spotify/api';
import { toast } from '../../store/toastStore';

// Another Spotify user's page, with no markup: who they are, their public playlists, Follow and
// friend. Everything here is fetched live; only the friend's identity is stored. The old page
// (UserView.jsx) and the room's (src/room/RoomUser.jsx) are two faces on it.
export function useUserView() {
  const { token, profile, currentUserId, friends, addFriend, removeFriend, navigateToPlaylist } = useSlice(useUserStore, [
    'token', 'profile', 'currentUserId', 'friends', 'addFriend', 'removeFriend', 'navigateToPlaylist'
  ]);

  // One state slot keyed by user id, so switching users derives "loading" instead of needing
  // a synchronous reset inside the effect
  const [page, setPage] = useState(null); // { id, user, playlists, following, followError, error }
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token || !currentUserId) return undefined;
    let cancelled = false;
    (async () => {
      let user = null;
      let error = '';
      try {
        user = await fetchSpotifyUser(token, currentUserId);
        useUserProfilesStore.getState().setProfiles({ [user.id]: user });
      } catch {
        error = "Couldn't load this profile. It may not exist, or Spotify may be rate-limiting Jomify.";
      }
      const [playlistsResult, followingResult] = user
        ? await Promise.allSettled([fetchUserPublicPlaylists(token, currentUserId), checkFollowingUsers(token, [currentUserId])])
        : [];
      if (cancelled) return;
      const followError = followingResult?.status === 'rejected'
        ? (followingResult.reason?.status === 403
          ? 'Following needs a permission Jomify was given after you signed in. Disconnect Account, then sign in again to enable it.'
          : "Couldn't check whether you follow them.")
        : '';
      setPage({
        id: currentUserId,
        user,
        error,
        playlists: playlistsResult?.status === 'fulfilled' ? playlistsResult.value : [],
        following: followingResult?.status === 'fulfilled' ? Boolean(followingResult.value?.[0]) : null,
        followError
      });
    })();
    return () => { cancelled = true; };
  }, [token, currentUserId]);

  const current = page?.id === currentUserId ? page : null;
  const user = current?.user;
  const isMe = currentUserId && profile?.id === currentUserId;
  const isFriend = friends.some(f => f.id === currentUserId);

  const toggleFollow = async () => {
    if (!token || !current || current.following === null || busy) return;
    const wasFollowing = current.following;
    setBusy(true);
    setPage(p => ({ ...p, following: !wasFollowing }));
    try {
      if (wasFollowing) await unfollowUsers(token, [currentUserId]);
      else await followUsers(token, [currentUserId]);
      toast(wasFollowing ? `Unfollowed ${user?.display_name || currentUserId}` : `Following ${user?.display_name || currentUserId}`, { tone: 'success' });
    } catch (err) {
      setPage(p => ({ ...p, following: wasFollowing }));
      toast(err?.status === 403 ? 'Sign in again to enable Follow (Disconnect Account, then reconnect).' : "Couldn't update follow", { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const toggleFriend = () => {
    if (!user) return;
    if (!isFriend) { addFriend(user); return; }
    const friend = friends.find((f) => f.id === currentUserId);
    removeFriend(currentUserId);
    toast(`Removed ${friend?.name || user.display_name || currentUserId}`, { action: { label: 'Undo', onClick: () => addFriend(friend || user) } });
  };

  return { token, profile, currentUserId, current, user, isMe, isFriend, busy, toggleFollow, toggleFriend, navigateToPlaylist };
}
