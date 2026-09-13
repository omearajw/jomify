// Per-collaborator tinting for collaborative playlists. Both PlaylistView and PlaylistView_2
// carried a copy; this is the superset (the compact variant is used by the Sevens workspace).

export function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return hash;
}

// Generates the subtle, grungy glass styles based on group adjacency. Multiplying by the golden
// angle (137.508) spreads user hues as far apart as possible.
// getCollaboratorStyle returns a fresh object per call. Handing React a new style object for
// every row on every render defeats its diffing, so list rows use this memoised form; the set
// of (adder, position) combinations is tiny and never grows past a few dozen entries.
const styleCache = new Map();
export function collaboratorStyleFor(userId, isCollaborative, isFirst, isLast, isCompact = false) {
  const key = `${userId}|${isCollaborative}|${isFirst}|${isLast}|${isCompact}`;
  let style = styleCache.get(key);
  if (!style) {
    style = getCollaboratorStyle(userId, isCollaborative, isFirst, isLast, isCompact);
    styleCache.set(key, style);
  }
  return style;
}

export function getCollaboratorStyle(userId, isCollaborative, isFirst, isLast, isCompact = false) {
  if (!isCollaborative || !userId) return {};

  const hash = Math.abs(hashCode(userId));
  const hue = Math.round((hash * 137.508) % 360);

  const ambientGlow = isCompact ? `-6px 0px 12px -6px hsla(${hue}, 50%, 50%, 0.15)` : `-12px 0px 24px -12px hsla(${hue}, 50%, 50%, 0.15)`;
  const bottomGlow = isCompact ? `-6px 6px 12px -6px hsla(${hue}, 50%, 50%, 0.3)` : `-12px 12px 24px -12px hsla(${hue}, 50%, 50%, 0.4)`;

  const shadow = [ambientGlow];
  if (isFirst) shadow.push(`inset 0px 1px 0px hsla(${hue}, 100%, 60%, 0.25)`);
  if (isLast) {
    shadow.push(`inset 0px -1px 0px hsla(${hue}, 50%, 60%, 0.3)`);
    shadow.push(bottomGlow);
  }

  // The continuous overlay glow that spreads THROUGH the group: strongest at the bottom
  let bgGradient;
  if (isFirst && isLast) {
    bgGradient = `radial-gradient(${isCompact ? '80%' : '120%'} 150% at bottom left, hsla(${hue}, 100%, 60%, 0.12) 0%, transparent 60%)`;
  } else if (isLast) {
    bgGradient = `radial-gradient(150% 200% at bottom left, hsla(${hue}, 100%, 60%, 0.18) 0%, hsla(${hue}, 100%, 60%, 0.05) 50%, transparent 100%)`;
  } else if (isFirst) {
    bgGradient = `radial-gradient(150% 200% at bottom left, hsla(${hue}, 100%, 60%, 0.04) 0%, transparent 80%)`;
  } else {
    bgGradient = `radial-gradient(150% 200% at bottom left, hsla(${hue}, 100%, 60%, 0.08) 0%, transparent 90%)`;
  }

  return {
    '--track-hue': hue,
    boxShadow: shadow.join(', '),
    backgroundImage: bgGradient,
    borderLeft: `1px solid hsla(${hue}, 100%, 60%, 0.15)`
  };
}
