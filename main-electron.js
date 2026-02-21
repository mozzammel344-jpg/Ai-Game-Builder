const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

/**
 * ARCHITECT ENGINE - Production Wrapper
 * High-Graphics Build Logic
 */

function createWindow() {
  // --- 1. DYNAMIC ICON DETECTION ---
  const possibleIcons = ['icon.ico', 'icon.png', 'icon.jpg', 'icon.jpeg'];
  let iconPath = undefined;
  for (const name of possibleIcons) {
    const fullPath = path.join(__dirname, name);
    if (fs.existsSync(fullPath)) {
      iconPath = fullPath;
      break; 
    }
  }

  // --- 2. CREATE THE STYLISH SPLASH SCREEN ---
  const splash = new BrowserWindow({
    width: 600,
    height: 400,
    transparent: true, // Required for the glow effects
    frame: false,
    alwaysOnTop: true,
    center: true,
    resizable: false,
    icon: iconPath,
    webPreferences: { nodeIntegration: false }
  });
  
  // Note: The HTML content for this is generated dynamically by the server
  splash.loadFile(path.join(__dirname, 'splash.html'));

  // --- 3. PREPARE THE MAIN GAME WINDOW ---
  const win = new BrowserWindow({
    width: 1280, 
    height: 720,
    show: false,
    fullscreen: true,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    icon: iconPath,
    webPreferences: { 
        nodeIntegration: false,
        contextIsolation: false,
        preload: path.join(__dirname, 'preload.js')
    }
  });

  win.loadFile(path.join(__dirname, 'index.html'));

  // --- 4. SMOOTH TRANSITION LOGIC ---
  win.once('ready-to-show', () => {
    // 3 seconds of high-graphics splash
    setTimeout(() => {
      if (!splash.isDestroyed()) splash.close(); 
      win.show();
      win.maximize();
      win.focus();
    }, 3000); 
  });

  // --- 5. IPC LISTENER FOR EXIT ---
  ipcMain.on('exit-app', () => {
    app.quit();
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
