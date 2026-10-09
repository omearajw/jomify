const { contextBridge, ipcRenderer } = require('electron');

// The little the page may ask of the desktop wrapper. Zen mode wants the whole screen without
// macOS's real fullscreen, which moves the window to its own Space and blacks out every other
// monitor; the main process answers with the window's "simple" fullscreen instead.
contextBridge.exposeInMainWorld('jomifyDesktop', {
  platform: process.platform,
  setZenFullscreen: (on) => ipcRenderer.invoke('zen-fullscreen', Boolean(on))
});
