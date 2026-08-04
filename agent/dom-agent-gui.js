/**
 * DOMScanner Desktop Agent GUI App & Runner
 * Native zero-dependency Desktop GUI launcher for end-consumers.
 * Self-contained module: Zero external file dependencies.
 */

const http     = require('http');
const path     = require('path');
const fs       = require('fs');
const os       = require('os');
const { exec } = require('child_process');
const https    = require('https');
const dns      = require('dns').promises;
const net      = require('net');

const AGENT_VERSION = '1.0.0';
const GUI_PORT      = 4567;
const configPath    = path.join(__dirname, 'agent-config.json');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

// ── WebSocket Resolution (Native in Node 21+, fallback to ws module) ──────────
let WebSocket;
if (typeof globalThis.WebSocket !== 'undefined') {
  WebSocket = globalThis.WebSocket;
} else {
  try {
    WebSocket = require('ws');
  } catch {
    try {
      const localWs = path.join(process.env.LOCALAPPDATA || '', 'DOMScannerAgent', 'node_modules', 'ws');
      WebSocket = require(localWs);
    } catch {
      WebSocket = null;
    }
  }
}

// ─── Core Scanner Engine Helpers (Self-Contained) ─────────────────────────────

function shell(cmd, timeout = 5000) {
  return new Promise((resolve) => {
    exec(cmd, { timeout }, (err, stdout) => resolve(stdout || ''));
  });
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
  'ac:d1:b8': 'Apple',
  '00:1c:b3': 'Apple',
  '00:50:f2': 'Microsoft',
  'f8:16:54': 'Samsung',
  'b4:e6:2d': 'TP-Link',
  '00:e0:4c': 'Realtek',
  '8c:8d:28': 'Intel',
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
  return 'Unknown';
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

  if (b.includes('armbian') || b.includes('orange')) return { type: 'sbc', label: 'Orange Pi', icon: 'sbc', os: 'Orange Pi' };
  if (b.includes('raspbian') || b.includes('raspberry')) return { type: 'sbc', label: 'Raspberry Pi', icon: 'sbc', os: 'Raspberry Pi OS' };
  if (b.includes('ubuntu') || b.includes('debian')) return { type: 'linux', label: 'Linux Server', icon: 'linux', os: 'Linux' };

  if (v.includes('apple')) return { type: 'apple', label: 'Apple Device', icon: 'apple' };
  if (v.includes('microsoft') || p.includes(3389)) return { type: 'windows', label: 'Windows PC', icon: 'windows' };
  if (p.includes(22)) return { type: 'linux', label: 'Linux / Unix', icon: 'linux' };
  if (p.includes(80) || p.includes(443)) return { type: 'server', label: 'Web Server', icon: 'server' };

  return { type: 'unknown', label: 'Unknown Device', icon: 'unknown' };
}

const QUICK_PORTS = [21, 22, 23, 80, 443, 3389, 8080, 8443, 9100, 515, 1883, 62078, 5000, 7000];

const COMMON_PORTS = {
  21: 'FTP', 22: 'SSH', 23: 'Telnet', 80: 'HTTP', 443: 'HTTPS', 3389: 'RDP (Windows)', 8080: 'HTTP Alt'
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
    if (openPorts.includes(22)) sshBanner = await getSSHBanner(ip);

    const deviceType  = guessDeviceType(vendor, openPorts, sshBanner, mac);
    const isGateway   = ip.endsWith('.1') || ip.endsWith('.254');
    const isMe        = ip === localNet.ip;

    const deviceObj = {
      ip,
      mac: mac || '—',
      vendor,
      hostname: hostname || null,
      openPorts,
      sshBanner: sshBanner || null,
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
  let ports = QUICK_PORTS;

  const BATCH = 20;
  const results = [];

  for (let i = 0; i < ports.length; i += BATCH) {
    const batch  = ports.slice(i, i + BATCH);
    const checks = await Promise.all(batch.map(p => checkPort(ip, p).then(open => ({
      port: p, open, service: COMMON_PORTS[p] || `Port ${p}`
    }))));
    results.push(...checks);
  }

  return { ip, scanned: results.length, open: results.filter(r => r.open), results };
}

// ── State ──
let config = {
  serverUrl: process.env.CLOUD_SERVER || 'http://localhost:7890',
  agentKey:  process.env.AGENT_KEY    || '',
  agentName: process.env.AGENT_NAME   || os.hostname(),
};

if (fs.existsSync(configPath)) {
  try {
    Object.assign(config, JSON.parse(fs.readFileSync(configPath, 'utf8')));
  } catch {}
}

let agentStatus = 'offline';
let ws = null;
let heartbeatTimer = null;
let reconnectTimer = null;
let isScanning = false;

// ── HTTP Helper ──
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

function getHttpUrl(urlStr) {
  let url = (urlStr || 'http://localhost:7890').replace(/^ws:/i, 'http:').replace(/^wss:/i, 'https:');
  return url.replace(/\/ws\/?$/i, '').replace(/\/$/, '');
}

// ── Start Desktop Agent WebSocket Connection (Bulletproof Zero-Touch Auto Connect) ────────
async function connectCloud() {
  if (!config.agentKey) {
    console.log('⚡ Auto-pairing agent (zero-touch)...');
    try {
      const httpUrl = getHttpUrl(config.serverUrl);
      const paired  = await postJson(`${httpUrl}/api/agent/auto-pair`, { name: config.agentName });
      config.agentKey = paired.agentKey;
      try { fs.writeFileSync(configPath, JSON.stringify(config, null, 2)); } catch {}
      console.log('✅ Auto-pairing complete!');
    } catch (err) {
      console.error('❌ Auto-pairing failed:', err.message);
      agentStatus = 'offline';
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connectCloud, 3000);
      return;
    }
  }

  if (!WebSocket) {
    agentStatus = 'offline';
    return;
  }

  let wsUrl = config.serverUrl;
  if (wsUrl.startsWith('http://'))  wsUrl = wsUrl.replace('http://', 'ws://');
  if (wsUrl.startsWith('https://')) wsUrl = wsUrl.replace('https://', 'wss://');
  if (!wsUrl.includes('/ws'))       wsUrl = wsUrl.replace(/\/$/, '') + '/ws';

  const localNet = getLocalNetwork();
  const localIp  = localNet ? localNet.ip : 'unknown';
  const osInfo   = `${os.type()} ${os.release()} (${os.arch()})`;

  const wsTarget = `${wsUrl}?type=agent&key=${encodeURIComponent(config.agentKey)}&osInfo=${encodeURIComponent(osInfo)}&localIp=${encodeURIComponent(localIp)}&version=${encodeURIComponent(AGENT_VERSION)}`;

  console.log(`📡 Connecting to Cloud Server at ${wsUrl}...`);

  try {
    ws = new WebSocket(wsTarget);

    const onOpen = () => {
      agentStatus = 'online';
      console.log('✅ Connected to DOMScanner Cloud Hub! Agent ONLINE.');
      startHeartbeat(osInfo, localIp);
    };

    const onClose = (evt) => {
      console.log('⚠️ Disconnected from Cloud. Re-verifying key...');
      agentStatus = 'offline';
      stopHeartbeat();
      config.agentKey = '';
      if (fs.existsSync(configPath)) try { fs.unlinkSync(configPath); } catch {}
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connectCloud, 3000);
    };

    const onError = (err) => {
      agentStatus = 'offline';
    };

    if (ws.addEventListener) {
      ws.addEventListener('open', onOpen);
      ws.addEventListener('message', (e) => {
        try { handleCloudCommand(JSON.parse(e.data)); } catch {}
      });
      ws.addEventListener('close', onClose);
      ws.addEventListener('error', onError);
    } else {
      ws.on('open', onOpen);
      ws.on('message', (d) => { try { handleCloudCommand(JSON.parse(d.toString())); } catch {} });
      ws.on('close', onClose);
      ws.on('error', onError);
    }
  } catch (err) {
    agentStatus = 'offline';
    config.agentKey = '';
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectCloud, 3000);
  }
}

function startHeartbeat(osInfo, localIp) {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    if (ws && ws.readyState === 1) { // 1 = OPEN
      const payload = JSON.stringify({ type: 'heartbeat', osInfo, localIp, version: AGENT_VERSION, isScanning });
      if (ws.send) ws.send(payload);
    }
  }, 15000);
}

function stopHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
}

async function handleCloudCommand(msg) {
  if (msg.command === 'start_scan') {
    if (isScanning) return;
    isScanning = true;
    try {
      await runNetworkScan((event, data) => {
        if (ws && (ws.readyState === 1 || ws.readyState === WebSocket.OPEN)) {
          ws.send(JSON.stringify({ type: 'scan_event', event, data }));
        }
      });
    } catch (err) {
      if (ws && (ws.readyState === 1 || ws.readyState === WebSocket.OPEN)) {
        ws.send(JSON.stringify({ type: 'scan_event', event: 'error', data: { message: err.message } }));
      }
    } finally {
      isScanning = false;
    }
  }

  if (msg.command === 'port_scan') {
    try {
      const result = await runPortScan(msg.ip, msg.profile, msg.customPorts);
      if (ws && (ws.readyState === 1 || ws.readyState === WebSocket.OPEN)) {
        ws.send(JSON.stringify({ type: 'portscan_result', data: result }));
      }
    } catch {}
  }
}

// ── Local GUI HTTP Server ──
const guiServer = http.createServer((req, res) => {
  const localNet = getLocalNetwork();
  const localIp  = localNet ? localNet.ip : '127.0.0.1';

  if (req.url === '/' || req.url === '/index.html') {
    const htmlPath = path.join(__dirname, 'agent-gui.html');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return fs.createReadStream(htmlPath).pipe(res);
  }

  if (req.url === '/api/state' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      status: agentStatus,
      agentName: config.agentName,
      localIp,
      serverUrl: config.serverUrl,
    }));
  }

  res.writeHead(404);
  res.end();
});

function startGuiServer(port = 4567) {
  guiServer.removeAllListeners('error');
  guiServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      startGuiServer(port + 1);
    }
  });

  guiServer.listen(port, '127.0.0.1', () => {
    const guiUrl = `http://127.0.0.1:${port}`;
    console.log(`\n======================================================`);
    console.log(`      📡 DOMScanner Desktop Agent GUI Active`);
    console.log(`======================================================`);
    console.log(`   GUI Dashboard: ${guiUrl}\n`);

    connectCloud();
  });
}

startGuiServer(4567);
