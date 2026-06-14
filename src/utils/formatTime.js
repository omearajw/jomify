export function formatTime(ms) {
  if (!ms) return '0:00';
  const minutes = Math.floor(ms / 60000);
  // Use Math.floor instead of .toFixed(0) to prevent rounding 59.9 up to 60
  const seconds = Math.floor((ms % 60000) / 1000);
  
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}