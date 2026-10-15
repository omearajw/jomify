import { useUserView } from '../views/User/useUserView';
import { shareSpotifyLink, spotifyLink } from '../services/share';
import { artUrl } from '../utils/images';

// Someone's profile on the room's language: the head (a round avatar, the facts, the name, then
// Follow, friend, Open in Spotify and Share as words), and their public playlists as covers that
// open in the layer. The logic is useUserView, shared with the old page.

const Mono = ({ children, className = '' }) => <p className={`room-mono ${className}`}>{children}</p>;
const Word = ({ onClick, children, lit, disabled, tip }) => <button type="button" data-tip={tip} onClick={onClick} disabled={disabled} aria-pressed={lit} className="ui-word">{children}</button>;
const Note = ({ children, warn }) => <p className={`mt-3 max-w-md text-[12.5px] ${warn ? 'text-[var(--room-dim)]' : 'text-[var(--room-faint)]'}`}>{children}</p>;
const Shell = ({ children }) => <div className="relative pb-10" style={{ fontFamily: 'var(--font-room)' }}>{children}</div>;

function Cover({ playlist, onOpen }) {
  return (
    <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }} className="group min-w-0 cursor-pointer">
      <div className="relative aspect-square w-full overflow-hidden rounded-[4px] bg-white/5">
        {playlist.images?.[0]?.url && <img src={artUrl(playlist.images, 300)} alt="" loading="lazy" decoding="async" draggable="false" className="h-full w-full object-cover" />}
      </div>
      <p className="mt-2 truncate text-[13px] font-medium text-[var(--room-paper)]/90">{playlist.name}</p>
      <Mono className="mt-0.5 truncate text-[var(--room-faint)]">{playlist.tracks?.total != null ? `${playlist.tracks.total} songs` : 'Playlist'}</Mono>
    </div>
  );
}

export default function RoomUser() {
  const { currentUserId, current, user, isMe, isFriend, busy, toggleFollow, toggleFriend, navigateToPlaylist } = useUserView();

  if (!currentUserId) return <Shell><Mono className="text-[var(--room-faint)]">No profile chosen</Mono></Shell>;
  if (!current) return <Shell><Mono className="text-[var(--room-faint)]">Loading the profile</Mono></Shell>;
  if (!user) return <Shell><p className="text-[13px] text-[var(--room-dim)]">{current.error}</p></Shell>;

  const name = user.display_name || user.id;
  const avatar = artUrl(user.images, 336);
  const count = current.playlists.length;
  const facts = [
    isMe ? 'Your profile' : 'Profile',
    user.followers?.total != null ? `${user.followers.total.toLocaleString()} follower${user.followers.total === 1 ? '' : 's'}` : null,
    count ? `${count} public playlist${count === 1 ? '' : 's'}` : null
  ].filter(Boolean).join(' · ');
  const partial = user.partial || current.playlists?.partial;

  return (
    <Shell>
      <header className="flex items-end gap-7 pt-4 @max-md:flex-col @max-md:items-start @max-md:gap-4">
        <div className="grid h-[168px] w-[168px] shrink-0 place-items-center overflow-hidden rounded-full bg-white/5 text-[56px] font-semibold text-[var(--room-dim)] @max-md:h-[120px] @max-md:w-[120px] @max-md:text-[40px]">
          {avatar ? <img src={avatar} alt="" draggable="false" className="h-full w-full object-cover" /> : name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1 pb-1">
          <Mono className="text-[var(--room-faint)]">{facts}</Mono>
          <h1 className="mt-2 break-words text-[34px] font-semibold leading-[1.05] tracking-[-0.025em] text-[var(--room-paper)] [text-wrap:balance] @max-md:text-[26px]">{name}</h1>
          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
            {!isMe && (<>
              <Word onClick={toggleFollow} disabled={busy || current.following === null} lit={Boolean(current.following)} tip={current.following ? 'Press to unfollow' : undefined}>{current.following ? 'Following' : 'Follow'}</Word>
              <Word onClick={toggleFriend}>{isFriend ? 'Remove friend' : 'Add friend'}</Word>
              <a href={spotifyLink('user', currentUserId)} target="_blank" rel="noreferrer" className="ui-word">Open in Spotify</a>
            </>)}
            <Word onClick={() => shareSpotifyLink('user', currentUserId, name)}>Share</Word>
          </div>
          {current.followError && <Note warn>{current.followError}</Note>}
          {partial && <Note warn>Spotify no longer shares other people's profiles with apps like Jomify; this is what Jomify already knew{current.playlists?.partial ? ', and only the playlists of theirs in your library' : ''}.</Note>}
          {isMe && <Note>This is you, as others see you.</Note>}
        </div>
      </header>

      <div className="mb-3 mt-9 border-b border-[var(--room-hair)] pb-2"><Mono className="text-[var(--room-faint)]">Public playlists{count ? ` · ${count}` : ''}</Mono></div>
      {count === 0 ? (
        <p className="text-[13px] text-[var(--room-faint)]">No public playlists.</p>
      ) : (
        <div className="grid gap-x-5 gap-y-6 @max-md:gap-x-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(132px, 40%), 1fr))' }}>
          {current.playlists.map((pl) => <Cover key={pl.id} playlist={pl} onOpen={() => navigateToPlaylist(pl.id)} />)}
        </div>
      )}
    </Shell>
  );
}
