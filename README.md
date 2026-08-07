# 🎯 DOM IP Scanner

> **Professional Cross-Platform LAN Device Finder, IP Intelligence & Remote Monitoring Dashboard**

DOM IP Scanner is a state-of-the-art, high-accuracy network scanner designed to discover, audit, and inspect every device connected to your Wi-Fi / Local Area Network (LAN). It operates seamlessly across **Web Browsers, Standalone Desktop Apps (Windows/macOS/Linux), Android Mobile Devices (Native APK), and Cloud Remote Deployments (Render)**.

---

## 🌟 Key Features & Highlights

- **⚡ Fast Parallel Discovery**: Scans all 254 IP addresses on `/24` subnets in under 3 seconds using parallel ICMP pings, TCP socket probes, UDP NetBIOS (137), mDNS (5353), and SSDP UPnP (1900).
- **🔎 Rich Device Detail Matrix**: Resolves IP Address, Hostname / Device Name, MAC Address, Hardware Manufacturer / Brand, Device Category, Latency (ms), Open Ports / Services, and Confidence Scores.
- **🍊 Deep Device Classification Engine**: Automatically identifies Orange Pi & Raspberry Pi SBCs, Gateway Routers, Apple iPhones/MacBooks, Samsung TVs, Windows PCs, Linux Servers, Printers, and IoT Plugs.
- **🖥️ Standalone Native Desktop App**: 1-click execution (`DOMScanner-Desktop.bat`) powered by Electron with 0 command prompt requirement and Windows System Tray integration.
- **📱 Standalone Android Mobile Agent**: Native Capacitor / Java Android app (`DOMScanner.apk v1.2.2`) with mDNS multicast, SSDP discovery, 24/7 Keep-Alive WebSocket, and custom high-tech launcher icon.
- **🌐 Dual View Modes**: Toggle instantly between **Interactive Grid Cards** and a responsive **8-Column Detailed Data Table**.
- **🔒 Zero-Touch Cloud Remote Mode**: Connects home agents to cloud web dashboards on Render via encrypted WebSockets (`wss://ipscaner.onrender.com`).
- **🛡️ Built-In Security Auditing**: Real-time Port Scanner (Common 19 ports, Web 80/443, Database 3306/5432, RDP 3389, SSH 22) and Public IP Geolocation lookup.

---

## 📦 Project Architecture Overview

```
DOM IP Scanner Workspace
├── server.js               # Node.js Express server & HTTP entry point
├── desktop-main.js         # Electron main process (Native Desktop Container)
├── desktop-preload.js      # Electron security IPC bridge
├── DOMScanner-Desktop.bat  # 1-Click Windows Batch launcher
├── build-apk.bat           # Android APK build script
├── index.html              # Core frontend web UI markup
├── style.css              # Cyberpunk dark mode design system
├── app.js                 # Reactive frontend application controller
├── lib/                    # Backend modular engines
│   ├── scanner-engine.js   # Local Node.js ICMP/ARP/NetBIOS/mDNS scanner
│   ├── cloud-routes.js     # REST API router & agent download handlers
│   ├── ws-server.js        # Real-time WebSocket hub for remote agents
│   ├── guest-session.js    # JWT guest session provider (No login required)
│   ├── db.js               # SQLite3 persistence layer
│   └── auth.js             # Password hashing & token verification
├── agent/                  # Agent binaries & APK downloads
│   └── DOMScanner.apk      # Compiled Android APK (v1.2.2)
├── android/                # Native Android Capacitor Gradle workspace
│   └── app/src/main/java/com/domscanner/app/NetworkScannerPlugin.java
└── docs/                   # Full Developer Architecture & API Specifications
    ├── ARCHITECTURE.md     # System architecture diagrams & workflow topology
    ├── API.md              # REST API reference & WebSocket message protocols
    └── WORKFLOWS.md        # Developer setup, compilation & deployment guides
```

---

## 🚀 Quick Start Guide

### 1. Prerequisites
- **Node.js**: v18.0.0 or higher
- **npm**: v9.0.0 or higher

### 2. Local Web Dashboard
```bash
# Clone the repository
git clone https://github.com/haridominatee-prog/ipscaner.git
cd ipscaner

# Install dependencies
npm install

# Start local server
npm start
```
Open **http://localhost:7890** in your browser.

### 3. Standalone Desktop App (Zero Terminal)
Double-click `DOMScanner-Desktop.bat` or run:
```bash
npm run desktop
```

### 4. Android Mobile App Installation
Download and install **DOMScanner.apk** on your Android phone:
👉 [https://ipscaner.onrender.com/api/downloads/agent/apk](https://ipscaner.onrender.com/api/downloads/agent/apk)

---

## 📄 License & Handover

This project is licensed under the [MIT License](LICENSE).  
For developer installation, see [INSTALL.md](INSTALL.md).  
For developer maintenance and operations, see [MAINTENANCE.md](MAINTENANCE.md).  
For full API and architecture documentation, explore the [docs/](docs/) folder.
