@echo off
rem Double-click this file to start HookLab (Windows).
rem First run installs everything it needs; after that it just starts. Close the window to quit.

cd /d "%~dp0"
title HookLab
echo.
echo   Starting HookLab...
echo.

where node >nul 2>nul
if errorlevel 1 (
  start "" "https://nodejs.org/en/download"
  echo   HookLab needs Node.js, which is free. Your browser is opening nodejs.org:
  echo   install the LTS version, then double-click Start HookLab again.
  echo.
  pause
  exit /b 1
)

node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>20||(a===20&&b>=12)?0:1)"
if errorlevel 1 (
  start "" "https://nodejs.org/en/download"
  echo   Your Node.js is too old. Install the LTS version from nodejs.org,
  echo   then double-click Start HookLab again.
  echo.
  pause
  exit /b 1
)

rem Install on first run, and again whenever package-lock.json is newer than the last install.
node -e "const fs=require('fs');try{process.exit(fs.statSync('package-lock.json').mtimeMs>fs.statSync('node_modules/.package-lock.json').mtimeMs?1:0)}catch{process.exit(1)}"
if errorlevel 1 (
  echo   Installing HookLab. This takes a minute or two the first time...
  echo.
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo   Installing failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)

call npm start
if errorlevel 1 pause
