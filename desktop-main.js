/**
 * DOM IP Scanner — Native Desktop Application Main Entry (Electron)
 * Bundles embedded Node.js Express server, Scanner Core, and Electron UI window.
 * Zero Terminal required — double-click to launch!
 */

const { app, BrowserWindow, Tray, Menu, ipcMain, shell } = require('electron');
const path = require('path');
const http = require('http');

// Import Internal Server Engine
const express = require('express');
const cors    = require('cors');

const scannerCore  = require('./lib/scanner-engine');
const cloudRoutes  = require('./lib/cloud-routes');
const wsServerHub  = require('./lib/ws-server');
const guestSession = require('./lib/guest-session');

let mainWindow = null;
let tray       = null;
let serverApp  = null;
let httpServer = null;
const PORT     = 7890;

/** Initialize Embedded Background Server Engine */
function startEmbeddedServer() {
  return new Promise((resolve) => {
    serverApp = express();
    serverApp.use(cors());
    serverApp.use(express.json());
    serverApp.use(express.static(path.join(__dirname)));

    serverApp.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'index.html'));
    });

    serverApp.get('/api/guest-token', (req, res) => {
      const token = guestSession.getGuestToken();
      if (!token) return res.status(503).json({ error: 'Guest session initializing...' });
      res.json({ token });
    });

    serverApp.use('/api', cloudRoutes);

    serverApp.get('/api/network', async (req, res) => {
      const info = scannerCore.getLocalNetwork();
      if (!info) return res.status(500).json({ error: 'No active network interface found' });

      const parts   = info.ip.split('.');
      const gateway = `${parts[0]}.${parts[1]}.${parts[2]}.1`;
      const subnet  = `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
      const wifi    = await scannerCore.getWifiInfo();

      res.json({
        localIP:  info.ip,
        netmask:  info.netmask,
        iface:    info.iface,
        gateway,
        subnet,
        platform: process.platform,
        ssid:     wifi.ssid || 'Wi-Fi / LAN',
        signal:   wifi.signal || '100%',
        band:     wifi.band,
        bssid:    wifi.bssid,
      });
    });

    serverApp.get('/api/scan', async (req, res) => {
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

    serverApp.post('/api/portscan', async (req, res) => {
      const { ip, profile = 'common', ports } = req.body;
      if (!ip) return res.status(400).json({ error: 'IP required' });

      try {
        const result = await scannerCore.runPortScan(ip, profile, ports);
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    httpServer = http.createServer(serverApp);
    wsServerHub.attachWebSocketServer(httpServer);

    httpServer.listen(PORT, '127.0.0.1', async () => {
      console.log(`✅ Embedded Desktop Server running at http://127.0.0.1:${PORT}`);
      await guestSession.initGuestSession();
      resolve();
    });
  });
}

/** Create Native Desktop Window */
function createDesktopWindow() {
  const iconPath = path.join(__dirname, 'icon.svg');

  mainWindow = new BrowserWindow({
    width: 1300,
    height: 850,
    minWidth: 900,
    minHeight: 650,
    title: 'DOM IP Scanner — Desktop Edition',
    icon: iconPath,
    backgroundColor: '#0a0d14',
    show: false,
    frame: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'desktop-preload.js')
    }
  });

  mainWindow.loadURL(`http://127.0.0.1:${PORT}`);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      return false;
    }
  });
}

/** System Tray Integration */
function createSystemTray() {
  try {
    const iconPath = path.join(__dirname, 'icon.svg');
    tray = new Tray(iconPath);

    const contextMenu = Menu.buildFromTemplate([
      { label: 'DOM IP Scanner Desktop', enabled: false },
      { type: 'separator' },
      { label: 'Open Dashboard', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
      { label: 'Open in Browser', click: () => { shell.openExternal(`http://127.0.0.1:${PORT}`); } },
      { type: 'separator' },
      { label: 'Quit Application', click: () => { app.isQuitting = true; app.quit(); } }
    ]);

    tray.setToolTip('DOM IP Scanner — Active Network Monitor');
    tray.setContextMenu(contextMenu);

    tray.on('double-click', () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });
  } catch (e) {
    console.warn('Tray initialization notice:', e.message);
  }
}

// ── Application Lifecycle ──────────────────────────────────────────────────
app.whenReady().then(async () => {
  await startEmbeddedServer();
  createDesktopWindow();
  createSystemTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createDesktopWindow();
    else if (mainWindow) mainWindow.show();
  });
});

app.on('before-quit', () => {
  app.isQuitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
