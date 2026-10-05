export function formatTime(ms) {
  if (!ms) return '0:00';
  const minutes = Math.floor(ms / 60000);
  // Use Math.floor instead of .toFixed(0) to prevent rounding 59.9 up to 60
  const seconds = Math.floor((ms % 60000) / 1000);
  
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}
// "2 hr 51 min" over an hour, "51 min 20 sec" under, the way Spotify totals a playlist
export function formatDuration(ms) {
  const total = Math.floor((ms || 0) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours} hr ${minutes} min`;
  if (minutes > 0) return `${minutes} min ${seconds} sec`;
  return `${seconds} sec`;
}
