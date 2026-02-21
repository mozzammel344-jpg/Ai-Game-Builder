const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

async function buildExe(gameFilePath, outputDir) {
    return new Promise((resolve, reject) => {
        // 1. Use your exact tested package.json structure
        const packageJson = {
            "name": "anam-ai-game",
            "version": "1.0.0",
            "author": "Anam",
            "description": "Built with Anam's AI Builder",
            "main": "main.js",
            "build": {
                "appId": "com.anam.builder",
                "win": {
                    "target": "portable",
                    "requestedExecutionLevel": "asInvoker"
                },
                "directories": { "output": "dist" }
            }
        };

        // 2. Use your exact main.js logic (Splash + Main Window)
        const mainJs = `
            const { app, BrowserWindow } = require('electron');
            app.disableHardwareAcceleration();
            function createWindows() {
                const splash = new BrowserWindow({
                    width: 500, height: 300, frame: false, transparent: true,
                    alwaysOnTop: true, center: true, backgroundColor: '#1e1e1e', show: false
                });
                const splashHTML = \`
                    <html><body style="background:#1e1e1e; color:white; display:flex; flex-direction:column; justify-content:center; align-items:center; height:100vh; font-family:sans-serif; border:2px solid #4CAF50; border-radius:15px; margin:0;">
                        <h1>MADE BY ANAM</h1>
                        <p style="color:#888;">USING ANAM'S AI BUILDER</p>
                    </body></html>\`;
                splash.loadURL('data:text/html;base64,' + Buffer.from(splashHTML).toString('base64'));
                splash.once('ready-to-show', () => {
                    splash.show();
                    const win = new BrowserWindow({ width: 1000, height: 700, show: false });
                    win.setMenuBarVisibility(false);
                    win.loadFile('index.html');
                    win.once('ready-to-show', () => {
                        setTimeout(() => { splash.destroy(); win.show(); }, 2000);
                    });
                });
            }
            app.whenReady().then(createWindows);
            app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
        `;

        // Write files to the temp build directory
        fs.writeFileSync(path.join(outputDir, 'package.json'), JSON.stringify(packageJson, null, 2));
        fs.writeFileSync(path.join(outputDir, 'main.js'), mainJs);
        fs.copyFileSync(gameFilePath, path.join(outputDir, 'index.html'));

        console.log(`[BUILDING] Starting Anam's AI Builder in: ${outputDir}`);

        // FIX: Just run 'build --win'. It will read the 'portable' target from package.json
        const cmd = 'npx electron-builder build --win';
        
        exec(cmd, { cwd: outputDir }, (error, stdout, stderr) => {
            if (error) {
                console.error("--- BUILD ERROR ---", stderr);
                return reject(error);
            }
            
            const distDir = path.join(outputDir, 'dist');
            const files = fs.readdirSync(distDir);
            const exeFile = files.find(f => f.endsWith('.exe'));
            
            if (exeFile) {
                resolve(path.join(distDir, exeFile));
            } else {
                reject(new Error("Executable was not found in dist folder."));
            }
        });
    });
}

module.exports = buildExe;