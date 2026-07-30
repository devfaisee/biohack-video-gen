const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const { spawn, execSync } = require('child_process');
const http = require('http');
const fs = require('fs');

const RAILWAY_URL = 'https://biohack-video-gen-server-production.up.railway.app';
const LOCAL_PORT = 5001;
const LOCAL_URL = `http://localhost:${LOCAL_PORT}`;

let mainWindow = null;
let splashWindow = null;
let serverProcess = null;
let activeMode = 'railway';

// ─── Paths ──────────────────────────────────────────────────────────
const serverDir = path.join(__dirname, '..', 'server');
const serverScript = path.join(serverDir, 'server.js');

// ─── Find Node.js executable (Electron doesn't inherit full PATH) ───
function findNodePath() {
  // 1. Try the exact node binary that launched Electron's npm script
  if (process.env.npm_execpath) {
    const npmDir = path.dirname(process.env.npm_execpath);
    const candidate = path.join(npmDir, '..', 'node.exe');
    if (fs.existsSync(candidate)) return candidate;
  }

  // 2. Check well-known Windows install locations
  const candidates = [
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'nodejs', 'node.exe'),
    path.join(process.env.APPDATA || '', '..', 'Local', 'Programs', 'node', 'node.exe'),
    'C:\\Program Files\\nodejs\\node.exe',
    'C:\\Program Files (x86)\\nodejs\\node.exe',
    `C:\\Users\\${process.env.USERNAME || 'user'}\\AppData\\Roaming\\nvm\\current\\node.exe`,
  ];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) { execSync(`"${c}" --version`, { stdio: 'ignore' }); return c; } } catch (_) {}
  }

  // 3. Use `where node` (cmd shell on Windows)
  try {
    const found = execSync('where node', { shell: 'cmd.exe', encoding: 'utf-8' }).trim().split('\n')[0].trim();
    if (found && fs.existsSync(found)) return found;
  } catch (_) {}

  // 4. Fallback — hope node is on PATH
  return 'node';
}

// ─── Wait until local server is ready ──────────────────────────────
function waitForServer(url, maxRetries = 50) {
  return new Promise((resolve, reject) => {
    let tries = 0;
    const check = () => {
      tries++;
      const req = http.get(`${url}/api/health`, (res) => {
        if (res.statusCode === 200) return resolve();
        if (tries >= maxRetries) return reject(new Error('Server failed to start'));
        setTimeout(check, 600);
      });
      req.on('error', () => {
        if (tries >= maxRetries) return reject(new Error('Server failed to start'));
        setTimeout(check, 600);
      });
      req.end();
    };
    check();
  });
}

// ─── Start local server process ────────────────────────────────────
function startLocalServer(onLog) {
  if (serverProcess) return; // already running

  // Load .env into env vars
  const envPath = path.join(serverDir, '.env');
  const envVars = { ...process.env };
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const eqIdx = line.indexOf('=');
      if (eqIdx > 0) {
        const key = line.slice(0, eqIdx).trim();
        const val = line.slice(eqIdx + 1).trim();
        if (key && !key.startsWith('#')) envVars[key] = val;
      }
    }
  }
  envVars.PORT = String(LOCAL_PORT);

  const nodePath = findNodePath();
  console.log(`[DESKTOP] Using node: ${nodePath}`);

  try {
    serverProcess = spawn(nodePath, [serverScript], {
      cwd: serverDir,
      env: envVars,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch (spawnErr) {
    console.error('[DESKTOP] Failed to spawn server:', spawnErr.message);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('server-log', `[FATAL] Failed to start local server: ${spawnErr.message}`);
    }
    return;
  }

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
    if (!msg) return;
    console.error('[SERVER ERR]', msg);
    if (onLog) onLog(`[ERR] ${msg}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('server-log', `[ERR] ${msg}`);
    }
  });

  serverProcess.on('error', (err) => {
    console.error('[DESKTOP] Server process error:', err.message);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('server-log', `[FATAL] Server process error: ${err.message}. Make sure Node.js is installed.`);
    }
    serverProcess = null;
  });

  serverProcess.on('exit', (code) => {
    console.log(`[SERVER] Exited with code ${code}`);
    serverProcess = null;
  });
}

async function stopLocalServer() {
  // First try graceful cancel via API
  try {
    await new Promise((resolve) => {
      const req = http.request(`${LOCAL_URL}/api/cancel`, { method: 'POST' }, (res) => {
        res.resume(); resolve();
      });
      req.on('error', resolve);
      req.end();
    });
  } catch (_) {}

  // Then kill the process
  if (serverProcess) {
    try {
      if (process.platform === 'win32') {
        // On Windows, SIGTERM is unreliable — use taskkill on the whole process tree
        execSync(`taskkill /PID ${serverProcess.pid} /T /F`, { stdio: 'ignore' });
      } else {
        serverProcess.kill('SIGTERM');
      }
    } catch (_) {}
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
  });
  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
  splashWindow.center();
}

// ─── Main Window ───────────────────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'NeuroGen Studio',
    backgroundColor: '#0a0a0f',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Load the local built React app via file:// — NOT the Railway URL.
  // The React app handles API routing via ServerCtx (Railway vs localhost:5001).
  // preload.js injects window.desktopAPI — this only works with file:// or trusted origins.
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

  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ─── IPC Handlers ──────────────────────────────────────────────────
ipcMain.handle('get-mode', () => activeMode);
ipcMain.handle('get-railway-url', () => RAILWAY_URL);
ipcMain.handle('get-local-url', () => LOCAL_URL);

ipcMain.handle('switch-mode', async (event, mode) => {
  activeMode = mode;
  if (mode === 'local') {
    startLocalServer((log) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('server-log', log);
      }
    });
    try {
      await waitForServer(LOCAL_URL, 60); // wait up to ~36 seconds
      return { success: true, url: LOCAL_URL };
    } catch (e) {
      const nodePath = findNodePath();
      return { success: false, error: `Local server failed to start.\nNode path: ${nodePath}\nMake sure Node.js is installed and server/.env has valid API keys.` };
    }
  } else {
    await stopLocalServer();
    return { success: true, url: RAILWAY_URL };
  }
});

ipcMain.handle('cancel-generation', async () => {
  try {
    await new Promise((resolve, reject) => {
      const req = http.request(`${LOCAL_URL}/api/cancel`, { method: 'POST' }, (res) => {
        res.resume(); resolve();
      });
      req.on('error', reject);
      req.end();
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
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
      return { name: f, path: fullPath, size: stat.size, created: stat.birthtime };
    })
    .sort((a, b) => new Date(b.created) - new Date(a.created));
});

ipcMain.handle('open-file', (event, filePath) => shell.openPath(filePath));
ipcMain.handle('show-item-in-folder', (event, filePath) => shell.showItemInFolder(filePath));

// ─── App Lifecycle ─────────────────────────────────────────────────
app.whenReady().then(() => {
  createSplash();
  setTimeout(() => createMainWindow(), 1500);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', async () => {
  await stopLocalServer();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  stopLocalServer();
});
