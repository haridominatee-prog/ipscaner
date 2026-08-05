/**
 * DOMScanner Desktop Agent
 * Cross-platform desktop background agent for Windows, Linux, and macOS.
 * Self-contained module: Zero external file dependencies.
 */

const os       = require('os');
const path     = require('path');
const fs       = require('fs');
const readline = require('readline');
const http     = require('http');
const https    = require('https');
const { exec } = require('child_process');
const dns      = require('dns').promises;
const net      = require('net');

// ── WebSocket Resolution (Native in Node 21+, fallback to ws module) ──────────
let WebSocket;
if (typeof globalThis.WebSocket !== 'undefined') {
  WebSocket = globalThis.WebSocket;
} else {
  try {
    WebSocket = require('ws');
  } catch (err) {
    try {
      // Try resolving ws from local appdata or global
      const localWs = path.join(process.env.LOCALAPPDATA || '', 'DOMScannerAgent', 'node_modules', 'ws');
      WebSocket = require(localWs);
    } catch {
      console.error('❌ WebSocket support missing. Please run: npm install ws');
      process.exit(1);
    }
  }
}

const AGENT_VERSION = '1.0.0';
const configPath    = path.join(__dirname, 'agent-config.json');

const IS_WIN = process.platform === 'win32';

// ─── Core Scanner Engine Helpers (Self-Contained) ─────────────────────────────

function shell(cmd, timeout = 5000) {
  return new Promise((resolve) => {
    exec(cmd, { timeout }, (err, stdout) => resolve(stdout || ''));
  });
}

async function getWifiInfo() {
  try {
    if (IS_WIN) {
      const out = await shell('netsh wlan show interfaces', 4000);
      const ssidMatch   = out.match(/^\s*SSID\s*:\s*(.+)$/m);
      const signalMatch = out.match(/Signal\s*:\s*(\d+)%/i);
      const bandMatch   = out.match(/Radio type\s*:\s*(.+)/i);
      const bssidMatch  = out.match(/BSSID\s*:\s*([0-9a-f:]+)/i);
      return {
        ssid:   ssidMatch   ? ssidMatch[1].trim()   : null,
        signal: signalMatch ? signalMatch[1] + '%'  : null,
        band:   bandMatch   ? bandMatch[1].trim()   : null,
        bssid:  bssidMatch  ? bssidMatch[1].trim()  : null,
      };
    } else {
      const ssid   = (await shell('iwgetid -r', 3000)).trim();
      const signal = (await shell("iwconfig 2>/dev/null | grep -oP 'Signal level=\\K[^ ]+'", 3000)).trim();
      const bssid  = (await shell('iwgetid -a -r', 3000)).trim();
      return { ssid: ssid || null, signal: signal || null, band: null, bssid: bssid || null };
    }
  } catch {
    return { ssid: null, signal: null, band: null, bssid: null };
  }
}

function getLocalNetwork() {
  const ifaces = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const a of addrs) {
      if (a.family === 'IPv4' && !a.internal) {
        return { ip: a.address, netmask: a.netmask, iface: name };
      }
    }
  }
  return null;
}

function getSubnetIPs(baseIP) {
  const parts = baseIP.split('.').slice(0, 3).join('.');
  const ips = [];
  for (let i = 1; i <= 254; i++) ips.push(`${parts}.${i}`);
  return ips;
}

function pingHost(ip) {
  return new Promise((resolve) => {
    const cmd = IS_WIN
      ? `ping -n 1 -w 600 ${ip}`
      : `ping -c 1 -W 1 ${ip}`;
    exec(cmd, { timeout: 3000 }, (err, stdout) => {
      const alive = stdout && (
        stdout.includes('TTL=') ||
        stdout.includes('ttl=') ||
        stdout.includes('bytes from') ||
        stdout.includes('Reply from')
      );
      resolve({ ip, alive: !!alive });
    });
  });
}

async function getARPTable() {
  const raw = await shell('arp -a');
  const map = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\s+([0-9a-f]{2}[:\-][0-9a-f]{2}[:\-][0-9a-f]{2}[:\-][0-9a-f]{2}[:\-][0-9a-f]{2}[:\-][0-9a-f]{2})/i);
    if (m) {
      const mac = m[2].replace(/-/g, ':').toLowerCase();
      if (!mac.includes('ff:ff:ff') && !mac.startsWith('01:')) {
        map[m[1]] = mac;
      }
    }
  }
  return map;
}

async function getHostname(ip) {
  try {
    const hosts = await dns.reverse(ip);
    return hosts[0] || null;
  } catch {
    return null;
  }
}

function checkPort(ip, port) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let done = false;
    sock.setTimeout(2000);
    sock.on('connect', () => { done = true; sock.destroy(); resolve(true); });
    sock.on('timeout', () => { if (!done) { done = true; sock.destroy(); resolve(false); } });
    sock.on('error',   () => { if (!done) { done = true; resolve(false); } });
    sock.connect(port, ip);
  });
}

const OUI_TABLE = {
  'b8:27:eb': 'Raspberry Pi Foundation',
  'dc:a6:32': 'Raspberry Pi Foundation',
  'e4:5f:01': 'Raspberry Pi Foundation',
  'd8:3a:dd': 'Raspberry Pi Foundation',
  '2c:cf:67': 'Raspberry Pi Foundation',
  '00:1a:11': 'Google',
  'f4:f5:d8': 'Google',
  '54:60:09': 'Google',
  'a4:c3:f0': 'Google',
  'ac:d1:b8': 'Apple',
  '00:1c:b3': 'Apple',
  '9c:20:7b': 'Apple',
  'f0:18:98': 'Apple',
  '60:f8:1d': 'Apple',
  'a8:51:ab': 'Apple',
  '00:50:f2': 'Microsoft',
  '28:18:78': 'Microsoft',
  '7c:1e:52': 'Microsoft',
  '00:17:3f': 'Microsoft',
  '00:15:5d': 'Microsoft (Hyper-V)',
  'f8:16:54': 'Samsung',
  '00:12:47': 'Samsung',
  '08:37:3d': 'Samsung',
  'e8:50:8b': 'Samsung',
  '48:13:7e': 'Samsung',
  '24:0a:c4': 'Espressif (ESP32/ESP8266)',
  '30:ae:a4': 'Espressif (ESP32)',
  '3c:71:bf': 'Espressif (ESP32)',
  'ec:fa:bc': 'Espressif (ESP32)',
  '94:b9:7e': 'Espressif (ESP32)',
  'b4:e6:2d': 'TP-Link',
  'c0:4a:00': 'TP-Link',
  '50:c7:bf': 'TP-Link',
  '30:de:4b': 'TP-Link',
  '00:50:7f': 'D-Link',
  '1c:af:f7': 'D-Link',
  '00:17:9a': 'D-Link',
  'c8:d3:a3': 'ASUS',
  '00:11:2f': 'ASUS',
  '04:d4:c4': 'ASUS',
  '00:e0:4c': 'Realtek',
  '8c:8d:28': 'Intel',
  'a0:a8:cd': 'Intel',
  '8c:ec:4b': 'Intel',
  '00:25:90': 'Super Micro',
  '00:a0:c9': 'Intel',
  '00:1e:65': 'Intel',
  '3c:52:82': 'Intel',
};

function isLocallyAdminMAC(mac) {
  if (!mac) return false;
  const firstByte = parseInt(mac.split(':')[0], 16);
  return (firstByte & 0x02) !== 0;
}

async function getMACVendor(mac) {
  if (!mac) return 'Unknown';
  const prefix = mac.slice(0, 8).toLowerCase();
  if (OUI_TABLE[prefix]) return OUI_TABLE[prefix];
  if (isLocallyAdminMAC(mac)) return 'Local/SBC (no OUI)';

  try {
    const result = await new Promise((resolve) => {
      const req = https.get(
        `https://api.macvendors.com/${encodeURIComponent(mac)}`,
        { timeout: 3000 },
        (res) => {
          let data = '';
          res.on('data', (d) => (data += d));
          res.on('end', () => {
            const text = data.trim();
            if (!text || text.startsWith('{') || text.toLowerCase().includes('not found')) {
              resolve('Unknown');
            } else {
              resolve(text);
            }
          });
        }
      );
      req.on('error', () => resolve('Unknown'));
      req.on('timeout', () => { req.destroy(); resolve('Unknown'); });
    });
    return result;
  } catch {
    return 'Unknown';
  }
}

function getSSHBanner(ip) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let banner = '';
    sock.setTimeout(2500);
    sock.on('connect', () => { });
    sock.on('data', (data) => {
      banner = data.toString().trim();
      sock.destroy();
      resolve(banner);
    });
    sock.on('timeout', () => { sock.destroy(); resolve(''); });
    sock.on('error',   () => { resolve(''); });
    sock.connect(22, ip);
  });
}

function guessDeviceType(vendor, openPorts, sshBanner, mac) {
  const v  = (vendor || '').toLowerCase();
  const p  = openPorts || [];
  const b  = (sshBanner || '').toLowerCase();
  const la = isLocallyAdminMAC(mac);

  if (b.includes('armbian'))      return { type: 'sbc',     label: 'Orange Pi / Armbian', icon: 'sbc',     os: 'Armbian (Orange Pi)' };
  if (b.includes('orange'))       return { type: 'sbc',     label: 'Orange Pi',           icon: 'sbc',     os: 'Orange Pi' };
  if (b.includes('raspbian') || b.includes('raspberry'))
                                  return { type: 'sbc',     label: 'Raspberry Pi',        icon: 'sbc',     os: 'Raspberry Pi OS' };
  if (b.includes('ubuntu'))       return { type: 'linux',   label: 'Ubuntu Linux',        icon: 'linux',   os: 'Ubuntu' };
  if (b.includes('debian'))       return { type: 'linux',   label: 'Debian Linux',        icon: 'linux',   os: 'Debian' };
  if (b.includes('openwrt'))      return { type: 'router',  label: 'OpenWrt Router',      icon: 'router',  os: 'OpenWrt' };
  if (b.includes('freebsd'))      return { type: 'linux',   label: 'FreeBSD',             icon: 'linux',   os: 'FreeBSD' };
  if (b.includes('mikrotik'))     return { type: 'router',  label: 'MikroTik Router',     icon: 'router',  os: 'RouterOS' };

  if (v.includes('raspberry pi')) return { type: 'sbc',     label: 'Raspberry Pi',        icon: 'sbc' };
  if (v.includes('espressif'))    return { type: 'iot',     label: 'ESP32 / ESP8266',     icon: 'iot' };
  if (v.includes('apple'))        return { type: 'apple',   label: 'Apple Device',        icon: 'apple' };
  if (v.includes('samsung') && p.includes(62078))
                                  return { type: 'phone',   label: 'Samsung Phone',       icon: 'phone' };
  if (v.includes('samsung'))      return { type: 'tv',      label: 'Samsung Device',      icon: 'tv' };
  if (v.includes('tp-link') || v.includes('d-link') || v.includes('asus'))
                                  return { type: 'router',  label: 'Router / AP',         icon: 'router' };
  if (v.includes('google'))       return { type: 'google',  label: 'Google Device',       icon: 'google' };
  if (v.includes('microsoft'))    return { type: 'windows', label: 'Windows / Microsoft', icon: 'windows' };
  if (v.includes('tuya') || v.includes('beken'))
                                  return { type: 'iot',     label: 'Tuya Smart Device',   icon: 'iot' };

  if (p.includes(3389))           return { type: 'windows', label: 'Windows PC (RDP)',    icon: 'windows' };
  if (p.includes(22) && la)       return { type: 'sbc',     label: 'Linux SBC (Orange Pi?)', icon: 'sbc' };
  if (p.includes(22) && !p.includes(3389))
                                  return { type: 'linux',   label: 'Linux / Unix',        icon: 'linux' };
  if (p.includes(9100) || p.includes(515))
                                  return { type: 'printer', label: 'Network Printer',     icon: 'printer' };
  if (p.includes(1883))           return { type: 'iot',     label: 'IoT / MQTT Broker',   icon: 'iot' };
  if (p.includes(80) || p.includes(443))
                                  return { type: 'server',  label: 'Web Server',          icon: 'server' };
  if (la)                         return { type: 'sbc',     label: 'SBC / IoT Device',    icon: 'sbc' };

  return { type: 'unknown', label: 'Unknown Device', icon: 'unknown' };
}

const QUICK_PORTS = [21, 22, 23, 80, 443, 3389, 8080, 8443, 9100, 515, 1883, 62078, 5000, 7000];

const COMMON_PORTS = {
  21: 'FTP', 22: 'SSH', 23: 'Telnet', 25: 'SMTP', 53: 'DNS', 80: 'HTTP', 110: 'POP3',
  135: 'RPC', 139: 'NetBIOS', 143: 'IMAP', 443: 'HTTPS', 445: 'SMB', 515: 'LPD (Printer)',
  554: 'RTSP', 587: 'SMTP TLS', 631: 'IPP (Printer)', 993: 'IMAPS', 995: 'POP3S', 1194: 'OpenVPN',
  1433: 'MSSQL', 1723: 'PPTP VPN', 1883: 'MQTT', 3000: 'Node.js App', 3306: 'MySQL',
  3389: 'RDP (Windows)', 4443: 'HTTPS Alt', 4848: 'GlassFish', 5000: 'Flask / Dev',
  5432: 'PostgreSQL', 5900: 'VNC', 6379: 'Redis', 7000: 'AirPlay', 8000: 'HTTP Dev',
  8080: 'HTTP Alt / Proxy', 8081: 'HTTP Alt', 8443: 'HTTPS Alt', 8888: 'Jupyter / HTTP',
  9000: 'SonarQube', 9090: 'Prometheus', 9100: 'Network Printer', 27017: 'MongoDB', 62078: 'iTunes (iPhone)'
};

async function runNetworkScan(emit) {
  const localNet = getLocalNetwork();
  if (!localNet) {
    emit('error', { message: 'No local network interface found' });
    return [];
  }

  const allIPs = getSubnetIPs(localNet.ip);
  const total  = allIPs.length;

  emit('start', { total, localIP: localNet.ip, subnet: localNet.ip.split('.').slice(0,3).join('.') + '.0/24' });

  const BATCH = 30;
  const aliveIPs = [];
  let scanned = 0;

  for (let i = 0; i < allIPs.length; i += BATCH) {
    const batch   = allIPs.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(pingHost));
    for (const r of results) {
      if (r.alive) aliveIPs.push(r.ip);
    }
    scanned += batch.length;
    emit('progress', { scanned, total, found: aliveIPs.length });
  }

  const arpMap = await getARPTable();
  if (!aliveIPs.includes(localNet.ip)) aliveIPs.push(localNet.ip);

  emit('arp_done', { count: aliveIPs.length });

  const devices = [];
  for (const ip of aliveIPs) {
    const mac      = arpMap[ip] || null;
    const vendor   = mac ? await getMACVendor(mac) : (ip === localNet.ip ? 'This Machine' : 'Unknown');
    const hostname = await getHostname(ip);

    const portResults = await Promise.all(QUICK_PORTS.map(p => checkPort(ip, p)));
    const openPorts   = QUICK_PORTS.filter((_, i) => portResults[i]);

    let sshBanner = '';
    if (openPorts.includes(22)) {
      sshBanner = await getSSHBanner(ip);
    }

    const deviceType  = guessDeviceType(vendor, openPorts, sshBanner, mac);
    const isGateway   = ip.endsWith('.1') || ip.endsWith('.254');
    const isMe        = ip === localNet.ip;

    const deviceObj = {
      ip,
      mac:        mac || '—',
      vendor,
      hostname:   hostname || null,
      openPorts,
      sshBanner:  sshBanner || null,
      deviceType,
      isGateway,
      isMe,
      label: isMe ? 'This Machine' : (isGateway ? 'Gateway / Router' : null),
    };

    devices.push(deviceObj);
    emit('device', deviceObj);
  }

  emit('done', { total: aliveIPs.length, devices });
  return devices;
}

async function runPortScan(ip, profile = 'common', customPorts = null) {
  if (!ip) throw new Error('IP address is required');

  let ports;
  if (profile === 'quick')  ports = QUICK_PORTS;
  else if (profile === 'common') ports = Object.keys(COMMON_PORTS).map(Number);
  else if (profile === 'custom' && customPorts) ports = customPorts;
  else ports = Object.keys(COMMON_PORTS).map(Number);

  const BATCH = 20;
  const results = [];

  for (let i = 0; i < ports.length; i += BATCH) {
    const batch   = ports.slice(i, i + BATCH);
    const checks  = await Promise.all(batch.map(p => checkPort(ip, p).then(open => ({
      port:    p,
      open,
      service: COMMON_PORTS[p] || `Port ${p}`,
    }))));
    results.push(...checks);
  }

  return {
    ip,
    scanned: results.length,
    open:    results.filter(r => r.open),
    results,
  };
}

// ── CLI & Setup Helpers ───────────────────────────────────────────────────────

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

function postJson(urlStr, payload) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(urlStr);
    const client = urlObj.protocol === 'https:' ? https : http;
    const bodyStr = JSON.stringify(payload);

    const req = client.request(urlStr, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
      timeout: 10000,
    }, (res) => {
      let data = '';
      res.on('data', (d) => data += d);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
          else reject(new Error(parsed.error || `HTTP ${res.statusCode}`));
        } catch {
          reject(new Error('Invalid response from server'));
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.write(bodyStr);
    req.end();
  });
}

function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    serverUrl: process.env.CLOUD_SERVER || 'http://localhost:7890',
    agentKey:  process.env.AGENT_KEY    || '',
    agentName: process.env.AGENT_NAME   || os.hostname(),
  };

  if (fs.existsSync(configPath)) {
    try {
      const fileConf = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      Object.assign(config, fileConf);
    } catch {}
  }

  for (const arg of args) {
    if (arg.startsWith('--server=')) config.serverUrl = arg.split('=')[1];
    if (arg.startsWith('--key='))    config.agentKey  = arg.split('=')[1];
    if (arg.startsWith('--name='))   config.agentName = arg.split('=')[1];
  }

  if (config.serverUrl.startsWith('http://')) {
    config.serverUrl = config.serverUrl.replace('http://', 'ws://');
  } else if (config.serverUrl.startsWith('https://')) {
    config.serverUrl = config.serverUrl.replace('https://', 'wss://');
  }
  if (!config.serverUrl.includes('/ws')) {
    config.serverUrl = config.serverUrl.replace(/\/$/, '') + '/ws';
  }

  return config;
}

let config = parseArgs();

async function autoPair() {
  const httpUrl = config.serverUrl
    .replace(/^wss:\/\//, 'https://')
    .replace(/^ws:\/\//, 'http://')
    .replace(/\/ws$/, '');

  console.log(`\n🔗 Auto-pairing with DOMScanner Cloud Server at ${httpUrl}...`);
  console.log(`   Agent Name: ${config.agentName}\n`);

  try {
    const res = await postJson(`${httpUrl}/api/agent/auto-pair`, {
      name: config.agentName,
    });
    config.agentKey = res.agentKey;
    config.serverUrl = httpUrl;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log(`✅ Auto-paired successfully! Agent is ready to scan.`);
  } catch (err) {
    console.error(`❌ Auto-pairing failed: ${err.message}`);
    console.log(`\n💡 Try running manually: node dom-agent.js --server=<YOUR_RENDER_URL>\n`);
    process.exit(1);
  }
}

async function interactiveSetup() {
  console.log(`
======================================================
      📡 Welcome to DOMScanner Desktop Agent v${AGENT_VERSION}
======================================================
`);

  let targetServer = await prompt(`Enter DOMScanner Cloud Server URL [${config.serverUrl}]: `);
  if (targetServer) config.serverUrl = targetServer;

  console.log(`\nHow would you like to pair this computer?`);
  console.log(`  [1] Auto-Pair instantly (No login required) ← Recommended`);
  console.log(`  [2] Enter 6-Digit Pairing Code from Web Dashboard`);
  console.log(`  [3] Sign in with DOMScanner Account Email & Password`);
  console.log(`  [4] Paste Agent Key manually\n`);

  const choice = await prompt(`Select Option (1/2/3/4): `);

  const httpUrl = config.serverUrl
    .replace(/^wss:\/\//, 'https://')
    .replace(/^ws:\/\//, 'http://')
    .replace(/\/ws$/, '');

  if (choice === '1' || choice === '') {
    await autoPair();
  } else if (choice === '2') {
    const pairingCode = await prompt(`Enter 6-Digit Pairing Code (e.g. 849204): `);
    console.log('\n⏳ Pairing agent with cloud server...');
    try {
      const res = await postJson(`${httpUrl}/api/agent/pair`, {
        pairingCode,
        name: config.agentName,
      });
      config.agentKey = res.agentKey;
      console.log(`✅ Pairing Successful! Agent Key acquired.`);
    } catch (err) {
      console.error(`❌ Pairing Failed: ${err.message}`);
      process.exit(1);
    }
  } else if (choice === '3') {
    const email = await prompt(`Email Address: `);
    const password = await prompt(`Password: `);
    console.log('\n⏳ Signing in and pairing agent...');
    try {
      const res = await postJson(`${httpUrl}/api/agent/pair`, {
        email,
        password,
        name: config.agentName,
      });
      config.agentKey = res.agentKey;
      console.log(`✅ Sign-in Successful! Agent Key acquired.`);
    } catch (err) {
      console.error(`❌ Sign-in Failed: ${err.message}`);
      process.exit(1);
    }
  } else if (choice === '4') {
    config.agentKey = await prompt(`Paste Agent Key: `);
  } else {
    console.error('Invalid choice');
    process.exit(1);
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log(`💾 Configuration saved to agent-config.json\n`);
}

let ws = null;
let heartbeatTimer = null;
let reconnectTimer = null;
let isScanning = false;

async function startAgent() {
  if (!config.agentKey) {
    // If server is Render (not localhost), auto-pair silently
    const isRender = config.serverUrl.includes('.onrender.com') || process.argv.includes('--auto');
    if (isRender) {
      await autoPair();
    } else {
      await interactiveSetup();
    }
  }


  let wsUrl = config.serverUrl;
  if (wsUrl.startsWith('http://'))  wsUrl = wsUrl.replace('http://', 'ws://');
  if (wsUrl.startsWith('https://')) wsUrl = wsUrl.replace('https://', 'wss://');
  if (!wsUrl.includes('/ws'))       wsUrl = wsUrl.replace(/\/$/, '') + '/ws';

  const localNet = getLocalNetwork();
  const localIp  = localNet ? localNet.ip : 'unknown';
  const osInfo   = `${os.type()} ${os.release()} (${os.arch()})`;

  const wsTarget = `${wsUrl}?type=agent&key=${encodeURIComponent(config.agentKey)}&osInfo=${encodeURIComponent(osInfo)}&localIp=${encodeURIComponent(localIp)}&version=${encodeURIComponent(AGENT_VERSION)}`;

  console.log(`\n📡 Connecting DOMScanner Agent to Cloud at ${wsUrl}...`);
  console.log(`   Agent Name: ${config.agentName}`);
  console.log(`   Local IP:   ${localIp}`);
  console.log(`   OS Info:    ${osInfo}`);

  try {
    ws = new WebSocket(wsTarget);

    ws.on('open', () => {
      console.log('✅ Connected to DOMScanner Cloud Hub successfully!');
      console.log('🟢 Status: ONLINE & Ready for remote LAN scans.\n');
      startHeartbeat(osInfo, localIp);
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        handleCloudCommand(msg);
      } catch (err) {
        console.error('⚠️ Received invalid JSON message:', err.message);
      }
    });

    ws.on('close', (code, reason) => {
      console.log(`⚠️ Disconnected from Cloud Hub (Code: ${code}, Reason: ${reason || 'None'}). Reconnecting in 5s...`);
      stopHeartbeat();
      scheduleReconnect();
    });

    ws.on('error', (err) => {
      console.error('❌ WebSocket Connection Error:', err.message);
    });
  } catch (err) {
    console.error('❌ Setup Error:', err.message);
    scheduleReconnect();
  }
}

function startHeartbeat(osInfo, localIp) {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'heartbeat',
        osInfo,
        localIp,
        version: AGENT_VERSION,
        isScanning,
      }));
    }
  }, 15000);
}

function stopHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
}

function scheduleReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => startAgent(), 5000);
}

async function handleCloudCommand(msg) {
  if (msg.type === 'welcome_agent') {
    console.log(`🎉 Cloud Server welcomed agent: ${msg.agentName} (ID: ${msg.agentId})`);
    return;
  }

  if (msg.command === 'start_scan') {
    if (isScanning) {
      sendScanEvent('error', { message: 'Agent is already performing a scan' });
      return;
    }

    console.log('🔍 Executing Remote Network Scan command locally...');
    isScanning = true;

    try {
      await runNetworkScan((event, data) => {
        sendScanEvent(event, data);
      });
      console.log('✅ Remote Network Scan completed successfully.');
    } catch (err) {
      console.error('❌ Scan execution error:', err.message);
      sendScanEvent('error', { message: err.message });
    } finally {
      isScanning = false;
    }
  }

  if (msg.command === 'port_scan') {
    console.log(`🔍 Executing Remote Port Scan on ${msg.ip}...`);
    try {
      const result = await runPortScan(msg.ip, msg.profile, msg.customPorts);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'portscan_result',
          data: result,
        }));
      }
    } catch (err) {
      console.error('❌ Port scan error:', err.message);
    }
  }
}

function sendScanEvent(event, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'scan_event',
      event,
      data,
    }));
  }
}

process.on('SIGINT',  () => { console.log('\nStopping agent...'); process.exit(0); });
process.on('SIGTERM', () => { console.log('\nStopping agent...'); process.exit(0); });

startAgent();
