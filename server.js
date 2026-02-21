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

const uploadExe = multer({ dest: 'build_output/' });
const uploadIcon = multer({ dest: 'temp_uploads/' });

// --- CONFIGURATION ---
const PORT = process.env.PORT || 3000;
const SERVER_URL = process.env.SERVER_URL || `http://localhost:${PORT}`; 
const GITHUB_PAT = process.env.GITHUB_PAT || "YOUR_GITHUB_TOKEN_HERE";
const GITHUB_REPO = process.env.GITHUB_REPO || "YourUsername/YourRepoName";

// IMPORTANT: Ensure this key is valid in your Render Environment Variables!
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

// --- AI GENERATION SYSTEM (FIXED) ---
app.post('/generate-game', async (req, res) => {
    const { username, prompt, isUpdate, currentFile, gameName, patchPrompt } = req.body;
    console.log(`[AI]: ${isUpdate ? 'Updating' : 'Creating'} project: ${gameName}`);

    let systemPrompt = `You are a professional game developer. Output MUST be a complete, SINGLE-FILE HTML5 game. Return ONLY raw code. No explanations, no markdown backticks.`;
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
            messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }]
        }, {
            headers: { 
                "Authorization": `Bearer ${OR_API_KEY}`, 
                "Content-Type": "application/json",
                "HTTP-Referer": `${SERVER_URL}`, // REQUIRED by some OpenRouter models
                "X-Title": "Architect Engine"
            }
        });

        // Safety check to prevent 500 crash if AI returns empty
        if (!response.data || !response.data.choices) {
            throw new Error("Invalid AI response structure");
        }

        let code = response.data.choices[0].message.content.replace(/```html|```javascript|```/g, '').trim();
        fs.writeFileSync(path.join(gamesDir, finalFileName), code);
        
        if (!isUpdate) accounts.addProject(username, finalFileName);
        res.json({ success: true, fileName: finalFileName });

    } catch (err) {
        console.error("[AI ERROR]:", err.response ? err.response.data : err.message);
        res.status(500).json({ error: "AI Generation Failed. Check Render logs for 401/Auth issues." });
    }
});

// --- NEW COMPILER QUEUE SYSTEM ---
app.post('/build', uploadIcon.single('icon'), (req, res) => {
    const { fileName, customName } = req.body;
    const iconFile = req.file;
    if (!fileName) return res.status(400).json({ error: "No file selected." });

    const jobID = Math.floor(1000000000 + Math.random() * 9000000000).toString();
    const htmlContent = fs.readFileSync(path.join(gamesDir, fileName), 'utf8');
    const mainJsContent = fs.readFileSync(path.join(__dirname, 'main-electron.js'), 'utf8');
    
    let iconBase64 = null, iconExt = null;
    if (iconFile) {
        iconExt = path.extname(iconFile.originalname) || '.png';
        iconBase64 = fs.readFileSync(iconFile.path, { encoding: 'base64' });
        fs.unlinkSync(iconFile.path);
    }

    const safeTitle = (customName || "Architect_Game").trim();
    const safeFileName = safeTitle.replace(/[^a-z0-9 _-]/gi, '').replace(/\s+/g, '_');

    const packageJson = {
        name: `game-${jobID}`,
        productName: safeTitle,
        version: "1.0.0",
        main: "main.js",
        devDependencies: { "electron": "^28.0.0" },
        build: { win: { target: "portable" }, directories: { output: "dist" } }
    };
    if (iconExt) packageJson.build.win.icon = `icon${iconExt}`;

    activeJobsData[jobID] = {
        html: htmlContent, main: mainJsContent,
        packageJson: JSON.stringify(packageJson, null, 2),
        splash: `<html><body style="background:#111;color:#5f5;display:flex;align-items:center;justify-content:center;height:100vh;"><h1>${safeTitle}</h1></body></html>`,
        preload: `const { ipcRenderer } = require('electron');`,
        iconBase64, iconExt, safeFileName
    };

    buildJobs[jobID] = { status: 'queued', file: null };
    buildQueue.push({ jobID, socketId: req.headers['socket-id'] });
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
    buildJobs[jobID].status = 'building';

    try {
        await axios.post(`https://api.github.com/repos/${GITHUB_REPO}/dispatches`, {
            event_type: 'build-exe',
            client_payload: { jobID, downloadUrl: `${SERVER_URL}/api/internal/download-source/${jobID}`, uploadUrl: `${SERVER_URL}/api/internal/upload-exe/${jobID}` }
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

app.post('/api/internal/upload-exe/:id', uploadExe.single('exe'), (req, res) => {
    const jobID = req.params.id;
    const exeFile = req.file;
    const jobData = activeJobsData[jobID];

    if (exeFile && jobData) {
        const finalExeName = `${jobData.safeFileName}_${jobID}.exe`;
        fs.renameSync(exeFile.path, path.join(buildsDir, finalExeName));
        buildJobs[jobID] = { status: 'ready', file: finalExeName };
        io.emit('build-complete', { jobID, file: finalExeName });
        setTimeout(() => fs.existsSync(path.join(buildsDir, finalExeName)) && fs.unlinkSync(path.join(buildsDir, finalExeName)), 60000);
    }
    delete activeJobsData[jobID];
    isBuilding = false;
    res.send('OK');
    processQueue();
});

app.get('/build-status/:id', (req, res) => res.json(buildJobs[req.params.id] || { error: "Not found" }));

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
