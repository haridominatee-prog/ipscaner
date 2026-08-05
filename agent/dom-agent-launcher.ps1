# DOMScanner Desktop Agent PowerShell Launcher
# Runs without requiring Administrator privileges or triggering SmartScreen

$ErrorActionPreference = 'SilentlyContinue'
$ServerUrl = 'https://ipscaner.onrender.com'
$AgentDir  = "$env:LOCALAPPDATA\DOMScannerAgent"

Write-Host ""
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "   📡 DOMScanner Desktop Agent Launcher (1-Click)" -ForegroundColor Green
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path -Path $AgentDir)) {
    New-Item -ItemType Directory -Path $AgentDir -Force | Out-Null
}

Set-Location -Path $AgentDir

# Ensure package.json exists
$PackageJsonPath = Join-Path -Path $AgentDir -ChildPath "package.json"
if (-not (Test-Path -Path $PackageJsonPath)) {
    @'
{
  "name": "domscanner-agent",
  "version": "1.0.0",
  "main": "dom-agent.js",
  "dependencies": {
    "ws": "^8.16.0"
  }
}
'@ | Set-Content -Path $PackageJsonPath
}

# Ensure ws module is installed
$WsPath = Join-Path -Path $AgentDir -ChildPath "node_modules\ws"
if (-not (Test-Path -Path $WsPath)) {
    Write-Host "📦 Installing WebSocket dependency..." -ForegroundColor Yellow
    Start-Process -FilePath "npm.cmd" -ArgumentList "install ws --no-audit --no-fund" -WorkingDirectory $AgentDir -NoNewWindow -Wait
}

# Download latest agent script from cloud server
Write-Host "🌐 Fetching latest DOMScanner agent script from cloud..." -ForegroundColor Cyan
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri "$ServerUrl/agent/dom-agent.js" -OutFile "$AgentDir\dom-agent.js" -UseBasicParsing
    Write-Host "✅ Agent script updated successfully." -ForegroundColor Green
} catch {
    Write-Host "⚠️ Cloud fetch offline, using existing local script." -ForegroundColor Yellow
}

# Launch Agent
Write-Host "🚀 Launching DOMScanner Desktop Agent..." -ForegroundColor Green
Write-Host ""

Start-Process -FilePath "node.exe" -ArgumentList "dom-agent.js --server=$ServerUrl" -WorkingDirectory $AgentDir -NoNewWindow
