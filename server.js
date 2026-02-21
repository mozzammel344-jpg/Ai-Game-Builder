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

// Storage config for receiving the final EXE from GitHub
const uploadExe = multer({ dest: 'build_output/' });
// Storage config for the user's initial icon upload
const uploadIcon = multer({ dest: 'temp_uploads/' });

// --- CONFIGURATION ---
const PORT = process.env.PORT || 3000;
// Make sure to set these in Render Environment Variables later!
const SERVER_URL = process.env.SERVER_URL || `http://localhost:${PORT}`; 
const GITHUB_PAT = process.env.GITHUB_PAT || "YOUR_GITHUB_TOKEN_HERE";
const GITHUB_REPO = process.env.GITHUB_REPO || "YourUsername/YourRepoName";

const OR_API_KEY = "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";
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

// --- QUEUE SYSTEM STATE ---
const buildQueue = [];
let isBuilding = false;
const activeJobsData = {}; // Stores project data temporarily for GitHub to fetch
const buildJobs = {}; // Tracks status for the user

// Socket Connection & Queue Broadcasting
io.on('connection', (socket) => {
    console.log(`[SOCKET]: Client connected (${socket.id})`);
    // Immediately send current queue length to the new user
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
    console.log(`[AI]: ${isUpdate ? 'Updating' : 'Creating'} project: ${gameName}`);

    let systemPrompt = `You are a professional game developer and surgical code editor. 
    1. Output MUST be a complete, SINGLE-FILE HTML5 game. 
    2. NO EXTERNAL ASSETS: Use geometric shapes for all visuals.
    3. AUTO-START: The game must play instantly.
    4. NO BLACK SCREENS: Use a colored background (e.g., #1a1a1a).
    5. FULLSCREEN: CSS must ensure the canvas fills the window precisely.
    6. RESPONSE: Return ONLY raw code. No explanations, no markdown backticks.`;

    let userPrompt = "";
    let finalFileName = "";

    if (isUpdate && currentFile) {
        const filePath = path.join(gamesDir, currentFile);
        if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File not found." });
        const oldCode = fs.readFileSync(filePath, 'utf8');
        finalFileName = currentFile; 
        userPrompt = `YOU ARE UPDATING THIS CODE:\n---START CODE---\n${oldCode}\n---END CODE---\nINSTRUCTION: ${patchPrompt}\nTASK: Apply the change and return the FULL updated code.`;
    } else {
        const safeName = (gameName || 'world').replace(/[^a-z0-9]/gi, '_').toLowerCase();
        finalFileName = `${safeName}_${Date.now()}.html`;
        userPrompt = `Build a new game from scratch. Title: ${gameName || 'New Project'}. Concept: ${prompt}`;
    }

    try {
        const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
            model: MODEL,
            messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
            temperature: 0.1 
        }, {
            headers: { "Authorization": `Bearer ${OR_API_KEY}`, "Content-Type": "application/json" }
        });

        let code = response.data.choices[0].message.content.replace(/```html|```javascript|```/g, '').trim();
        fs.writeFileSync(path.join(gamesDir, finalFileName), code);
        
        if (!isUpdate) accounts.addProject(username, finalFileName);
        console.log(`[AI]: Successfully saved ${finalFileName}`);
        res.json({ success: true, fileName: finalFileName });
    } catch (err) {
        console.error("[AI ERROR]:", err.message);
        res.status(500).json({ error: "AI Generation Failed" });
    }
});

// --- NEW COMPILER QUEUE SYSTEM ---
app.post('/build', uploadIcon.single('icon'), (req, res) => {
    const { fileName, customName } = req.body;
    const iconFile = req.file;

    if (!fileName) return res.status(400).json({ error: "No file selected." });

    const rawName = customName || "Architect_Game";
    const safeTitle = rawName.trim();
    const safeFileName = safeTitle.replace(/[^a-z0-9 _-]/gi, '').replace(/\s+/g, '_');

    const jobID = Math.floor(1000000000 + Math.random() * 9000000000).toString();
    
    // 1. Read all files into memory to send to GitHub later
    const htmlContent = fs.readFileSync(path.join(gamesDir, fileName), 'utf8');
    const mainJsContent = fs.readFileSync(path.join(__dirname, 'main-electron.js'), 'utf8');
    
    let iconBase64 = null;
    let iconExt = null;
    if (iconFile) {
        iconExt = path.extname(iconFile.originalname) || '.png';
        iconBase64 = fs.readFileSync(iconFile.path, { encoding: 'base64' });
        fs.unlinkSync(iconFile.path); // Clean up temp icon
    }

    const packageJson = {
        name: `game-${jobID}`,
        productName: safeTitle,
        version: "1.0.0",
        description: "Made using Anam's Ai Builder.",
        author: "Itz_AnamPlayz",
        main: "main.js",
        devDependencies: { "electron": "^28.0.0" },
        build: {
            electronVersion: "28.0.0", 
            win: { target: "portable" },
            directories: { output: "dist" }
        }
    };
    if (iconExt) packageJson.build.win.icon = `icon${iconExt}`;

    const splashHtml = `<html><body style="background:#111;color:#5f5;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;flex-direction:column;border:2px solid #444"><h1>${safeTitle}</h1><p>Compiling Assets...</p></body></html>`;
    const preloadJs = `const { ipcRenderer } = require('electron'); window.addEventListener('DOMContentLoaded', () => { const btn = document.createElement('button'); btn.innerHTML = 'EXIT'; btn.style.cssText = 'position:fixed;top:10px;right:10px;z-index:9999;background:red;color:white;border:none;padding:5px 10px;cursor:pointer;'; btn.onclick = () => ipcRenderer.send('exit-app'); document.body.appendChild(btn); });`;

    // 2. Store job data temporarily
    activeJobsData[jobID] = {
        html: htmlContent,
        main: mainJsContent,
        packageJson: JSON.stringify(packageJson, null, 2),
        splash: splashHtml,
        preload: preloadJs,
        iconBase64: iconBase64,
        iconExt: iconExt,
        safeFileName: safeFileName
    };

    buildJobs[jobID] = { status: 'queued', file: null };
    
    // 3. Add to Queue
    buildQueue.push({ jobID, socketId: req.headers['socket-id'] });
    broadcastQueue();
    
    console.log(`[QUEUE]: Job ${jobID} added. Queue length: ${buildQueue.length}`);
    res.json({ jobID });

    // Try to process queue
    processQueue();
});

// --- PROCESS QUEUE & TRIGGER GITHUB ACTIONS ---
async function processQueue() {
    if (isBuilding || buildQueue.length === 0) return;

    isBuilding = true;
    broadcastQueue();

    const currentJob = buildQueue.shift();
    const jobID = currentJob.jobID;
    
    buildJobs[jobID].status = 'building';
    io.emit('build-log', { jobID, message: 'Your turn reached! Sending project to GitHub Action...', type: 'info' });

    const downloadUrl = `${SERVER_URL}/api/internal/download-source/${jobID}`;
    const uploadUrl = `${SERVER_URL}/api/internal/upload-exe/${jobID}`;

    try {
        console.log(`[GITHUB]: Dispatching Action for Job ${jobID}`);
        // Trigger GitHub Action using repository_dispatch
        await axios.post(`https://api.github.com/repos/${GITHUB_REPO}/dispatches`, {
            event_type: 'build-exe',
            client_payload: {
                jobId: jobID,
                downloadUrl: downloadUrl,
                uploadUrl: uploadUrl
            }
        }, {
            headers: {
                'Accept': 'application/vnd.github.v3+json',
                'Authorization': `token ${GITHUB_PAT}`
            }
        });

        io.emit('build-log', { jobID, message: 'GitHub Machine started. Compiling your .EXE...', type: 'info' });
        // Server now waits. The GitHub action will hit the /api/internal/upload-exe route when done.

    } catch (err) {
        console.error(`[GITHUB ERROR]:`, err.response ? err.response.data : err.message);
        buildJobs[jobID].status = 'error';
        io.emit('build-error', { jobID, code: 'GitHub Dispatch Failed' });
        delete activeJobsData[jobID];
        
        // Move to next in queue
        isBuilding = false;
        processQueue();
    }
}

// --- GITHUB ACTION COMMUNICATION ENDPOINTS ---

// GitHub Action calls this to download the project files
app.get('/api/internal/download-source/:id', (req, res) => {
    const jobID = req.params.id;
    const data = activeJobsData[jobID];
    if (!data) return res.status(404).json({ error: 'Job data expired or not found' });
    res.json(data);
});

// GitHub Action POSTs the final .exe here
app.post('/api/internal/upload-exe/:id', uploadExe.single('exe'), (req, res) => {
    const jobID = req.params.id;
    const exeFile = req.file;
    const jobData = activeJobsData[jobID];

    if (!exeFile || !jobData) {
        if(jobData) {
            buildJobs[jobID].status = 'error';
            io.emit('build-error', { jobID, code: 'No EXE received from GitHub' });
            delete activeJobsData[jobID];
        }
        isBuilding = false;
        processQueue();
        return res.status(400).send('Upload failed');
    }

    try {
        // Rename and move the received EXE to the download zone
        const finalExeName = `${jobData.safeFileName}_${jobID}.exe`;
        fs.renameSync(exeFile.path, path.join(buildsDir, finalExeName));
        
        buildJobs[jobID] = { status: 'ready', file: finalExeName };
        console.log(`[SUCCESS]: Received compiled ${finalExeName} from GitHub!`);
        
        io.emit('build-log', { jobID, message: 'File received from GitHub!', type: 'info' });
        io.emit('build-complete', { jobID, file: finalExeName });

        // Auto-delete the .exe after 1 minute (60,000 ms) as requested
        setTimeout(() => {
            const filePath = path.join(buildsDir, finalExeName);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                console.log(`[CLEANUP]: Deleted ${finalExeName} after 1 minute.`);
            }
        }, 60000);

    } catch (e) {
        console.error("Error saving EXE:", e);
        buildJobs[jobID].status = 'error';
        io.emit('build-error', { jobID, code: 'Server File Error' });
    }

    // Cleanup memory and move to next person in queue
    delete activeJobsData[jobID];
    isBuilding = false;
    res.send('OK');
    processQueue();
});

app.get('/build-status/:id', (req, res) => {
    const job = buildJobs[req.params.id];
    if (!job) return res.status(404).json({ error: "Job ID not found." });
    res.json(job);
});

server.listen(PORT, () => {
    console.log(`----------------------------------------`);
    console.log(`ARCHITECT ENGINE (GITHUB ACTIONS QUEUE): http://localhost:${PORT}`);
    console.log(`----------------------------------------`);
});