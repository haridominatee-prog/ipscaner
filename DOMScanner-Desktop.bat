@echo off
title DOM IP Scanner — Desktop Edition
cd /d "%~dp0"

echo.
echo  =============================================================
echo     DOM IP Scanner — Standalone Native Desktop Application
echo  =============================================================
echo.
echo  Launching DOM IP Scanner Desktop App...
echo.

npx electron .

if %errorlevel% neq 0 (
  echo.
  echo Installing Desktop dependencies (first time setup)...
  npm install
  npx electron .
)
