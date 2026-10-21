import { X } from 'lucide-react';
import { useFriendsView } from '../views/Friends/useFriendsView';

// Friends on the room's language: the field to paste a profile link with the one pill, the
// people you already share playlists with as rows to add, then your friends as rows on
// hairlines that open their profile. The logic is useFriendsView, shared with the old page;
// its errors arrive as toasts, which the room already draws in its own language.

const Mono = ({ children, className = '' }) => <p className={`room-mono ${className}`}>{children}</p>;
const Word = ({ onClick, children, disabled, label, tip }) => <button type="button" data-tip={tip} onClick={onClick} disabled={disabled} aria-label={label} className="ui-word">{children}</button>;
const Head = ({ children, first }) => <div className={`flex items-center justify-between border-b border-[var(--room-hair)] pb-2 ${first ? '' : 'mt-9'}`}><Mono className="text-[var(--room-faint)]">{children}</Mono></div>;

const Avatar = ({ image, name, size }) => (
  <span className="grid shrink-0 place-items-center overflow-hidden rounded-full bg-white/5 text-[13px] font-semibold text-[var(--room-dim)]" style={{ width: size, height: size }}>
    {image ? <img src={image} alt="" loading="lazy" decoding="async" draggable="false" className="h-full w-full object-cover" /> : String(name).charAt(0).toUpperCase()}
  </span>
);

export default function RoomFriends() {
  const { friends, input, setInput, adding, suggestions, addById, removeWithUndo, submit, faceOf, navigateToUser } = useFriendsView();

  return (
    <div className="relative pb-10" style={{ fontFamily: 'var(--font-room)' }}>
      <Mono className="text-[var(--room-faint)]">People{friends.length ? ` · ${friends.length} friend${friends.length === 1 ? '' : 's'}` : ''}</Mono>
      <h1 className="mt-2 text-[30px] font-semibold leading-[1.05] tracking-[-0.025em] text-[var(--room-paper)] @max-md:text-[26px]">Friends</h1>
      <p className="mt-3 max-w-xl text-[13px] text-[var(--room-dim)]">
        See a friend's public playlists and follow them. Spotify doesn't let apps list who you
        follow, so add people by their profile link: in Spotify, open a profile, tap the three
        dots, then Share, then Copy link.
      </p>

      <form onSubmit={submit} className="mt-6 flex max-w-2xl items-end gap-5 @max-md:flex-col @max-md:items-stretch @max-md:gap-4">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="A profile link, spotify:user:… or a user id"
          aria-label="Spotify profile link"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          className="ui-field min-w-0 flex-1"
        />
        <button type="submit" disabled={adding || !input.trim()} className="ui-pill shrink-0 @max-md:self-start">{adding ? 'Adding…' : 'Add friend'}</button>
      </form>

      {suggestions.length > 0 && (
        <>
          <Head>People from your playlists</Head>
          {suggestions.map((s, n) => (
            <div key={s.id} className="flex items-center gap-3 py-2.5 text-[13px]" style={{ borderTop: n ? '1px solid var(--room-hair)' : 'none' }}>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-[var(--room-paper)]/90">{s.name}</span>
                <span className="block truncate text-[11.5px] text-[var(--room-faint)]">{s.why}</span>
              </span>
              <Word onClick={() => addById(s.id)} disabled={adding} label={`Add ${s.name}`}>Add</Word>
            </div>
          ))}
        </>
      )}

      <Head first={false}>Your friends{friends.length ? ` · ${friends.length}` : ''}</Head>
      {friends.length === 0 && <p className="pt-3 text-[13px] text-[var(--room-faint)]">No friends yet. Paste a profile link above.</p>}
      {friends.map((friend, n) => {
        const { name, image, followers } = faceOf(friend);
        return (
          <div
            key={friend.id}
            role="button"
            tabIndex={0}
            onClick={() => navigateToUser(friend.id)}
            onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); navigateToUser(friend.id); } }}
            className="group flex cursor-pointer items-center gap-3 py-2.5 text-[13px] transition-colors hover:bg-white/[0.03]"
            style={{ borderTop: n ? '1px solid var(--room-hair)' : 'none' }}
          >
            <Avatar image={image} name={name} size={40} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-[var(--room-paper)]/90">{name}</span>
              {followers != null && <Mono className="mt-0.5 truncate text-[var(--room-faint)]">{followers.toLocaleString()} followers</Mono>}
            </span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); removeWithUndo(friend); }}
              aria-label={`Remove ${name}`}
              className="grid h-6 w-6 shrink-0 place-items-center text-[var(--room-faint)] opacity-0 hover:text-[var(--room-paper)] focus-visible:opacity-100 group-hover:opacity-100 pointer-coarse:h-10 pointer-coarse:w-10 pointer-coarse:opacity-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
