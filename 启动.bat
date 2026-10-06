@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [!] Node.js not found on this computer.
  echo.
  echo   Please install Node.js 22 or newer from https://nodejs.org
  echo   After installing, close this window and double-click this file again.
  echo.
  pause
  exit /b 1
)
node scripts\check.mjs --launch
echo.
pause
