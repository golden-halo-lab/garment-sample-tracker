@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24 LTS from https://nodejs.org first.
  pause
  exit /b 1
)
call npm install
if errorlevel 1 goto failed
call npm run build:win
if errorlevel 1 goto failed
echo The unsigned Windows installer is in the dist folder.
pause
exit /b 0
:failed
echo The build did not finish. Read the error above.
pause
exit /b 1
