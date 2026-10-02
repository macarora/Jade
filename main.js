const { app, BrowserWindow, ipcMain, shell, dialog, nativeTheme } = require('electron');
const path = require('path');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const http = require('http');
const os = require('os');

let mainWindow    = null;
let splashWindow  = null;
let backendProcess = null;
let ollamaProcess  = null;
let sourcesDir     = '';   // set during boot from user config or first-run dialog

// ── Config file ────────────────────────────────────────────────────────────
function _configPath() { return path.join(app.getPath('userData'), 'jade-config.json'); }
function loadConfig()  { try { return JSON.parse(fs.readFileSync(_configPath(), 'utf8')); } catch { return {}; } }
function saveConfig(d) { try { fs.writeFileSync(_configPath(), JSON.stringify(d, null, 2)); } catch (_) {} }

const isDev = !app.isPackaged;

// ── Paths ──────────────────────────────────────────────────────────────────
const portableExeDir = process.env.PORTABLE_EXECUTABLE_DIR;
const usbRootDir = isDev ? __dirname : (portableExeDir || path.dirname(process.execPath));

// Portable mode: portable.flag in resources means data lives next to the exe (on the HD)
const isPortable = !isDev && fs.existsSync(path.join(process.resourcesPath, 'portable.flag'));
if (isPortable) {
  app.setPath('userData', path.join(path.dirname(process.execPath), 'UserData'));
}

const userDataPath = app.getPath('userData');   // AppData/Roaming/Jade  (or ./UserData in portable)

// In production, use bundled models so app works fully offline from first launch
const modelsDir = isDev
  ? path.join(__dirname, 'ollama', 'models')
  : path.join(process.resourcesPath, 'ollama_models');

if (!fs.existsSync(modelsDir)) fs.mkdirSync(modelsDir, { recursive: true });

// Log file lives in userData so it's always writable
const logFile = path.join(userDataPath, 'launcher.log');
try { fs.writeFileSync(logFile, ''); } catch (_) {}
const logStream = fs.createWriteStream(logFile, { flags: 'a' });

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  console.log(msg);
  try { logStream.write(line); } catch (_) {}
}

log('--- Jade Desktop Launcher ---');
log(`Dev mode : ${isDev}`);
log(`userData : ${userDataPath}`);
log(`modelsDir: ${modelsDir}`);

// ── Splash window ──────────────────────────────────────────────────────────
function updateSplashStatus(message) {
  log(message);
}

function splashStep(id, status, detail = '') {
  if (splashWindow && !splashWindow.webContents.isDestroyed()) {
    splashWindow.webContents.send('step', { id, status, detail });
  }
}

function createSplashWindow() {
  const splashHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    background:#0b0b0f; color:#e8e8ee;
    font-family:'Segoe UI',system-ui,sans-serif;
    display:flex; flex-direction:column; align-items:center; justify-content:center;
    height:100vh; user-select:none; -webkit-app-region:drag;
  }
  .logo-mark { width:60px; height:60px; margin-bottom:14px; }
  .name { font-size:21px; font-weight:700; color:#e8e8ee; letter-spacing:-0.4px; margin-bottom:3px; }
  .tagline { font-size:11px; color:#6b6b7a; margin-bottom:26px; letter-spacing:0.04em; }
  .steps { display:flex; flex-direction:column; gap:10px; min-width:240px; }
  .step { display:flex; align-items:center; gap:10px; opacity:0.2; transition:opacity 0.3s; }
  .step.active { opacity:1; }
  .step.done { opacity:0.5; }
  .step.error { opacity:1; }
  .icon { width:18px; height:18px; flex-shrink:0; display:flex; align-items:center; justify-content:center; }
  .spin { width:14px; height:14px; border:2px solid #252532; border-top-color:#60a5fa;
          border-radius:50%; animation:spin 0.8s linear infinite; }
  @keyframes spin { to { transform:rotate(360deg); } }
  .check { color:#60a5fa; font-size:15px; }
  .err   { color:#f85149; font-size:15px; }
  .label { font-size:12px; color:#c9c9d4; }
  .detail { font-size:10px; color:#6b6b7a; margin-top:1px; }
</style>
</head>
<body>
  <svg class="logo-mark" width="64" height="64" viewBox="0 0 30 30" fill="none">
    <circle cx="15" cy="15" r="15" fill="#2563eb"/>
    <path d="M15 7v16M7 15h16M11.2 11.2l7.6 7.6M18.8 11.2l-7.6 7.6" stroke="white" stroke-width="2.4" stroke-linecap="round"/>
  </svg>
  <div class="name">Jade</div>
  <div class="tagline">your offline second brain</div>
  <div class="steps">
    <div class="step" id="s-ollama">
      <div class="icon"><div class="spin"></div></div>
      <div><div class="label">Starting AI engine…</div><div class="detail" id="d-ollama"></div></div>
    </div>
    <div class="step" id="s-backend">
      <div class="icon"><div class="spin"></div></div>
      <div><div class="label" id="l-backend">Starting backend…</div><div class="detail" id="d-backend"></div></div>
    </div>
    <div class="step" id="s-launch">
      <div class="icon"><div class="spin"></div></div>
      <div><div class="label">Launching Jade</div></div>
    </div>
  </div>
  <script>
    const { ipcRenderer } = require('electron');
    ipcRenderer.on('step', (_, { id, status, detail }) => {
      const el = document.getElementById('s-' + id);
      if (!el) return;
      el.className = 'step ' + status;
      const icon = el.querySelector('.icon');
      if (status === 'active') {
        icon.innerHTML = '<div class="spin"></div>';
      } else if (status === 'done') {
        icon.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 5" stroke="#60a5fa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      } else if (status === 'error') {
        icon.innerHTML = '<span class="err">✕</span>';
      }
      const dEl = document.getElementById('d-' + id);
      if (dEl && detail) dEl.textContent = detail;
      const lEl = document.getElementById('l-' + id);
      if (lEl && detail && id === 'backend') lEl.textContent = detail;
    });
  </script>
</body>
</html>`;

  const splashPath = path.join(userDataPath, '_splash.html');
  fs.writeFileSync(splashPath, splashHtml);

  splashWindow = new BrowserWindow({
    width: 440, height: 260,
    frame: false, transparent: false,
    resizable: false, show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  splashWindow.loadFile(splashPath);
  splashWindow.once('ready-to-show', () => {
    splashWindow.show();
    splashStep('ollama', 'active', 'Connecting to GPU…');
  });
  splashWindow.on('closed', () => { splashWindow = null; });
}

// ── Main window ────────────────────────────────────────────────────────────
function createWindow() {
  const BACKEND_PORT = 3001;
  // Always load from the Python backend (which serves the built frontend).
  // To use the Vite dev server instead, pass --vite on the command line.
  const useVite = process.argv.includes('--vite');
  const url = useVite ? `http://localhost:3000` : `http://localhost:${BACKEND_PORT}`;

  mainWindow = new BrowserWindow({
    width: 1280, height: 800,
    minWidth: 1024, minHeight: 680,
    title: 'Jade',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#16161a', symbolColor: '#ffffff', height: 42 },
    webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadURL(url);

  // If the renderer dies (e.g. killed under memory pressure) reload instead of leaving a white window
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    log(`[Window] Renderer gone: ${details.reason} (exit ${details.exitCode}) — reloading`);
    setTimeout(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(url); }, 1000);
  });
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, _url, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3 = aborted (normal on navigation)
    log(`[Window] Load failed: ${desc} (${code}) — retrying`);
    setTimeout(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(url); }, 2000);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url);
    } else if (url.startsWith('file:')) {
      shell.openPath(decodeURIComponent(url.replace(/^file:\/\/\/?/, '')));
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const current = mainWindow.webContents.getURL();
    if (url !== current) {
      event.preventDefault();
      if (url.startsWith('file:')) {
        shell.openPath(decodeURIComponent(url.replace(/^file:\/\/\/?/, '')));
      } else {
        shell.openExternal(url);
      }
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── Polling helpers ────────────────────────────────────────────────────────
function checkPortActive(port, host, cb) {
  const s = new net.Socket();
  s.setTimeout(300);
  s.on('connect', () => { s.destroy(); cb(true); });
  s.on('timeout', () => { s.destroy(); cb(false); });
  s.on('error',   () => { s.destroy(); cb(false); });
  s.connect(port, host);
}

function pollPort(port, label, timeoutMs, cb) {
  let attempts = 0;
  const max = Math.ceil(timeoutMs / 250);
  const iv = setInterval(() => {
    attempts++;
    checkPortActive(port, '127.0.0.1', active => {
      if (active) { clearInterval(iv); cb(true); }
      else if (attempts >= max) { clearInterval(iv); cb(false); }
    });
  }, 250);
}

function checkModelInstalled(modelName, cb) {
  http.get('http://localhost:11434/api/tags', res => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      try {
        const models = JSON.parse(data).models || [];
        cb(models.some(m => m.name === modelName || m.name.startsWith(modelName + ':')));
      } catch (_) { cb(false); }
    });
  }).on('error', () => cb(false));
}

// ── Ollama ─────────────────────────────────────────────────────────────────
function startOllamaService() {
  const ollamaDir = isDev
    ? path.join(__dirname, 'ollama')
    : path.join(process.resourcesPath, 'ollama');
  const ollamaExe = path.join(ollamaDir, 'ollama.exe');

  log('Starting Ollama…');

  ollamaProcess = spawn(ollamaExe, ['serve'], {
    env: {
      ...process.env,
      OLLAMA_MODELS: modelsDir,
      OLLAMA_KEEP_ALIVE: '-1',
      // llama-server's prompt cache defaults to 8 GB of RAM and grows with every
      // unique prompt (connection checks) until Windows kills the renderer.
      LLAMA_ARG_CACHE_RAM: '512',
    },
    cwd: ollamaDir,
  });

  ollamaProcess.stdout?.on('data', d => log(`[Ollama] ${d.toString().trim()}`));
  ollamaProcess.stderr?.on('data', d => log(`[Ollama] ${d.toString().trim()}`));
  ollamaProcess.on('error', err => log(`[Ollama spawn error] ${err.message}`));
  ollamaProcess.on('exit',  (code, sig) => log(`[Ollama exited] code=${code} sig=${sig}`));
}

// ── Python backend ─────────────────────────────────────────────────────────
async function startBackendService() {
  const BACKEND_PORT = 3001;

  const frontendDist = isDev
    ? path.join(__dirname, 'frontend', 'dist')
    : path.join(process.resourcesPath, 'frontend', 'dist');

  const modelsCacheDir = isDev
    ? path.join(__dirname, 'python_backend', 'models_cache')
    : path.join(process.resourcesPath, 'models_cache');

  let backendExe, backendArgs, backendCwd;
  if (isDev) {
    backendExe  = path.join(__dirname, 'python_backend', 'venv', 'Scripts', 'python.exe');
    backendArgs = [path.join(__dirname, 'python_backend', 'main.py'), String(BACKEND_PORT)];
    backendCwd  = path.join(__dirname, 'python_backend');
  } else {
    backendExe  = path.join(process.resourcesPath, 'backend', 'backend.exe');
    backendArgs = [String(BACKEND_PORT)];
    backendCwd  = path.join(process.resourcesPath, 'backend');
  }

  // Kill any stale process already holding the backend port (e.g. from a previous dev run).
  // Use Node's net module — the cmd.exe for/f loop is unreliable on some Windows builds.
  await new Promise(resolve => {
    const probe = require('net').createConnection(BACKEND_PORT, '127.0.0.1');
    probe.once('connect', () => {
      probe.destroy();
      // Port is occupied — kill it via taskkill
      try {
        execSync(`netstat -ano | findstr :${BACKEND_PORT} | findstr LISTENING`, { shell: 'cmd.exe', stdio: 'pipe' })
          .toString().trim().split('\n')
          .forEach(line => {
            const pid = line.trim().split(/\s+/).pop();
            if (pid && /^\d+$/.test(pid) && pid !== '0')
              try { execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' }); } catch (_) {}
          });
      } catch (_) {}
      setTimeout(resolve, 500);
    });
    probe.once('error', () => { probe.destroy(); resolve(); });
    probe.setTimeout(400, () => { probe.destroy(); resolve(); });
  });

  log(`Spawning backend: ${backendExe}`);

  backendProcess = spawn(backendExe, backendArgs, {
    windowsHide: true,
    env: {
      ...process.env,
      JADE_FRONTEND_DIR:  frontendDist,
      JADE_DATA_DIR:      userDataPath,
      JADE_UPLOADS_DIR:   sourcesDir,
      JADE_MODELS_CACHE:  modelsCacheDir,
      OLLAMA_URL:        'http://localhost:11434',
      HF_HUB_OFFLINE:   '1',
      HF_HOME:           modelsCacheDir,
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8:       '1',
    },
    cwd: backendCwd,
  });

  backendProcess.stdout?.on('data', d => log(`[Backend] ${d.toString().trim()}`));
  backendProcess.stderr?.on('data', d => log(`[Backend] ${d.toString().trim()}`));
  backendProcess.on('error', err => log(`[Backend spawn error] ${err.message}`));
  backendProcess.on('exit',  code => log(`[Backend exited] code=${code}`));
}

// ── Cleanup ────────────────────────────────────────────────────────────────
function cleanUpProcesses() {
  for (const [name, proc] of [['Backend', backendProcess], ['Ollama', ollamaProcess]]) {
    if (!proc) continue;
    log(`Terminating ${name} (pid=${proc.pid})`);
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', proc.pid, '/f', '/t']);
      } else {
        proc.kill('SIGKILL');
      }
    } catch (e) { log(`Kill ${name} failed: ${e.message}`); }
  }
}

// ── IPC ────────────────────────────────────────────────────────────────────
ipcMain.on('update-titlebar-theme', (_, theme) => {
  if (!mainWindow) return;
  try {
    const isDark = theme === 'dark' || (theme === 'system' && nativeTheme.shouldUseDarkColors);
    mainWindow.setTitleBarOverlay(
      isDark
        ? { color: '#16161a', symbolColor: '#9090a0', height: 42 }
        : { color: '#ffffff', symbolColor: '#5a5a6a', height: 42 }
    );
  } catch (e) { log('Titlebar update failed: ' + e.message); }
});

ipcMain.handle('change-sources-dir', async () => {
  const result = await dialog.showOpenDialog(mainWindow || undefined, {
    title: 'Choose a new folder for your source files',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: sourcesDir || path.join(os.homedir(), 'Documents', 'JadeSources'),
    buttonLabel: 'Use this folder',
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const newDir = result.filePaths[0];
  sourcesDir = newDir;
  const cfg = loadConfig();
  cfg.sourcesDir = newDir;
  saveConfig(cfg);
  log(`[Config] Sources directory changed: ${newDir}`);
  return newDir;
});

// ── Hardware detection ─────────────────────────────────────────────────────
function detectRequiredModel() {
  const ramGb = os.totalmem() / (1024 ** 3);
  let vramGb = 0;
  try {
    const out = execSync('nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits', { timeout: 5000 }).toString().trim();
    vramGb = parseFloat(out.split('\n')[0]) / 1024;
  } catch (_) {}
  const model = (ramGb >= 12 && vramGb >= 6) ? 'qwen2.5:7b' : 'gemma2:2b';  // 4 GB VRAM cards (RTX 3050) crash with 7B
  log(`Hardware: RAM=${ramGb.toFixed(1)}GB VRAM=${vramGb.toFixed(1)}GB → model=${model}`);
  return model;
}

// ── Single instance ────────────────────────────────────────────────────────
// A second copy would fight over the Ollama/backend ports — focus the first instead.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = mainWindow || splashWindow;
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

// ── Boot sequence ──────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  if (!app.hasSingleInstanceLock()) return;
  createSplashWindow();

  // First-run: ask where to save source files (PDFs, videos, etc.)
  const cfg = loadConfig();
  if (!cfg.sourcesDir) {
    log('Choose where to save your source files…');
    const result = await dialog.showOpenDialog({
      title: 'Where should Jade save your source files?',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: path.join(os.homedir(), 'Documents', 'JadeSources'),
      buttonLabel: 'Use this folder',
    });
    cfg.sourcesDir = (!result.canceled && result.filePaths[0])
      ? result.filePaths[0]
      : path.join(userDataPath, 'uploads');
    saveConfig(cfg);
    log(`[Config] Sources directory set: ${cfg.sourcesDir}`);
  }
  sourcesDir = cfg.sourcesDir;
  if (!fs.existsSync(sourcesDir)) fs.mkdirSync(sourcesDir, { recursive: true });

  startOllamaService();

  const requiredModel = detectRequiredModel();

  // Status nudges while waiting — reassures the user on slow hardware
  const ot30 = setTimeout(() => splashStep('ollama', 'active', 'Discovering GPU — may take a minute…'), 30_000);
  const ot60 = setTimeout(() => splashStep('ollama', 'active', 'CUDA warming up — almost there…'), 60_000);
  const ot90 = setTimeout(() => splashStep('ollama', 'active', 'Still warming up…'), 90_000);

  // Wait for Ollama (120 s — CUDA init can be slow on first launch)
  pollPort(11434, 'Ollama', 120_000, ollamaActive => {
    clearTimeout(ot30); clearTimeout(ot60); clearTimeout(ot90);
    if (!ollamaActive) {
      splashStep('ollama', 'error', 'Failed to start — check launcher.log');
      return;
    }

    checkModelInstalled(requiredModel, installed => {
      if (!installed) {
        splashStep('ollama', 'active', 'Downloading AI model — first run only…');
        const ollamaExe = isDev
          ? path.join(__dirname, 'ollama', 'ollama.exe')
          : path.join(process.resourcesPath, 'ollama', 'ollama.exe');
        const pull = spawn(ollamaExe, ['pull', requiredModel]);
        pull.stdout?.on('data', d => log(`[pull] ${d.toString().trim()}`));
        pull.stderr?.on('data', d => log(`[pull] ${d.toString().trim()}`));
        pull.on('exit', () => bootBackend());
      } else {
        bootBackend();
      }
    });
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

async function bootBackend() {
  splashStep('ollama', 'done', 'AI engine ready');
  splashStep('backend', 'active', 'Starting backend…');
  await startBackendService();   // wait for old process killed + new one spawned

  const bt30  = setTimeout(() => splashStep('backend', 'active', 'Loading Python packages…'), 30_000);
  const bt60  = setTimeout(() => splashStep('backend', 'active', 'Loading AI components…'), 60_000);
  const bt120 = setTimeout(() => splashStep('backend', 'active', 'Still loading — almost there…'), 120_000);
  const bt240 = setTimeout(() => splashStep('backend', 'active', 'Still starting up…'), 240_000);

  // 6-minute timeout — Python startup + Windows Defender scanning can take 5+ minutes
  pollPort(3001, 'Backend', 360_000, backendActive => {
    clearTimeout(bt30); clearTimeout(bt60); clearTimeout(bt120); clearTimeout(bt240);
    if (backendActive) {
      splashStep('backend', 'done', 'Backend ready');
      splashStep('launch', 'active');
      setTimeout(() => {
        createWindow();
        if (splashWindow) splashWindow.close();
      }, 600);
    } else {
      splashStep('backend', 'error', 'Failed to respond — check launcher.log');
    }
  });
}

app.on('window-all-closed', () => {
  cleanUpProcesses();
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => cleanUpProcesses());
