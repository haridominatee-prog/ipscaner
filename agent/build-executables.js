/**
 * DOMScanner Executable Packager
 * Packages dom-agent.js into standalone binaries for Windows (.exe), Linux, and macOS.
 */

const { execSync } = require('child_process');
const path         = require('path');
const fs           = require('fs');

console.log('📦 DOMScanner Desktop Agent Executable Builder\n');

try {
  console.log('Installing pkg executable packager (if not present)...');
  execSync('npx -y pkg --version', { stdio: 'inherit' });

  const agentFile = path.join(__dirname, 'dom-agent.js');
  const distDir   = path.join(__dirname, 'dist');

  if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });

  console.log('\n🔨 Compiling standalone binaries...');
  execSync(`npx pkg "${agentFile}" --targets node18-win-x64,node18-linux-x64,node18-macos-x64 --output "${path.join(distDir, 'domscanner-agent')}"`, { stdio: 'inherit' });

  console.log('\n✅ Executables generated successfully in agent/dist/:');
  console.log(`   - Windows: ${path.join(distDir, 'domscanner-agent-win.exe')}`);
  console.log(`   - Linux:   ${path.join(distDir, 'domscanner-agent-linux')}`);
  console.log(`   - macOS:   ${path.join(distDir, 'domscanner-agent-macos')}\n`);
} catch (err) {
  console.log('⚠️ Automatic binary compilation requires npx pkg network access.');
  console.log('You can compile executables anytime by running: npx pkg agent/dom-agent.js\n');
}
