const { app, BrowserWindow, dialog, ipcMain, session, desktopCapturer } = require('electron');
const express = require('express');
const path = require('path');

const server = express();
const host = '127.0.0.1'; // Loopback only: this server exists for the window, not the LAN
const port = 3000;        // CRITICAL: This must match your Spotify Redirect URI port!

// Serve your compiled React files
server.use(express.static(path.join(__dirname, 'dist')));

// Ensure any refreshes route back to your React app
server.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    autoHideMenuBar: true, // Hides the ugly File/Edit/View menu
    backgroundColor: '#000000',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs') },
  });
  mainWindow.loadURL(`http://${host}:${port}`);
}

// Zen mode's fullscreen. On macOS the real thing creates a Space and blacks out every other
// monitor, so the window fills the screen the old-fashioned way instead; elsewhere real
// fullscreen behaves and is used.
ipcMain.handle('zen-fullscreen', (_event, on) => {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (process.platform === 'darwin') mainWindow.setSimpleFullScreen(on);
  else mainWindow.setFullScreen(on);
  return true;
});

// The waveform's "sound from this computer": a capture request from the page is answered with
// the whole screen's audio loopback (Windows, and macOS 13+ through Apple's audio capture); the
// page stops the picture that comes with it at once. Nothing else in Jomify asks to capture.
function allowSystemAudio() {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] })
      .then((sources) => callback(sources[0] ? { video: sources[0], audio: 'loopback' } : {}))
      .catch(() => callback({}));
  });
}

app.whenReady().then(() => {
  allowSystemAudio();
  const listener = server.listen(port, host, () => createWindow());

  // Previously an unhandled error here (most often the Vite dev server already holding port
  // 3000) meant the app launched with no window and no message at all.
  listener.on('error', (err) => {
    const reason = err.code === 'EADDRINUSE'
      ? `Port ${port} is already in use. Close whatever is using it (usually the Vite dev server) and relaunch.`
      : err.message;
    dialog.showErrorBox('Jomify could not start', reason);
    app.quit();
  });

  // macOS keeps the app alive with no windows; clicking the dock icon should bring one back
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Shut down the app completely when you hit the X
app.on('window-all-closed', () => {
  app.quit();
});
