const { app, BrowserWindow, screen } = require('electron');
const path = require('path');

// Disable Hardware Acceleration for maximum compatibility on all PCs
app.disableHardwareAcceleration();

/**
 * MULTI-USER DYNAMIC LOADING
 * The server passes the specific 'tempXXXXX.html' filename through this 
 * environment variable during the build process.
 */
const targetFile = process.env.BUILD_TARGET || 'index.html';

function createWindows() {
    // 1. SPLASH SCREEN WINDOW
    const splash = new BrowserWindow({
        width: 500,
        height: 300,
        frame: false, // No top bar
        transparent: true,
        alwaysOnTop: true,
        center: true,
        backgroundColor: '#1e1e1e',
        show: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    // Custom Splash Screen HTML with your branding
    const splashHTML = `
    <html>
      <body style="background:#1e1e1e; color:white; display:flex; flex-direction:column; 
            justify-content:center; align-items:center; height:100vh; font-family:sans-serif; 
            border:2px solid #55ff55; border-radius:15px; margin:0; overflow:hidden;">
        <h1 style="margin:0; font-size:2.2em; letter-spacing:2px; color:#55ff55; text-shadow: 3px 3px #000;">MADE BY ANAM</h1>
        <p style="margin-top:10px; color:#888; font-weight:bold; letter-spacing:1px; font-size: 0.9em;">
          BUILT WITH ANAM'S AI ENGINE
        </p>
        <div style="margin-top: 20px; width: 50px; height: 50px; border: 5px solid #333; border-top: 5px solid #55ff55; border-radius: 50%; animation: spin 1s linear infinite;"></div>
        <style>
          @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        </style>
      </body>
    </html>
    `;
    
    splash.loadURL(`data:text/html;base64,${Buffer.from(splashHTML).toString('base64')}`);

    // 2. MAIN GAME WINDOW
    const win = new BrowserWindow({
        width: 1280,
        height: 720,
        show: false, // Hidden until splash finishes
        icon: path.join(__dirname, 'icon.png'), // Optional: add an icon.png in your folder
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            devTools: false // Keep it clean for players
        }
    });

    win.setMenuBarVisibility(false);

    // Load the dynamic file passed by the server
    win.loadFile(path.join(__dirname, targetFile)).catch(err => {
        console.error("Failed to load target file:", err);
        // Fallback to index.html if temp file is missing
        win.loadFile(path.join(__dirname, 'index.html'));
    });

    // 3. SHOW LOGIC
    splash.once('ready-to-show', () => {
        splash.show();
        
        // Wait 3 seconds so the player can see your brand, then switch to game
        setTimeout(() => {
            win.show();
            splash.destroy();
        }, 3000);
    });
}

// Ensure the app starts correctly
app.whenReady().then(() => {
    createWindows();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindows();
    });
});

// Quit when all windows are closed
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});