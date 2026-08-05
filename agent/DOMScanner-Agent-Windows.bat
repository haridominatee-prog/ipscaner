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

set "AGENT_DIR=%LOCALAPPDATA%\DOMScannerAgent"
if not exist "%AGENT_DIR%" mkdir "%AGENT_DIR%"

cd /d "%AGENT_DIR%"

echo  Setting up DOMScanner Agent components...

:: 1. Copy dom-agent.js
if exist "%~dp0dom-agent.js" (
    copy /y "%~dp0dom-agent.js" "%AGENT_DIR%\dom-agent.js" >nul
)

:: 2. Copy scanner engine
if exist "%~dp0..\lib\scanner-engine.js" (
    if not exist "%AGENT_DIR%\lib" mkdir "%AGENT_DIR%\lib"
    copy /y "%~dp0..\lib\scanner-engine.js" "%AGENT_DIR%\lib\scanner-engine.js" >nul
)

:: 3. Ensure ws module is available for older Node versions
node -e "if (!globalThis.WebSocket) process.exit(1)" >nul 2>nul
if %errorlevel% neq 0 (
    if not exist "%AGENT_DIR%\node_modules\ws" (
        echo  Installing ws dependency...
        call npm install ws --no-audit --no-fund --quiet >nul 2>nul
    )
)

:: 4. Write auto-config pointing to Render cloud server
set "CONFIG_FILE=%AGENT_DIR%\agent-config.json"

:: Only create config if it doesn't already have a valid key
if not exist "%CONFIG_FILE%" (
    echo {"serverUrl":"https://ipscaner.onrender.com","agentKey":"","agentName":"%COMPUTERNAME%"} > "%CONFIG_FILE%"
)

echo.
echo  DOMScanner Agent is starting...
echo  It will automatically connect to your cloud dashboard.
echo  Keep this window open while scanning.
echo.

:: Launch Agent (auto-pairs and connects to Render)
node "%AGENT_DIR%\dom-agent.js" --server=https://ipscaner.onrender.com

if %errorlevel% neq 0 (
    echo.
    echo  Agent stopped. Press any key to exit.
    pause >nul
)
