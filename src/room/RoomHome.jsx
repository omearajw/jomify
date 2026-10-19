import { Play } from 'lucide-react';
import { useHomeView } from '../views/Home/useHomeView';
import { artUrl } from '../utils/images';
import { rowButtonProps } from '../utils/a11y';
import { isPile } from '../utils/unaddedSync';
import RoomStats from './RoomStats';
import RoomJumpBackIn from './RoomJumpBackIn';

// Home on the room's language: the head as a profile's (a round avatar, the facts, your name,
// then Your profile, Stats and Settings as words), then whose turn it is in each Seven as rows on
// hairlines, what you were last in and your pins as bare covers, and friends as round faces.
// The logic is useHomeView, shared with the old page.

const Mono = ({ children, className = '' }) => <p className={`room-mono ${className}`}>{children}</p>;
const Word = ({ onClick, children, lit, label }) => <button type="button" onClick={onClick} aria-pressed={lit} aria-label={label} className="ui-word">{children}</button>;
const Head = ({ children, right, covers }) => (
  <div className={`mt-10 flex items-center justify-between gap-4 border-b border-[var(--room-hair)] pb-2 @max-md:mt-8 ${covers ? 'mb-4' : 'mb-1'}`}>
    <Mono className="min-w-0 truncate text-[var(--room-faint)]">{children}</Mono>
    {right}
  </div>
);

const PlayDisc = ({ onPlay, name }) => (
  <button type="button" onClick={(e) => { e.stopPropagation(); onPlay(); }} aria-label={`Play ${name}`} className="absolute bottom-2 right-2 grid h-9 w-9 place-items-center rounded-full bg-[var(--room-paper)] text-[#0a0810] opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100" style={{ transitionDuration: 'var(--room-mid)' }}>
    <Play className="ml-0.5 h-4 w-4 fill-current" />
  </button>
);

// A folder has no cover of its own: its first four things as a mosaic, or the first alone
function FolderArt({ covers }) {
  if (!covers?.length) return null;
  if (covers.length < 4) return <img src={artUrl(covers[0], 300)} alt="" loading="lazy" decoding="async" draggable="false" className="h-full w-full object-cover" />;
  return (
    <div className="grid h-full w-full grid-cols-2 grid-rows-2">
      {covers.map((images, n) => <img key={n} src={artUrl(images, 150)} alt="" loading="lazy" decoding="async" draggable="false" className="h-full w-full object-cover" />)}
    </div>
  );
}

function PinCover({ pin, drag, onRetry }) {
  if (pin.failed) {
    return (
      <div className="min-w-0">
        <div className="grid aspect-square w-full place-items-center rounded-[4px] bg-white/[0.03] p-4 text-center">
          <p className="text-[12.5px] text-[var(--room-dim)]">Couldn't load this {pin.pinned.type}.</p>
        </div>
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
          <Word onClick={onRetry}>Try again</Word>
          <Word onClick={pin.unpin}>Unpin</Word>
        </p>
      </div>
    );
  }
  return (
    <div onClick={pin.open} {...rowButtonProps(pin.open)} onContextMenu={pin.openMenu} {...drag} className="group min-w-0 cursor-pointer">
      <div className="relative aspect-square w-full overflow-hidden rounded-[4px] bg-white/5">
        {pin.pinned.type === 'folder'
          ? <FolderArt covers={pin.covers} />
          : pin.images?.length > 0 && <img src={artUrl(pin.images, 300)} alt="" loading="lazy" decoding="async" draggable="false" className="h-full w-full object-cover" />}
        {pin.play && <PlayDisc onPlay={pin.play} name={pin.title} />}
      </div>
      <p className="mt-2 truncate text-[13px] font-medium text-[var(--room-paper)]/90">{pin.title}</p>
      <Mono className="mt-0.5 truncate text-[var(--room-faint)]">{[pin.kind, pin.detail].filter(Boolean).join(' · ')}</Mono>
    </div>
  );
}

const Avatar = ({ image, name, size }) => (
  <span className="grid shrink-0 place-items-center overflow-hidden rounded-full bg-white/5 text-[15px] font-semibold text-[var(--room-dim)]" style={{ width: size, height: size }}>
    {image ? <img src={image} alt="" loading="lazy" decoding="async" draggable="false" className="h-full w-full object-cover" /> : String(name).charAt(0).toUpperCase()}
  </span>
);

const GRID = { gridTemplateColumns: 'repeat(auto-fill, minmax(min(132px, 40%), 1fr))' };

export default function RoomHome() {
  const {
    profile, playlists, showStats, toggleStats, activeSevenTurns, openTurn,
    friends, navigateToUser, openProfile, openFriends, openAccount,
    pinnedCount, pins, retryPins, pinDragProps
  } = useHomeView();

  if (!profile) return <Mono className="pt-6 text-[var(--room-faint)]">Loading</Mono>;

  const name = profile.display_name || profile.id;
  const avatar = artUrl(profile.images, 336);
  const playlistCount = playlists.filter((p) => !isPile(p)).length;
  // Followers and the plan are fields Spotify removed for apps like Jomify in 2026; each shows
  // only while the account still receives it
  const facts = [
    'Profile',
    profile.followers?.total != null ? `${profile.followers.total.toLocaleString()} follower${profile.followers.total === 1 ? '' : 's'}` : null,
    playlistCount ? `${playlistCount} playlist${playlistCount === 1 ? '' : 's'}` : null,
    profile.product || null
  ].filter(Boolean).join(' · ');

  return (
    <div className="relative min-h-full pb-12" style={{ fontFamily: 'var(--font-room)' }}>
      <header className="flex items-end gap-7 pt-4 @max-md:flex-col @max-md:items-start @max-md:gap-4">
        <button type="button" onClick={openProfile} aria-label="Your profile" className="grid h-[168px] w-[168px] shrink-0 place-items-center overflow-hidden rounded-full bg-white/5 text-[56px] font-semibold text-[var(--room-dim)] @max-md:h-[120px] @max-md:w-[120px] @max-md:text-[40px]">
          {avatar ? <img src={avatar} alt="" draggable="false" className="h-full w-full object-cover" /> : name.charAt(0).toUpperCase()}
        </button>
        <div className="min-w-0 flex-1 pb-1">
          <Mono className="text-[var(--room-faint)]">{facts}</Mono>
          <h1 className="mt-2 break-words text-[34px] font-semibold leading-[1.05] tracking-[-0.025em] text-[var(--room-paper)] [text-wrap:balance] @max-md:text-[26px]">{name}</h1>
          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
            <Word onClick={openProfile}>Your profile</Word>
            <Word onClick={toggleStats} lit={showStats}>Stats</Word>
            <Word onClick={openAccount}>Settings</Word>
          </div>
        </div>
      </header>

      {showStats && <RoomStats />}

      {activeSevenTurns.length > 0 && (
        <section>
          <Head>Your turn · {activeSevenTurns.length}</Head>
          {activeSevenTurns.map((turn, n) => (
            <div key={turn.id} className="flex items-center gap-4 py-3" style={{ borderTop: n ? '1px solid var(--room-hair)' : undefined }}>
              <button type="button" onClick={() => openTurn(turn.id)} className="group flex min-w-0 flex-1 items-center gap-3 text-left">
                <span className="h-[44px] w-[44px] shrink-0 overflow-hidden rounded-[4px] bg-white/5">{turn.images?.length > 0 && <img src={artUrl(turn.images, 44)} alt="" loading="lazy" decoding="async" draggable="false" className="h-full w-full object-cover" />}</span>
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-semibold text-[var(--room-paper)]">{turn.name || 'A Seven'}</span>
                  <span className="block truncate text-[12.5px] text-[var(--room-dim)] transition-colors group-hover:text-[var(--room-paper)]" style={{ transitionDuration: 'var(--room-mid)' }}>
                    {turn.empty
                      ? "Nothing in it yet, so you're up first."
                      : turn.partnerName ? `${turn.partnerName} just finished their drop.` : 'Your collaborator just finished their drop.'}
                  </span>
                </span>
              </button>
              <span className="shrink-0"><Word onClick={() => openTurn(turn.id)} label={`Open the workspace for ${turn.name || 'this Seven'}`}>Open the workspace</Word></span>
            </div>
          ))}
        </section>
      )}

      <RoomJumpBackIn />

      <section>
        <Head covers right={<Word onClick={openFriends}>{friends.length ? 'See all' : 'Add friends'}</Word>}>Friends{friends.length ? ` · ${friends.length}` : ''}</Head>
        {friends.length > 0 ? (
          <div className="-mx-1 flex gap-4 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {friends.slice(0, 12).map((friend) => {
              const label = friend.name || friend.id;
              return (
                <button key={friend.id} type="button" onClick={() => navigateToUser(friend.id)} className="group flex w-[72px] shrink-0 flex-col items-center gap-2">
                  <Avatar image={friend.image} name={label} size={56} />
                  <span className="w-full truncate text-center text-[11.5px] text-[var(--room-dim)] transition-colors group-hover:text-[var(--room-paper)]" style={{ transitionDuration: 'var(--room-mid)' }}>{label}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-[13px] text-[var(--room-faint)]">Add people to see their public playlists and follow them.</p>
        )}
      </section>

      <section>
        <Head covers>Pinned{pinnedCount ? ` · ${pinnedCount}` : ''}</Head>
        {pinnedCount === 0 ? (
          <p className="max-w-md text-[13px] text-[var(--room-faint)]">Nothing pinned yet. Right-click (or long-press) a playlist, album or folder and choose "Pin to Home".</p>
        ) : (
          <div className="grid gap-x-5 gap-y-6 @max-md:gap-x-4" style={GRID}>
            {pins.map((pin) => <PinCover key={pin.key} pin={pin} drag={pin.failed ? null : pinDragProps(pin.index)} onRetry={retryPins} />)}
          </div>
        )}
      </section>
    </div>
  );
}
