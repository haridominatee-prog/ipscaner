@echo off
title DOMScanner Desktop Agent
color 0A
cls
echo ======================================================
echo       DOMScanner Desktop Agent - Auto Setup
echo ======================================================
echo.

:: Check Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo  Node.js is required to run DOMScanner Agent.
    echo  Opening Node.js download page...
    start https://nodejs.org
    echo.
    echo Please install Node.js and double-click this file again.
    pause
    exit /b
)

echo Node.js found:
node --version
echo.

set "AGENT_DIR=%LOCALAPPDATA%\DOMScannerAgent"
if not exist "%AGENT_DIR%" mkdir "%AGENT_DIR%"

cd /d "%AGENT_DIR%"

:: 1. Create package.json if missing (required for npm install)
if not exist "package.json" (
    echo {"name":"domscanner-agent","version":"1.0.0","description":"DOMScanner Desktop Agent"} > package.json
)

:: 2. Install ws module
echo  Installing ws WebSocket module...
call npm install ws --no-audit --no-fund --prefer-offline 2>nul
if %errorlevel% neq 0 (
    call npm install ws --no-audit --no-fund
)
echo  ws module ready.
echo.

:: 3. Copy dom-agent.js from bat location
if exist "%~dp0dom-agent.js" (
    copy /y "%~dp0dom-agent.js" "%AGENT_DIR%\dom-agent.js" >nul
    echo  Agent script updated.
)

:: 4. Clear old config so agent auto-pairs fresh each time
if exist "%AGENT_DIR%\agent-config.json" (
    del /f /q "%AGENT_DIR%\agent-config.json" >nul
)

echo.
echo  Starting DOMScanner Agent...
echo  Connecting to: https://ipscaner.onrender.com
echo  Keep this window open while scanning.
echo.

:: Launch Agent
node "%AGENT_DIR%\dom-agent.js" --server=https://ipscaner.onrender.com

echo.
echo  Agent stopped. Press any key to exit.
pause >nul
