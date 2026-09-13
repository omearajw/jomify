import { useUserStore } from '../store/userStore';
import { useUserProfile } from '../store/userProfilesStore';
import { artUrl } from '../utils/images';

const SIZES = {
  sm: { avatar: 'w-6 h-6 text-[10px]', name: 'text-xs', gap: 'space-x-2' },
  md: { avatar: 'w-10 h-10 text-sm', name: 'text-lg font-bold tracking-tight', gap: 'gap-4' },
  lg: { avatar: 'w-16 h-16 text-xl', name: 'text-xl font-bold', gap: 'gap-4' }
};

// Avatar (or initial) plus display name for another Spotify user, resolved from the shared
// profile cache with `fallbackName` shown until the profile arrives. Clicking opens their page.
export default function UserChip({ userId, fallbackName, size = 'sm', showName = true, className = '', onClick }) {
  const navigateToUser = useUserStore((s) => s.navigateToUser);
  const profile = useUserProfile(userId);
  const s = SIZES[size] || SIZES.sm;
  const name = profile?.display_name || fallbackName || userId || '?';
  const image = artUrl(profile?.images, size === 'lg' ? 64 : size === 'md' ? 40 : 24);

  const open = (e) => {
    e.stopPropagation();
    if (onClick) onClick(userId);
    else if (userId) navigateToUser(userId);
  };

  return (
    <button
      type="button"
      onClick={open}
      title={name}
      className={`flex items-center ${s.gap} min-w-0 text-left rounded-full hover:opacity-90 transition-opacity ${className}`}
    >
      {image ? (
        <img src={image} alt="" loading="lazy" decoding="async" className={`${s.avatar} rounded-full object-cover shrink-0`} />
      ) : (
        <div className={`${s.avatar} rounded-full bg-neutral-700 flex items-center justify-center font-bold text-white shrink-0`}>
          {String(name).charAt(0).toUpperCase()}
        </div>
      )}
      {showName && <span className={`${s.name} text-neutral-300 truncate`}>{name}</span>}
    </button>
  );
}
