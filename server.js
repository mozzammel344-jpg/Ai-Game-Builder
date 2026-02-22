const express = require('express');
const http = require('http'); 
const { Server } = require('socket.io'); 
const axios = require('axios');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const accounts = require('./accounts.js');

const app = express();
const server = http.createServer(app); 
const io = new Server(server, { cors: { origin: "*" } });

// Storage config
const uploadBuild = multer({ dest: 'build_output/' });
const uploadIcon = multer({ dest: 'temp_uploads/' });

// --- CONFIGURATION ---
const PORT = process.env.PORT || 3000;
const SERVER_URL = process.env.SERVER_URL || `http://localhost:${PORT}`; 
const GITHUB_PAT = process.env.GITHUB_PAT || "YOUR_GITHUB_TOKEN_HERE";
const GITHUB_REPO = process.env.GITHUB_REPO || "YourUsername/YourRepoName";

const OR_API_KEY = process.env.OR_API_KEY || "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";
const MODEL = "stepfun/step-3.5-flash:free";

const gamesDir = path.join(__dirname, 'games');
const buildsDir = path.join(__dirname, 'build_output');
const tempDir = path.join(__dirname, 'temp_uploads');

[gamesDir, buildsDir, tempDir].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));
app.use('/games', express.static(gamesDir));
app.use('/download-zone', express.static(buildsDir));

const buildQueue = [];
let isBuilding = false;
const activeJobsData = {}; 
const buildJobs = {}; 

io.on('connection', (socket) => {
    console.log(`[SOCKET]: Client connected (${socket.id})`);
    socket.emit('queue-status', { queueLength: buildQueue.length, isBuilding });
});

function broadcastQueue() {
    io.emit('queue-status', { queueLength: buildQueue.length, isBuilding });
}

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'hubb.html')));
app.post('/signup', (req, res) => res.json(accounts.signup(req.body.username, req.body.password)));
app.post('/login', (req, res) => res.json(accounts.login(req.body.username, req.body.password)));
app.post('/user-data', (req, res) => res.json({ projects: accounts.getProjects(req.body.username) }));

// --- AI GENERATION SYSTEM ---
app.post('/generate-game', async (req, res) => {
    const { username, prompt, isUpdate, currentFile, gameName, patchPrompt } = req.body;
    
    // STRICT SYSTEM PROMPT (NO BUTTONS, NO INTERNET, WITH AUDIO)
    let systemPrompt = `You are an elite 2D game engineer. Output MUST be a SINGLE-FILE HTML5 game. 
    Return ONLY raw code. No explanations, no backticks. 
    
    RULES:
    1. STRICTLY 2D: No WebGL, No 3D. Use 2D Canvas API.
    2. NO EXTERNAL ASSETS: Do NOT use <img> tags or URLs. Do NOT search for models. Draw everything using canvas methods (rect, arc, gradients). Use emojis for complex characters if needed.
    3. FULL SCREEN: Canvas must resize to window.innerWidth/innerHeight. No black bars.
    4. CONTROLS: Use Keyboard (Arrow keys/WASD) or Mouse only. Do NOT add mobile buttons or on-screen D-pads.
    5. NO EXIT BUTTON: Do not include an exit or quit button in the UI.
    6. AUDIO SYSTEM: Use the 'Web Audio API' (AudioContext) to generate procedural sound effects (e.g., a short 'oscillator' beep for jumps, explosions, or clicks). Do NOT use .mp3 or .wav files.
    7. CODE QUALITY: Ensure the game loop is efficient. If updating code, preserve existing logic unless told otherwise.`;
    
    let userPrompt = "";
    let finalFileName = "";

    if (isUpdate && currentFile) {
        const filePath = path.join(gamesDir, currentFile);
        if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File not found." });
        const oldCode = fs.readFileSync(filePath, 'utf8');
        finalFileName = currentFile; 
        userPrompt = `Update this code: ${oldCode}. Instruction: ${patchPrompt}`;
    } else {
        const safeName = (gameName || 'world').replace(/[^a-z0-9]/gi, '_').toLowerCase();
        finalFileName = `${safeName}_${Date.now()}.html`;
        userPrompt = `Build a new game: ${gameName}. Concept: ${prompt}`;
    }

    try {
        const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
            model: MODEL,
            messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
            temperature: 0.1 // FORCE DETERMINISTIC LOGIC
        }, {
            headers: { 
                "Authorization": `Bearer ${OR_API_KEY}`, 
                "Content-Type": "application/json",
                "HTTP-Referer": `${SERVER_URL}`, 
                "X-Title": "Architect Engine"
            }
        });

        if (!response.data || !response.data.choices) throw new Error("Invalid AI response");

        let code = response.data.choices[0].message.content.replace(/```html|```javascript|```/g, '').trim();
        fs.writeFileSync(path.join(gamesDir, finalFileName), code);
        
        if (!isUpdate) accounts.addProject(username, finalFileName);
        res.json({ success: true, fileName: finalFileName });

    } catch (err) {
        res.status(500).json({ error: "AI Generation Failed." });
    }
});

// --- MULTI-PLATFORM COMPILER QUEUE ---
app.post('/build', uploadIcon.single('icon'), (req, res) => {
    const { fileName, customName, platform } = req.body;
    const targetPlatform = platform || 'windows'; 
    const iconFile = req.file;

    if (!fileName) return res.status(400).json({ error: "No file selected." });

    const jobID = Math.floor(1000000000 + Math.random() * 9000000000).toString();
    const htmlContent = fs.readFileSync(path.join(gamesDir, fileName), 'utf8');
    
    const mainJsContent = `
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
function createWindow() {
  const splash = new BrowserWindow({ width: 600, height: 400, transparent: true, frame: false, alwaysOnTop: true, center: true });
  splash.loadFile(path.join(__dirname, 'splash.html'));
  const win = new BrowserWindow({ width: 1280, height: 720, show: false, fullscreen: true, autoHideMenuBar: true, backgroundColor: '#000', webPreferences: { nodeIntegration: false, contextIsolation: false, preload: path.join(__dirname, 'preload.js') } });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.once('ready-to-show', () => { setTimeout(() => { if (!splash.isDestroyed()) splash.close(); win.show(); win.focus(); }, 3000); });
  ipcMain.on('exit-app', () => { app.quit(); });
}
app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });`;

    const preloadJsContent = `
const { ipcRenderer } = require('electron');
window.exitApp = () => { ipcRenderer.send('exit-app'); };
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') ipcRenderer.send('exit-app'); });`;

    let iconBase64 = null, iconExt = null;
    if (iconFile) {
        iconExt = path.extname(iconFile.originalname) || '.png';
        iconBase64 = fs.readFileSync(iconFile.path, { encoding: 'base64' });
        fs.unlinkSync(iconFile.path);
    }

    const safeTitle = (customName || "Architect_Game").trim();
    const safeFileName = safeTitle.replace(/[^a-z0-9 _-]/gi, '').replace(/\s+/g, '_');

    const stylishSplash = `
    <!DOCTYPE html><html><head><style>
        body { margin: 0; padding: 0; overflow: hidden; background: rgba(0,0,0,0); font-family: 'Segoe UI', sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; }
        .card { width: 500px; height: 300px; background: rgba(20, 20, 25, 0.95); border: 2px solid #55ff55; border-radius: 15px; box-shadow: 0 0 30px rgba(85, 255, 85, 0.3); display: flex; flex-direction: column; align-items: center; justify-content: center; position: relative; overflow: hidden; }
        .logo { font-size: 32px; font-weight: bold; color: #fff; letter-spacing: 5px; text-transform: uppercase; text-shadow: 0 0 10px #55ff55; margin-bottom: 10px; }
        .sub { color: #55ff55; font-size: 10px; letter-spacing: 3px; margin-bottom: 30px; opacity: 0.8; }
        .loader { width: 250px; height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; position: relative; overflow: hidden; }
        .bar { width: 40%; height: 100%; background: #55ff55; position: absolute; left: -40%; animation: load 1.5s infinite ease-in-out; box-shadow: 0 0 10px #55ff55; }
        @keyframes load { 0% { left: -40%; } 100% { left: 100%; } }
        .scanline { position: absolute; width: 100%; height: 100%; background: linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.1) 50%); background-size: 100% 2px; pointer-events: none; }
    </style></head><body><div class="card"><div class="scanline"></div><div class="logo">${safeTitle}</div><div class="sub">INITIALIZING ENGINE...</div><div class="loader"><div class="bar"></div></div></div></body></html>`;

    activeJobsData[jobID] = {
        html: htmlContent, 
        main: mainJsContent,
        preload: preloadJsContent,
        splash: stylishSplash,
        platform: targetPlatform, 
        safeFileName: safeFileName,
        iconBase64, 
        iconExt,
        packageJson: JSON.stringify({
            name: `game-${jobID}`,
            productName: safeTitle,
            version: "1.0.0",
            main: "main.js",
            devDependencies: { "electron": "^28.0.0" },
            build: { win: { target: "portable" }, directories: { output: "dist" } }
        }, null, 2)
    };

    buildJobs[jobID] = { status: 'queued', platform: targetPlatform };
    buildQueue.push({ jobID, platform: targetPlatform });
    broadcastQueue();
    
    res.json({ jobID });
    processQueue();
});

async function processQueue() {
    if (isBuilding || buildQueue.length === 0) return;
    isBuilding = true;
    broadcastQueue();

    const currentJob = buildQueue.shift();
    const jobID = currentJob.jobID;
    const jobData = activeJobsData[jobID];
    buildJobs[jobID].status = 'building';

    try {
        await axios.post(`https://api.github.com/repos/${GITHUB_REPO}/dispatches`, {
            event_type: 'build-project',
            client_payload: { 
                jobID, 
                platform: jobData.platform,
                safeFileName: jobData.safeFileName,
                downloadUrl: `${SERVER_URL}/api/internal/download-source/${jobID}`, 
                uploadUrl: `${SERVER_URL}/api/internal/upload-exe/${jobID}` 
            }
        }, {
            headers: { 'Authorization': `token ${GITHUB_PAT}` }
        });
    } catch (err) {
        buildJobs[jobID].status = 'error';
        isBuilding = false;
        processQueue();
    }
}

app.get('/api/internal/download-source/:id', (req, res) => res.json(activeJobsData[req.params.id] || {}));

app.post('/api/internal/upload-exe/:id', uploadBuild.single('exe'), (req, res) => {
    const jobID = req.params.id;
    const buildFile = req.file;
    const jobData = activeJobsData[jobID];

    if (buildFile && jobData) {
        const extension = jobData.platform === 'android' ? '.apk' : '.exe';
        const finalName = `${jobData.safeFileName}_${jobID}${extension}`;
        
        fs.renameSync(buildFile.path, path.join(buildsDir, finalName));
        
        buildJobs[jobID] = { status: 'ready', file: finalName, platform: jobData.platform };
        io.emit('build-complete', { jobID, file: finalName });
        
        setTimeout(() => {
            const p = path.join(buildsDir, finalName);
            if (fs.existsSync(p)) fs.unlinkSync(p);
        }, 300000); 
    }
    
    delete activeJobsData[jobID];
    isBuilding = false;
    res.send('OK');
    processQueue();
});

app.get('/build-status/:id', (req, res) => res.json(buildJobs[req.params.id] || { error: "Not found" }));

server.listen(PORT, () => console.log(`Architect Engine Running on ${PORT}`));
