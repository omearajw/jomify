const { app, BrowserWindow, dialog } = require('electron');
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
  });
  mainWindow.loadURL(`http://${host}:${port}`);
}

app.whenReady().then(() => {
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
