/**
 * DOMScanner Agent Background Service Setup Utility
 * Generates configuration / scripts for Windows Task Scheduler, Linux Systemd, or macOS Launchd.
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

const agentScript = path.join(__dirname, 'dom-agent.js');
const nodeBin     = process.execPath;

console.log('🤖 DOMScanner Service Configuration Helper\n');

if (IS_WIN) {
  const batPath = path.join(__dirname, 'start-agent.bat');
  const batContent = `@echo off\ncd /d "${__dirname}"\n"${nodeBin}" "${agentScript}" %*\n`;
  fs.writeFileSync(batPath, batContent);

  console.log('✅ Created Windows launcher script:');
  console.log(`   ${batPath}\n`);
  console.log('To run on Windows startup as a background task, execute:');
  console.log(`  schtasks /create /tn "DOMScannerAgent" /tr "${batPath}" /sc onstart /ru SYSTEM\n`);
} else if (IS_MAC) {
  const plistPath = path.join(os.homedir(), 'Library/LaunchAgents/com.domscanner.agent.plist');
  const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.domscanner.agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodeBin}</string>
        <string>${agentScript}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>`;
  fs.writeFileSync(plistPath, plistContent);
  console.log(`✅ Created macOS launchd plist at: ${plistPath}`);
  console.log(`To load service: launchctl load ${plistPath}\n`);
} else {
  // Linux / Systemd
  const serviceContent = `[Unit]
Description=DOMScanner Remote Desktop Agent
After=network.target

[Service]
Type=simple
User=${os.userInfo().username}
WorkingDirectory=${__dirname}
ExecStart=${nodeBin} ${agentScript}
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
`;
  const servicePath = path.join(__dirname, 'domscanner-agent.service');
  fs.writeFileSync(servicePath, serviceContent);
  console.log(`✅ Created Systemd service unit at: ${servicePath}`);
  console.log('To install on Linux/Orange Pi:');
  console.log(`  sudo cp ${servicePath} /etc/systemd/system/`);
  console.log('  sudo systemctl daemon-reload');
  console.log('  sudo systemctl enable --now domscanner-agent\n');
}
