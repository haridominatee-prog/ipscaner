# DOM IP Scanner — Release Changelog

All notable changes, milestones, and version releases for **DOM IP Scanner** are documented in this file.

---

## [2.0.0 / Mobile v1.2.2] - 2026-08-07

### 🖥️ Standalone Native Desktop App
- Introduced **Electron Desktop Container (`desktop-main.js`)** bundling embedded Node.js Express server and local scanner engine into a 1-click standalone desktop application (`DOMScanner-Desktop.bat`).
- Added Windows System Tray icon integration and custom window controls.
- Zero terminal / zero command prompt requirement for end users.

### 📲 Mobile Agent & Android Native Upgrades (v1.2.2)
- Added **Native Android mDNS Multicast Engine (UDP 5353)** (`_services._dns-sd._udp.local`, `_http._tcp.local`) for exact device hostname resolution.
- Added **Native SSDP UPnP Multicast Engine (UDP 1900)** for Smart TV, Router, Speaker, and IoT hub model discovery.
- Added **SSH Banner Extraction (Port 22)**, **Apple iOS Lockdown Probing (Port 62078)**, and **Printer RAW Service Auditing (Ports 9100/631/515)**.
- Implemented **24/7 Keep-Alive WebSocket Heartbeat (15s)** & instant auto-reconnect loop on mobile.
- Formatted GPS-independent Gateway Router Wi-Fi Network Name resolution (`TP-LINK Network`).
- Updated Android launcher icon to a high-tech glowing radar crosshair design.
- Cleaned dropdown listing to display **ONLY active `🟢 Online` agents**.

---

## [1.5.0] - 2026-08-06

### 🌐 View Switcher & Detailed Data Table
- Added View Mode toggle (`Grid Cards` vs `Detailed Table`).
- Created responsive 8-Column Data Table displaying `Device Name`, `IP Address`, `MAC Address`, `Manufacturer / Vendor`, `Device Type`, `Status & Latency`, `Open Ports / Services`, and `Confidence Level`.
- Added confidence scoring algorithm (`High (90-95%)`, `Medium (70%)`, `Low (40%)`).

---

## [1.0.0] - 2026-08-05

### 🚀 Initial Production Release
- Multi-threaded ICMP Ping + TCP Socket Probe + UDP NetBIOS (Port 137) engine.
- System ARP kernel table reader (`/proc/net/arp` and `arp -a`).
- Offline OUI MAC Address Vendor lookup database (100+ hardware brands).
- Port Scanner module (Common 19 ports, Web 80/443, Database 3306/5432, RDP 3389).
- Public IP Intelligence lookup via `ipapi.co`.
- Cloud Remote WebSocket Hub (`ws-server.js`) for no-login guest pairing and Render deployment.
