/**
 * DOM IP Scanner / DOMScanner Backend Server
 * Works in Local Standalone Mode & Secure Cloud Remote Mode
 * Works on Windows, Linux, macOS, and Orange Pi (ARM)
 */

const express  = require('express');
const http     = require('http');
const path     = require('path');
const cors     = require('cors');

// Internal Modules
const scannerCore  = require('./lib/scanner-engine');
const cloudRoutes  = require('./lib/cloud-routes');
const wsServerHub  = require('./lib/ws-server');
const guestSession = require('./lib/guest-session');

const app  = express();
const PORT = process.env.PORT || 7890;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

/** Explicit Root Route */
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ─── Guest Session Token Endpoint ─────────────────────────────────────────────
/** GET /api/guest-token — returns shared guest JWT for no-login operation */
app.get('/api/guest-token', (req, res) => {
  const token = guestSession.getGuestToken();
  if (!token) return res.status(503).json({ error: 'Guest session not ready yet, retry in 2s' });
  res.json({ token });
});

// ─── Cloud REST API Routes ─────────────────────────────────────────────────────
app.use('/api', cloudRoutes);

// ─── Local Standalone API Endpoints (Preserved 100%) ──────────────────────────

/** API: Local Network Info */
app.get('/api/network', async (req, res) => {
  const info = scannerCore.getLocalNetwork();
  if (!info) return res.status(500).json({ error: 'No network interface found' });

  const parts   = info.ip.split('.');
  const gateway = `${parts[0]}.${parts[1]}.${parts[2]}.1`;
  const subnet  = `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
  const wifi    = await scannerCore.getWifiInfo();

  res.json({
    localIP:   info.ip,
    netmask:   info.netmask,
    iface:     info.iface,
    gateway,
    subnet,
    platform:  process.platform,
    ssid:      wifi.ssid,
    signal:    wifi.signal,
    band:      wifi.band,
    bssid:     wifi.bssid,
  });
});

/** API: Network Scan (SSE for real-time local scanning) */
app.get('/api/scan', async (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    await scannerCore.runNetworkScan((event, data) => {
      send(event, data);
    });
  } catch (err) {
    send('error', { message: err.message });
  }

  res.end();
});

/** API: Port Scan */
app.post('/api/portscan', async (req, res) => {
  const { ip, profile = 'common', ports } = req.body;
  if (!ip) return res.status(400).json({ error: 'IP required' });

  try {
    const result = await scannerCore.runPortScan(ip, profile, ports);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Start HTTP Server & Attach WebSockets ─────────────────────────────────────
const server = http.createServer(app);

// Attach Real-time Cloud WebSocket hub to HTTP server
wsServerHub.attachWebSocketServer(server);

server.listen(PORT, '0.0.0.0', async () => {
  const net = scannerCore.getLocalNetwork();
  console.log(`\n🚀 DOMScanner Server running at:`);
  console.log(`   Local Dashboard: http://0.0.0.0:${PORT}`);
  if (net) console.log(`   Network Access:  http://${net.ip}:${PORT}`);
  console.log(`   Cloud WS Hub:    ws://localhost:${PORT}/ws\n`);

  // Initialise guest session after server is up
  await guestSession.initGuestSession();
});
