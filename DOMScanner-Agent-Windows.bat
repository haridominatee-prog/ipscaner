@echo off
title DOMScanner Desktop Agent
color 0A
cls
echo ======================================================
echo       📡 Welcome to DOMScanner Desktop Agent
echo ======================================================
echo.

:: Check for Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ❌ Node.js is required to run DOMScanner Agent.
    echo 📥 Opening Node.js download page...
    start https://nodejs.org
    echo.
    echo Please install Node.js and run this setup script again.
    pause
    exit /b
)

:: Create working directory in AppData/Temp
set "AGENT_DIR=%LOCALAPPDATA%\DOMScannerAgent"
if not exist "%AGENT_DIR%" mkdir "%AGENT_DIR%"

cd /d "%AGENT_DIR%"

:: Extract or copy agent script
copy /y "%~dp0dom-agent.js" "%AGENT_DIR%\dom-agent.js" >nul 2>nul

if not exist "%AGENT_DIR%\dom-agent.js" (
    echo 📥 Downloading latest agent core...
    powershell -Command "Invoke-WebRequest -Uri 'http://localhost:7890/agent/dom-agent.js' -OutFile '%AGENT_DIR%\dom-agent.js'" >nul 2>nul
)

:: Launch Agent Interactively
node "%AGENT_DIR%\dom-agent.js" %*

if %errorlevel% neq 0 (
    echo.
    echo Press any key to exit...
    pause >nul
)
