$env:HF_HUB_OFFLINE = "1"
$env:HF_HUB_DISABLE_SYMLINKS_WARNING = "1"

$OLLAMA_EXE = "$PSScriptRoot\ollama\ollama.exe"
$OLLAMA_MODELS = "$PSScriptRoot\ollama\models"

# Start Ollama if not already running
$ollamaRunning = Get-Process ollama -ErrorAction SilentlyContinue
if (-not $ollamaRunning) {
    Write-Host "[Jade] Starting Ollama..." -ForegroundColor Cyan
    $env:OLLAMA_MODELS = $OLLAMA_MODELS
    Start-Process -FilePath $OLLAMA_EXE -ArgumentList "serve" -WindowStyle Hidden
    Start-Sleep -Seconds 3
    Write-Host "[Jade] Ollama started." -ForegroundColor Green
} else {
    Write-Host "[Jade] Ollama already running." -ForegroundColor Green
}

# Start Python backend
Write-Host "[Jade] Starting backend..." -ForegroundColor Cyan
Set-Location "$PSScriptRoot\python_backend"
& ".\venv\Scripts\python.exe" "main.py" "3001"
