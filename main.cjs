const { app, BrowserWindow } = require('electron');
const express = require('express');
const path = require('path');

const server = express();
const port = 3000; // CRITICAL: This must match your Spotify Redirect URI port!

// Serve your compiled React files
server.use(express.static(path.join(__dirname, 'dist')));

// Ensure any refreshes route back to your React app
server.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

let mainWindow;

app.whenReady().then(() => {
  // 1. Start the invisible local server
  server.listen(port, () => {
    
    // 2. Open the Native Desktop Window
    mainWindow = new BrowserWindow({
      width: 1280,
      height: 800,
      autoHideMenuBar: true, // Hides the ugly File/Edit/View menu
      backgroundColor: '#000000',
    });

    // 3. Load the local server into the window
    mainWindow.loadURL(`http://127.0.0.1:${port}`);
  });
});

// Shut down the app completely when you hit the X
app.on('window-all-closed', () => {
  app.quit();
});