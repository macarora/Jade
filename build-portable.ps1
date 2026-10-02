# ── Jade Portable Build Script ────────────────────────────────────────────────
# Builds a portable folder you can copy to a USB SSD / external HD
# Run from the project root
# Output: dist_electron_portable/win-unpacked/   ← copy this whole folder to the HD
# ─────────────────────────────────────────────────────────────────────────────

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot

function Log($msg) { Write-Host "[Portable] $msg" -ForegroundColor Cyan }
function Ok($msg)  { Write-Host "[Portable] $msg" -ForegroundColor Green }
function Err($msg) { Write-Host "[Portable] ERROR: $msg" -ForegroundColor Red; exit 1 }

Log "=== Jade Portable Build ==="

# ── 1. Build frontend ─────────────────────────────────────────────────────────
Log "Building frontend..."
Set-Location "$Root\frontend"
npm run build
if ($LASTEXITCODE -ne 0) { Err "Frontend build failed" }
Ok "Frontend built → frontend/dist/"

# ── 2. Install PyInstaller ────────────────────────────────────────────────────
Log "Installing PyInstaller..."
Set-Location "$Root\python_backend"
& ".\venv\Scripts\pip.exe" install pyinstaller --quiet
if ($LASTEXITCODE -ne 0) { Err "PyInstaller install failed" }
Ok "PyInstaller ready"

# ── 3. Bundle Python backend ──────────────────────────────────────────────────
Log "Bundling Python backend (this takes 5-10 minutes)..."
Set-Location "$Root\python_backend"
& ".\venv\Scripts\pyinstaller.exe" backend.spec --clean --noconfirm
if ($LASTEXITCODE -ne 0) { Err "PyInstaller build failed" }
Ok "Backend bundled → python_backend/dist/backend/"

# ── 4. Download offline models (embedding + Whisper) ──────────────────────────
# Stored in the HuggingFace hub layout under python_backend/models_cache/hub so the
# packaged backend finds them with no internet. Already-downloaded files are reused.
Log "Preparing offline models (embedding + Whisper)..."
Set-Location "$Root\python_backend"
& ".\venv\Scripts\python.exe" -c "import os; os.environ.pop('HF_HUB_OFFLINE', None); from huggingface_hub import snapshot_download; [snapshot_download(r, cache_dir='models_cache/hub') for r in ('BAAI/bge-small-en-v1.5', 'Systran/faster-whisper-small')]"
if ($LASTEXITCODE -ne 0) { Err "Model download failed (internet is needed the first time)" }
Ok "Models ready → python_backend/models_cache/hub/"

# ── 5. Package with Electron Builder (portable dir target) ────────────────────
Log "Packaging portable build..."
Set-Location $Root
npx electron-builder --config electron-builder-portable.json 2>&1
if ($LASTEXITCODE -ne 0) { Err "Electron Builder failed" }
Ok "Portable build complete → dist_electron_portable/win-unpacked/"

Log ""
Ok "=== Done! ==="
Log "Copy the entire 'win-unpacked' folder to your USB SSD."
Log "Launch Jade.exe from there — data will be saved in a 'UserData' folder next to Jade.exe."
