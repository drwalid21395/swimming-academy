@echo off
title Academy Server Launcher
cd /d "%~dp0"

netstat -ano | findstr ":3000" | findstr "LISTENING" >nul 2>&1
if %errorlevel%==0 (
  echo Server already running on http://localhost:3000
) else (
  echo Starting server...
  start "Academy Server" /min "C:\Program Files\nodejs\node.exe" server.js
  timeout /t 3 /nobreak >nul
)
start "" "http://localhost:3000"
