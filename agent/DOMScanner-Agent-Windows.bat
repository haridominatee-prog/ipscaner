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
set "SERVER_URL=https://ipscaner.onrender.com"

if not exist "%AGENT_DIR%" mkdir "%AGENT_DIR%"

cd /d "%AGENT_DIR%"

:: 1. Create package.json if missing (required for npm install)
if not exist "package.json" (
    echo {"name":"domscanner-agent","version":"1.0.0"} > package.json
)

:: 2. Install ws module
if not exist "node_modules\ws" (
    echo  Installing ws WebSocket module...
    call npm install ws --no-audit --no-fund
    echo  Done.
    echo.
)

:: 3. Always download fresh dom-agent.js from the cloud server
echo  Downloading latest agent script from server...
powershell -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; try { Invoke-WebRequest -Uri '%SERVER_URL%/agent/dom-agent.js' -OutFile '%AGENT_DIR%\dom-agent.js' -UseBasicParsing; Write-Host ' Agent script downloaded OK.' } catch { Write-Host ' Download failed, using local copy if available.' }"
echo.

:: Check agent script exists
if not exist "%AGENT_DIR%\dom-agent.js" (
    echo  ERROR: dom-agent.js not found and download failed.
    echo  Please check your internet connection and try again.
    pause
    exit /b 1
)

:: 4. Preserve existing agent config if available
rem Agent configuration will auto-pair on first run and reuse paired key on subsequent runs.

echo.
echo  Starting DOMScanner Agent...
echo  Connecting to: %SERVER_URL%
echo  Keep this window open while scanning.
echo.

:: Launch Agent
node "%AGENT_DIR%\dom-agent.js" --server=%SERVER_URL%

echo.
echo  Agent stopped. Press any key to exit.
pause >nul
