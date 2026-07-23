@echo off
setlocal

set "ROOT=%~dp0"
set "BACKEND_PYTHON=%ROOT%.venv\Scripts\python.exe"
set "FRONTEND_DIR=%ROOT%frontend"
set "APP_URL=http://127.0.0.1:22026"

if not exist "%BACKEND_PYTHON%" (
  echo Missing backend virtualenv: "%BACKEND_PYTHON%"
  echo Run: python -m venv .venv ^&^& .venv\Scripts\pip install -r backend\requirements.txt
  pause
  exit /b 1
)

if not exist "%FRONTEND_DIR%\package.json" (
  echo Missing frontend package.json: "%FRONTEND_DIR%\package.json"
  pause
  exit /b 1
)

if not exist "%FRONTEND_DIR%\node_modules" (
  echo Missing frontend dependencies in "%FRONTEND_DIR%\node_modules"
  echo Run: cd frontend ^&^& npm install
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found in PATH. Install Node.js and make sure npm is available.
  pause
  exit /b 1
)

start "Etymae Backend" /D "%ROOT%" "%BACKEND_PYTHON%" -m uvicorn backend.app.main:app --reload --port 20262
start "Etymae Frontend" cmd /k "cd /d ""%FRONTEND_DIR%"" && npm run dev -- --host"

timeout /t 2 >nul
start "" "%APP_URL%"
