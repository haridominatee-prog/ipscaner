# System Architecture & Technical Specifications

This document details the high-level architecture, module interaction topology, and execution sequence of **DOM IP Scanner**.

---

## 🏗️ 1. High-Level System Topology

```mermaid
graph TD
    Client[Web Browser Client] -->|HTTP / WS| Cloud[Render Cloud Server / Express]
    DesktopApp[Electron Desktop App] -->|Local Loopback 127.0.0.1:7890| ScannerEngine[Node.js Scanner Engine]
    MobileApp[Android Mobile APK] -->|Native mDNS/SSDP/NetBIOS| Wi-Fi[Wi-Fi / LAN Network]
    
    Cloud <-->|WebSocket Proxy| DesktopApp
    Cloud <-->|WebSocket Proxy| MobileApp
    
    ScannerEngine -->|ARP / ICMP / UDP 137| Wi-Fi
```

---

## ⚡ 2. Parallel Network Scanning Sequence

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Frontend as app.js (UI)
    participant Backend as Node / Android Engine
    participant Network as Target LAN Devices

    User->>Frontend: Click "Scan Network"
    Frontend->>Backend: Request Subnet Discovery (/24)
    
    par Parallel Probing
        Backend->>Network: ICMP Echo Ping (1-254)
        Backend->>Network: UDP 137 NetBIOS Query
        Backend->>Network: UDP 5353 mDNS Multicast
        Backend->>Network: UDP 1900 SSDP UPnP Broadcast
        Backend->>Network: TCP Port Audit (80, 443, 22, 3389, 5000)
    end

    Network-->>Backend: Responses & Banners
    Backend->>Backend: Match OUI MAC Vendor & Heuristics
    Backend-->>Frontend: Real-time Device Event Stream
    Frontend->>User: Render Grid Cards & 8-Column Data Table
```

---

## 📱 3. Mobile Agent & Cloud Synchronization Architecture

```mermaid
graph LR
    MobileAgent[Android Phone App] -->|15s Heartbeat Ping| RenderWS[Render Cloud WebSocket Hub]
    RenderWS -->|agents_updated| WebDashboard[Browser Dashboard]
    
    WebDashboard -->|start_scan| RenderWS
    RenderWS -->|Forward start_scan| MobileAgent
    MobileAgent -->|Native Discovery| LocalLAN[Local Network Devices]
    MobileAgent -->|Stream scan_event| RenderWS
    RenderWS -->|Stream Results| WebDashboard
```
