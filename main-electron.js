const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

/**
 * ARCHITECT ENGINE - Production Wrapper
 * Features: Dynamic Icon Detection, Frameless Splash, and IPC Exit Logic.
 */

function createWindow() {
  // --- 1. DYNAMIC ICON DETECTION ---
  // We check which icon file was placed in the folder by the server
  const possibleIcons = ['icon.ico', 'icon.png', 'icon.jpg', 'icon.jpeg'];
  let iconPath = undefined;

  for (const name of possibleIcons) {
    const fullPath = path.join(__dirname, name);
    if (fs.existsSync(fullPath)) {
      iconPath = fullPath;
      break; 
    }
  }

  // --- 2. CREATE THE SPLASH SCREEN ---
  const splash = new BrowserWindow({
    width: 700,
    height: 450,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    center: true,
    resizable: false,
    icon: iconPath, // Set icon for the splash taskbar entry
    webPreferences: { 
      nodeIntegration: false 
    }
  });
  
  splash.loadFile(path.join(__dirname, 'splash.html'));

  // --- 3. PREPARE THE MAIN GAME WINDOW ---
  const win = new BrowserWindow({
    width: 1280, 
    height: 720,
    show: false,
    fullscreen: true,
    autoHideMenuBar: true,
    backgroundColor: '#1a1a1a',
    icon: iconPath, // Set icon for the main window title bar
    webPreferences: { 
        nodeIntegration: false,
        contextIsolation: false,
        preload: path.join(__dirname, 'preload.js')
    }
  });

  win.loadFile(path.join(__dirname, 'index.html'));

  // --- 4. SMOOTH TRANSITION LOGIC ---
  win.once('ready-to-show', () => {
    // Show splash for 2.5 seconds, then swap
    setTimeout(() => {
      if (!splash.isDestroyed()) splash.close(); 
      win.show();
      win.focus();
    }, 2500); 
  });

  // --- 5. IPC LISTENER FOR EXIT BUTTON ---
  ipcMain.on('exit-app', () => {
    app.quit();
  });
}

// Electron Initialization
app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Standard OS Close Behavior
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});