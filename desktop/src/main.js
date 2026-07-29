const { app, BrowserWindow, ipcMain, shell, Tray, Menu, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

const RAILWAY_URL = 'https://biohack-video-gen-server-production.up.railway.app';
const LOCAL_PORT = 5001; // Use 5001 to avoid conflicts if Railway mode's 5000 is cached
const LOCAL_URL = `http://localhost:${LOCAL_PORT}`;

let mainWindow = null;
let splashWindow = null;
let serverProcess = null;
let tray = null;
let activeMode = 'railway'; // 'railway' | 'local'

// ─── Paths ──────────────────────────────────────────────────────────
const serverDir = path.join(__dirname, '..', 'server');
const clientDist = path.join(__dirname, '..', 'client', 'dist');
const serverScript = path.join(serverDir, 'server.js');

// ─── Wait until local server is ready ──────────────────────────────
function waitForServer(url, maxRetries = 40) {
  return new Promise((resolve, reject) => {
    let tries = 0;
    const check = () => {
      tries++;
      const req = http.get(`${url}/api/health`, (res) => {
        if (res.statusCode === 200) return resolve();
        if (tries >= maxRetries) return reject(new Error('Server failed to start'));
        setTimeout(check, 800);
      });
      req.on('error', () => {
        if (tries >= maxRetries) return reject(new Error('Server failed to start'));
        setTimeout(check, 800);
      });
      req.end();
    };
    check();
  });
}

// ─── Start local server process ────────────────────────────────────
function startLocalServer(onLog) {
  if (serverProcess) return;

  const envPath = path.join(serverDir, '.env');
  let envVars = { ...process.env };

  // Load .env file manually
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const [key, ...vals] = line.trim().split('=');
      if (key && vals.length) envVars[key] = vals.join('=');
    }
  }

  envVars.PORT = String(LOCAL_PORT);

  serverProcess = spawn('node', [serverScript], {
    cwd: serverDir,
    env: envVars,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  serverProcess.stdout.on('data', (d) => {
    const msg = d.toString().trim();
    console.log('[SERVER]', msg);
    if (onLog) onLog(msg);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('server-log', msg);
    }
  });

  serverProcess.stderr.on('data', (d) => {
    const msg = d.toString().trim();
    console.error('[SERVER ERR]', msg);
    if (onLog) onLog(msg);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('server-log', '[ERR] ' + msg);
    }
  });

  serverProcess.on('exit', (code) => {
    console.log(`[SERVER] Exited with code ${code}`);
    serverProcess = null;
  });
}

function stopLocalServer() {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
    serverProcess = null;
  }
}

// ─── Splash Screen ─────────────────────────────────────────────────
function createSplash() {
  splashWindow = new BrowserWindow({
    width: 500,
    height: 340,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
    icon: path.join(__dirname, 'icon.ico'),
  });
  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
  splashWindow.center();
}

// ─── Main Window ───────────────────────────────────────────────────
function createMainWindow(targetUrl) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'NeuroGen Studio',
    icon: path.join(__dirname, 'icon.ico'),
    backgroundColor: '#0a0a0f',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // CRITICAL: Load the LOCAL built React app — NOT the Railway URL.
  // The React app (App.jsx) handles all API routing via ServerCtx (Railway vs localhost:5001).
  // Loading a remote URL here would block preload.js from injecting window.desktopAPI.
  const distIndex = path.join(__dirname, '..', '..', 'client', 'dist', 'index.html');
  mainWindow.loadFile(distIndex);

  mainWindow.once('ready-to-show', () => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
      splashWindow = null;
    }
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ─── IPC Handlers ──────────────────────────────────────────────────
ipcMain.handle('get-mode', () => activeMode);
ipcMain.handle('get-railway-url', () => RAILWAY_URL);
ipcMain.handle('get-local-url', () => LOCAL_URL);
ipcMain.handle('get-server-status', async () => {
  if (activeMode === 'railway') return { ok: true, url: RAILWAY_URL };
  try {
    await waitForServer(LOCAL_URL, 1);
    return { ok: true, url: LOCAL_URL };
  } catch {
    return { ok: false, url: LOCAL_URL };
  }
});

ipcMain.handle('switch-mode', async (event, mode) => {
  activeMode = mode;
  if (mode === 'local') {
    startLocalServer((log) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('server-log', log);
      }
    });
    // Wait for server to be ready
    try {
      await waitForServer(LOCAL_URL, 50);
    } catch (e) {
      return { success: false, error: 'Local server failed to start. Check your .env file.' };
    }
    return { success: true, url: LOCAL_URL };
  } else {
    stopLocalServer();
    return { success: true, url: RAILWAY_URL };
  }
});

ipcMain.handle('open-output-folder', () => {
  const outputDir = path.join(serverDir, 'output');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  shell.openPath(outputDir);
});

ipcMain.handle('get-output-videos', () => {
  const outputDir = path.join(serverDir, 'output');
  if (!fs.existsSync(outputDir)) return [];
  return fs.readdirSync(outputDir)
    .filter(f => f.endsWith('.mp4') || f.endsWith('.mov'))
    .map(f => {
      const fullPath = path.join(outputDir, f);
      const stat = fs.statSync(fullPath);
      return {
        name: f,
        path: fullPath,
        size: stat.size,
        created: stat.birthtime,
      };
    })
    .sort((a, b) => new Date(b.created) - new Date(a.created));
});

ipcMain.handle('open-file', (event, filePath) => {
  shell.openPath(filePath);
});

ipcMain.handle('show-item-in-folder', (event, filePath) => {
  shell.showItemInFolder(filePath);
});

// ─── App Lifecycle ─────────────────────────────────────────────────
app.whenReady().then(async () => {
  createSplash();

  // Default to Railway (no local server needed, faster startup)
  activeMode = 'railway';
  const targetUrl = RAILWAY_URL;

  // Give splash 1.5s then open main
  setTimeout(() => {
    createMainWindow(targetUrl);
  }, 1500);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow(targetUrl);
  });
});

app.on('window-all-closed', () => {
  stopLocalServer();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  stopLocalServer();
});
