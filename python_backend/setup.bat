@echo off
echo === Jade Python Backend Setup ===

:: Check Python
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python 3.11+ is required. Download from https://python.org
    pause
    exit /b 1
)

:: Create venv
if not exist venv (
    echo Creating virtual environment...
    python -m venv venv
)

:: Activate and install
call venv\Scripts\activate.bat

echo Installing CPU-only PyTorch...
pip install torch --index-url https://download.pytorch.org/whl/cpu --quiet

echo Installing remaining dependencies...
pip install -r requirements.txt --quiet

echo.
echo === Setup complete ===
echo To start the backend:
echo   venv\Scripts\activate && python main.py
pause
