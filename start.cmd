@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22+ was not found. Install from https://nodejs.org/ then reopen this window.
  pause
  exit /b 1
)
node -e "if(Number(process.versions.node.split('.')[0])<22){console.error('Node.js 22+ is required.');process.exit(1)}"
if errorlevel 1 (
  pause
  exit /b 1
)
node "%~dp0scripts\build.mjs"
if errorlevel 1 (
  pause
  exit /b 1
)
if not defined CODEX_WORKSPACE set /p "CODEX_WORKSPACE=Enter the full project directory path (without quotes): "
node -e "const fs=require('node:fs');try{if(!process.env.CODEX_WORKSPACE||!fs.statSync(process.env.CODEX_WORKSPACE).isDirectory())throw Error();}catch{console.error('A valid existing project directory is required.');process.exit(1)}"
if errorlevel 1 (
  pause
  exit /b 1
)
echo Starting Codex Controller. Open the local address printed below.
echo Keep this window open. Press Ctrl+C to stop.
node "%~dp0server.mjs"
set "result=%errorlevel%"
if not "%result%"=="0" pause
exit /b %result%
