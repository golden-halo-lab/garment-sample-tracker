@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24 LTS from https://nodejs.org, then run this file again.
  pause
  exit /b 1
)
echo Open http://127.0.0.1:4310 in your browser after the server starts.
echo Demo username: admin   Password: Fazil-Demo-2026!
echo Keep this window open while using the demonstration.
node server.mjs --demo
pause
