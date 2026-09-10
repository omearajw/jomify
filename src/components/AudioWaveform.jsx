import { motion } from 'framer-motion';

// The animated "instrumental" bars shown when lyrics have nothing to say. Two presets replace
// the two near-identical copies that lived in LyricsView (md) and ZenMode (lg).
const PRESETS = {
  md: {
    wrapper: 'flex items-end justify-center space-x-2 h-12 my-2',
    bar: 'w-2',
    idleOpacity: 0.3,
    outer: 'bg-white/40',
    brand: 'bg-[var(--brand-mid)] shadow-[0_0_15px_var(--brand-mid)]',
    centre: 'bg-white shadow-[0_0_15px_rgba(255,255,255,0.8)]',
    dimBrand: 'bg-white/30',
    dimCentre: 'bg-white/40'
  },
  lg: {
    wrapper: 'flex items-end justify-center space-x-3 h-16 my-4',
    bar: 'w-3 backdrop-blur-md',
    idleOpacity: 0.25,
    outer: 'bg-white/40 shadow-[0_0_15px_rgba(255,255,255,0.4)]',
    brand: 'bg-[var(--brand-mid)] shadow-[0_0_30px_var(--brand-mid),0_0_60px_var(--brand-mid)]',
    centre: 'bg-white shadow-[0_0_40px_rgba(255,255,255,1),0_0_80px_rgba(255,255,255,0.6)]',
    dimBrand: 'bg-white/20',
    dimCentre: 'bg-white/40'
  }
};

// Each bar's active/idle heights and timings, outermost to centre and back
const BARS = [
  { active: ['30%', '80%', '40%', '100%', '30%'], idle: ['15%', '25%', '15%'], activeDuration: 1.2, idleDuration: 3.5, kind: 'outer' },
  { active: ['50%', '100%', '30%', '90%', '50%'], idle: ['25%', '35%', '25%'], activeDuration: 1.5, idleDuration: 4.0, kind: 'brand' },
  { active: ['70%', '40%', '100%', '50%', '70%'], idle: ['35%', '45%', '35%'], activeDuration: 1.0, idleDuration: 3.2, kind: 'centre' },
  { active: ['100%', '50%', '80%', '30%', '100%'], idle: ['20%', '30%', '20%'], activeDuration: 1.4, idleDuration: 3.8, kind: 'brand' },
  { active: ['40%', '90%', '50%', '100%', '40%'], idle: ['15%', '20%', '15%'], activeDuration: 1.1, idleDuration: 4.2, kind: 'outer' }
];

export default function AudioWaveform({ isActive, size = 'md' }) {
  const p = PRESETS[size] || PRESETS.md;

  const colourFor = (kind) => {
    if (kind === 'outer') return p.outer;
    if (kind === 'centre') return isActive ? p.centre : p.dimCentre;
    return isActive ? p.brand : p.dimBrand;
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: isActive ? 1 : p.idleOpacity, scale: isActive ? 1 : 0.9 }}
      className={p.wrapper}
    >
      {BARS.map((bar, i) => (
        <motion.div
          key={i}
          animate={{ height: isActive ? bar.active : bar.idle }}
          transition={{ repeat: Infinity, duration: isActive ? bar.activeDuration : bar.idleDuration, ease: 'easeInOut' }}
          className={`${p.bar} rounded-full transition-colors duration-700 ${colourFor(bar.kind)}`}
        />
      ))}
    </motion.div>
  );
}
