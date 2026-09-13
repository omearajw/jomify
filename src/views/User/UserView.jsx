import { useEffect, useState } from 'react';
import { UserPlus, UserMinus, UserCheck, Loader2, ExternalLink } from 'lucide-react';
import { useUserStore } from '../../store/userStore';
import { useSlice } from '../../store/selectors';
import { useUserProfilesStore } from '../../store/userProfilesStore';
import { fetchSpotifyUser, fetchUserPublicPlaylists, checkFollowingUsers, followUsers, unfollowUsers } from '../../services/spotify/api';
import { toast } from '../../store/toastStore';
import { artUrl } from '../../utils/images';
import { rowButtonProps } from '../../utils/a11y';

// Another Spotify user's page: who they are, their public playlists, and Follow. Everything
// here is fetched live; only the friend's identity is stored.
export default function UserView() {
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

  if (!currentUserId) return <p className="text-neutral-400 mt-8">No profile selected.</p>;
  if (!current) return <p className="text-neutral-400 animate-pulse text-lg mt-8">Loading profile…</p>;
  if (!user) return <p className="text-neutral-400 mt-8">{current.error}</p>;

  const name = user.display_name || user.id;
  const avatar = artUrl(user.images, 192);

  return (
    <div className="flex flex-col pb-8 animate-fade-in">
      <div className="flex flex-col md:flex-row md:items-end gap-4 md:gap-6 mb-8 md:mb-12">
        {avatar ? (
          <img src={avatar} alt="" className="w-40 h-40 md:w-48 md:h-48 rounded-full object-cover shadow-2xl shrink-0" />
        ) : (
          <div className="w-40 h-40 md:w-48 md:h-48 rounded-full bg-neutral-700 flex items-center justify-center text-6xl font-bold text-white shadow-2xl shrink-0">
            {name.charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <p className="text-sm font-bold text-neutral-400 uppercase tracking-widest mb-2">Profile</p>
          <h1 className="text-4xl md:text-6xl font-extrabold text-white tracking-tighter mb-3 break-words">{name}</h1>
          <p className="text-neutral-400 font-medium mb-4">
            {user.followers?.total != null ? `${user.followers.total.toLocaleString()} followers` : ''}
            {current.playlists.length ? ` • ${current.playlists.length} public playlist${current.playlists.length === 1 ? '' : 's'}` : ''}
          </p>
          {!isMe && (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={toggleFollow}
                disabled={busy || current.following === null}
                aria-pressed={Boolean(current.following)}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold transition-all disabled:opacity-60 ${
                  current.following ? 'bg-white/10 border border-white/15 text-white hover:bg-white/15' : 'bg-brand-gradient text-white shadow-brand-glow hover:scale-105'
                }`}
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : current.following ? <UserCheck className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
                {current.following ? 'Following' : 'Follow'}
              </button>
              <button
                type="button"
                onClick={() => (isFriend ? removeFriend(currentUserId) : addFriend(user))}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold border border-white/20 text-white hover:bg-white/10 transition-colors"
              >
                {isFriend ? <UserMinus className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
                {isFriend ? 'Remove friend' : 'Add friend'}
              </button>
              <a
                href={`https://open.spotify.com/user/${encodeURIComponent(currentUserId)}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-neutral-400 hover:text-white transition-colors"
              >
                <ExternalLink className="w-4 h-4" /> Open in Spotify
              </a>
            </div>
          )}
          {current.followError && <p className="text-xs text-amber-300 mt-3 max-w-md">{current.followError}</p>}
        </div>
      </div>

      <h2 className="text-2xl font-bold text-white mb-6">Public playlists</h2>
      {current.playlists.length === 0 ? (
        <p className="text-neutral-500">No public playlists.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {current.playlists.map((pl) => (
            <div
              key={pl.id}
              onClick={() => navigateToPlaylist(pl.id)}
              {...rowButtonProps(() => navigateToPlaylist(pl.id))}
              className="bg-neutral-800/30 p-4 rounded-xl cursor-pointer hover:bg-neutral-800/60 transition-colors group"
            >
              <div className="aspect-square bg-neutral-700 rounded-md mb-3 overflow-hidden shadow-md flex items-center justify-center">
                {pl.images?.[0]?.url
                  ? <img src={artUrl(pl.images, 300)} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                  : <span className="text-3xl">🎵</span>}
              </div>
              <p className="text-white text-sm font-bold truncate w-full">{pl.name}</p>
              <p className="text-neutral-400 text-xs truncate w-full mt-0.5">{pl.tracks?.total != null ? `${pl.tracks.total} tracks` : 'Playlist'}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
