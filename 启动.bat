@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [!] Node.js not found on this computer.
  echo.
  echo   Please install Node.js 22 or newer from https://nodejs.org
  echo   Then close this window and double-click this file again.
  echo.
  pause
  exit /b 1
)
node scripts\launcher.mjs
if errorlevel 1 (
  echo.
  echo   Something went wrong. Press any key to close.
  echo.
  pause
)
