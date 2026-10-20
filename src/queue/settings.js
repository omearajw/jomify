// Which queue plays, and what happens when a playlist ends, read in one place so Settings and the
// queue never disagree.

// The new queue is the default since 20 Oct; the old one only for someone who chose it
export const newQueueOn = (settings) => settings?.queueEngine !== false;

// "Let Spotify choose" has nothing to choose from with the new queue: Spotify's autoplay never
// follows a list of songs, so the music just stopped. There it is not offered, and a saved one
// (the old default) carries on into Liked Songs instead.
export const whenPlaylistEnds = (settings) => {
  const chosen = settings?.whenPlaylistEnds || 'spotify';
  return chosen === 'spotify' && newQueueOn(settings) ? 'liked' : chosen;
};
