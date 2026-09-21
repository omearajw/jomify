// Placeholders shaped like the content they stand in for, so nothing jumps when it lands. Used
// only for what is genuinely still loading; anything already in the store is shown for real.

export function Skeleton({ className = '' }) {
  return <div aria-hidden="true" className={`rounded bg-white/[0.06] animate-pulse ${className}`} />;
}

// Track rows: art, two lines of text, a heart and (desktop) a duration
export function SkeletonRows({ count = 8, art = true }) {
  return (
    <div className="flex flex-col" aria-hidden="true" aria-busy="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-center gap-3 md:gap-4 px-2 md:px-4 py-2.5 md:py-3">
          {art && <Skeleton className="w-10 h-10 md:w-12 md:h-12 rounded-md shrink-0" />}
          <div className="flex-1 min-w-0 space-y-2">
            <Skeleton className="h-3.5 w-1/2 max-w-[16rem]" />
            <Skeleton className="h-3 w-1/3 max-w-[10rem]" />
          </div>
          <Skeleton className="w-5 h-5 rounded-full shrink-0" />
          <Skeleton className="hidden md:block w-8 h-3 shrink-0" />
        </div>
      ))}
    </div>
  );
}

// Library cards: square art with a name and a line beneath
export function SkeletonCards({ count = 8, gridClass = '' }) {
  return (
    <div className={`grid ${gridClass}`} aria-hidden="true" aria-busy="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-xl bg-white/[0.03] p-4">
          <Skeleton className="w-full aspect-square rounded-lg mb-3" />
          <Skeleton className="h-3.5 w-3/4 mb-2" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

// A page header with nothing known yet: art beside a title and a meta line
export function SkeletonHeader({ round = false }) {
  return (
    <div className="flex flex-row items-center md:items-end gap-4 md:gap-6 mb-6 md:mb-12" aria-hidden="true" aria-busy="true">
      <Skeleton className={`w-24 h-24 md:w-48 md:h-48 shrink-0 ${round ? 'rounded-full' : 'rounded-lg'}`} />
      <div className="flex-1 min-w-0 space-y-3">
        <Skeleton className="hidden md:block h-3 w-16" />
        <Skeleton className="h-7 md:h-12 w-2/3 max-w-md" />
        <Skeleton className="h-3.5 w-1/3 max-w-[12rem]" />
      </div>
    </div>
  );
}
