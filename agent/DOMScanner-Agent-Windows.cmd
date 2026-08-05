@echo off
powershell -Command "Unblock-File -Path '%~f0' -ErrorAction SilentlyContinue" >nul 2>&1
:: -------------------------------------------------------------------
:: DOMScanner Desktop Agent - Windows Launcher (Non-Admin / Self-Unblocking)
:: -------------------------------------------------------------------
title DOMScanner Desktop Agent

echo.
echo =======================================================
echo    📡 DOMScanner Desktop Agent for Windows
echo =======================================================
echo.

set "SERVER_URL=https://ipscaner.onrender.com"
set "AGENT_DIR=%LOCALAPPDATA%\DOMScannerAgent"

if not exist "%AGENT_DIR%" mkdir "%AGENT_DIR%"
cd /d "%AGENT_DIR%"

:: Check Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ❌ Node.js is NOT installed!
    echo.
    echo Please install Node.js from: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

:: Ensure package.json
if not exist "package.json" (
    echo {"name":"domscanner-agent","version":"1.0.0","main":"dom-agent.js","dependencies":{"ws":"^8.16.0"}} > package.json
)

:: Ensure ws module
if not exist "node_modules\ws" (
    echo 📦 Installing required WebSocket package...
    call npm install ws --no-audit --no-fund >nul 2>&1
)

:: Download fresh agent script from cloud
echo 🌐 Downloading latest agent script from cloud...
powershell -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; try { Invoke-WebRequest -Uri '%SERVER_URL%/agent/dom-agent.js' -OutFile '%AGENT_DIR%\dom-agent.js' -UseBasicParsing; Write-Host ' Agent script updated.' } catch { Write-Host ' Offline mode: Using local copy.' }"

echo.
echo 🚀 Launching DOMScanner Desktop Agent...
echo.

node dom-agent.js --server=%SERVER_URL%
pause
