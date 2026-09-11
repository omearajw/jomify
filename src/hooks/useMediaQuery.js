import { useSyncExternalStore } from 'react';

// Only for cases where a different component tree has to mount (tab bar vs sidebar, sheet vs
// column). Style-only differences belong in Tailwind `md:` / `pointer-coarse:` classes.
export function useMediaQuery(query) {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false),
    () => false
  );
}

// Aligned with Tailwind's `md` breakpoint so the hook and the classes never disagree
export const MOBILE_QUERY = '(max-width: 767px)';
export const useIsMobile = () => useMediaQuery(MOBILE_QUERY);
export const useIsCoarsePointer = () => useMediaQuery('(pointer: coarse)');

export const isMobileViewport = () =>
  typeof window !== 'undefined' && Boolean(window.matchMedia?.(MOBILE_QUERY).matches);
