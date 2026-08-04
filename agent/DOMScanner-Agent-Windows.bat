@echo off
title DOMScanner Desktop Agent Setup
color 0A
cls
echo ======================================================
echo       📡 Welcome to DOMScanner Desktop Agent
echo ======================================================
echo.

:: Check Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ❌ Node.js is required to run DOMScanner Agent.
    echo 📥 Opening Node.js download page...
    start https://nodejs.org
    echo.
    echo Please install Node.js and double-click this file again.
    pause
    exit /b
)

set "AGENT_DIR=%LOCALAPPDATA%\DOMScannerAgent"
if not exist "%AGENT_DIR%" mkdir "%AGENT_DIR%"

cd /d "%AGENT_DIR%"

echo 📦 Setting up DOMScanner Agent components...

:: 1. Copy or download dom-agent-gui.js
if exist "%~dp0dom-agent-gui.js" (
    copy /y "%~dp0dom-agent-gui.js" "%AGENT_DIR%\dom-agent-gui.js" >nul
) else (
    powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'http://localhost:7890/agent/dom-agent-gui.js' -OutFile '%AGENT_DIR%\dom-agent-gui.js'" >nul 2>nul
)

:: 2. Copy or download agent-gui.html
if exist "%~dp0agent-gui.html" (
    copy /y "%~dp0agent-gui.html" "%AGENT_DIR%\agent-gui.html" >nul
) else (
    powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'http://localhost:7890/agent/agent-gui.html' -OutFile '%AGENT_DIR%\agent-gui.html'" >nul 2>nul
)

:: Ensure ws module is available if node version is < 21
node -e "if (!globalThis.WebSocket) process.exit(1)" >nul 2>nul
if %errorlevel% neq 0 (
    if not exist "%AGENT_DIR%\node_modules\ws" (
        echo 📦 Installing helper dependencies...
        call npm install ws --no-audit --no-fund --quiet >nul 2>nul
    )
)

echo ✅ DOMScanner Desktop Agent is running in the background!
echo 🌐 Open your Cloud Web Dashboard to scan this network.
echo.

:: Launch Background Agent
node "%AGENT_DIR%\dom-agent-gui.js" %*

if %errorlevel% neq 0 (
    echo.
    echo ❌ Agent stopped with error code %errorlevel%.
    echo Press any key to exit...
    pause >nul
)
