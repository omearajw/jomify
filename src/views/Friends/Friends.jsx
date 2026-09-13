import { useEffect, useMemo, useState } from 'react';
import { UserPlus, X, Loader2, Users } from 'lucide-react';
import { useUserStore } from '../../store/userStore';
import { useSlice } from '../../store/selectors';
import { useUserProfilesStore, ensureUserProfiles } from '../../store/userProfilesStore';
import { fetchSpotifyUser } from '../../services/spotify/api';
import { userIdFromInput } from '../../utils/spotifyUri';
import { toast } from '../../store/toastStore';
import { artUrl } from '../../utils/images';
import { rowButtonProps } from '../../utils/a11y';

// Spotify's API can't list who you follow or search for people, so friends are added by
// pasting a profile link. People you already share playlists with are offered as shortcuts.
export default function Friends() {
  const { token, profile, friends, sevens, addFriend, removeFriend, navigateToUser } = useSlice(useUserStore, [
    'token', 'profile', 'friends', 'sevens', 'addFriend', 'removeFriend', 'navigateToUser'
  ]);
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
    Object.values(profiles).forEach((p) => {
      if (p?.id && !seen.has(p.id)) seen.set(p.id, { id: p.id, name: p.display_name || p.id, why: 'Playlist collaborator' });
    });
    return [...seen.values()].filter(s => s.id !== profile?.id && !friendIds.has(s.id));
  }, [sevens, profiles, profile?.id, friends]);

  const addById = async (id) => {
    if (!token) return;
    if (id === profile?.id) { toast("That's you", { tone: 'info' }); return; }
    setAdding(true);
    try {
      const user = await fetchSpotifyUser(token, id);
      addFriend(user);
      useUserProfilesStore.getState().setProfiles({ [user.id]: user });
      setInput('');
      toast(`Added ${user.display_name || user.id}`, { tone: 'success' });
    } catch {
      toast("Couldn't find that Spotify user", { tone: 'error' });
    } finally {
      setAdding(false);
    }
  };

  const submit = (e) => {
    e.preventDefault();
    const id = userIdFromInput(input);
    if (!id) { toast("That doesn't look like a Spotify profile link", { tone: 'error' }); return; }
    addById(id);
  };

  return (
    <div className="flex flex-col pb-8 animate-fade-in">
      <p className="text-xs font-bold text-neutral-400 uppercase tracking-widest mb-2">People</p>
      <h1 className="text-4xl md:text-5xl font-extrabold text-white tracking-tighter mb-2">Friends</h1>
      <p className="text-neutral-400 text-sm max-w-xl mb-8">
        See a friend's public playlists and follow them. Spotify doesn't let apps list who you
        follow, so add people by their profile link: in Spotify, open a profile, tap the three
        dots, then Share, then Copy link.
      </p>

      <form onSubmit={submit} className="flex flex-col sm:flex-row gap-3 mb-10 max-w-2xl">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Paste a Spotify profile link, spotify:user:… or a user id"
          spellCheck={false}
          className="flex-1 rounded-full bg-neutral-900 border border-white/10 px-5 py-3 text-sm text-white placeholder:text-neutral-500 focus:border-[#f91362] outline-none focus:ring-2 focus:ring-[#f91362]/20"
        />
        <button
          type="submit"
          disabled={adding || !input.trim()}
          className="flex items-center justify-center gap-2 rounded-full bg-brand-gradient px-6 py-3 text-sm font-bold text-white hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        >
          {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />} Add friend
        </button>
      </form>

      {suggestions.length > 0 && (
        <section className="mb-10">
          <h2 className="text-xs font-bold text-neutral-400 uppercase tracking-widest mb-3">People you already share playlists with</h2>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => addById(s.id)}
                disabled={adding}
                title={s.why}
                className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white hover:bg-white/10 transition-colors disabled:opacity-50"
              >
                <UserPlus className="w-3.5 h-3.5 text-neutral-400" />
                <span className="truncate max-w-[12rem]">{s.name}</span>
                <span className="text-[10px] uppercase tracking-wider text-neutral-500">{s.why}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-xs font-bold text-neutral-400 uppercase tracking-widest mb-3">Your friends ({friends.length})</h2>
        {friends.length === 0 ? (
          <div className="w-full border-2 border-dashed border-white/10 rounded-2xl p-10 flex flex-col items-center justify-center text-neutral-500">
            <Users className="w-10 h-10 mb-3 opacity-50" />
            <p className="text-sm text-center">No friends yet. Paste a profile link above.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {friends.map((friend) => {
              const live = profiles[friend.id];
              const name = live?.display_name || friend.name || friend.id;
              const image = artUrl(live?.images, 160) || friend.image;
              return (
                <div
                  key={friend.id}
                  onClick={() => navigateToUser(friend.id)}
                  {...rowButtonProps(() => navigateToUser(friend.id))}
                  className="relative bg-neutral-800/40 hover:bg-neutral-800 p-4 rounded-xl cursor-pointer transition-colors group flex flex-col items-center text-center"
                >
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); removeFriend(friend.id); }}
                    aria-label={`Remove ${name}`}
                    className="absolute top-2 right-2 w-8 h-8 rounded-full flex items-center justify-center text-neutral-500 hover:text-white hover:bg-white/10 opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100 transition-opacity"
                  >
                    <X className="w-4 h-4" />
                  </button>
                  {image ? (
                    <img src={image} alt="" loading="lazy" decoding="async" className="w-24 h-24 rounded-full object-cover shadow-lg mb-3" />
                  ) : (
                    <div className="w-24 h-24 rounded-full bg-neutral-700 flex items-center justify-center text-3xl font-bold text-white shadow-lg mb-3">
                      {String(name).charAt(0).toUpperCase()}
                    </div>
                  )}
                  <p className="text-sm font-bold text-white truncate w-full">{name}</p>
                  {live?.followers?.total != null && (
                    <p className="text-xs text-neutral-400 mt-0.5">{live.followers.total.toLocaleString()} followers</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
