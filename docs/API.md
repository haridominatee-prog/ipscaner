# REST API & WebSocket Protocol Reference

Complete reference specification for **DOM IP Scanner** REST API endpoints and real-time WebSocket protocol messages.

---

## 🌐 1. REST API Endpoints

### `GET /api/guest-token`
Returns the shared guest JWT token for zero-touch operation.
- **Response `200 OK`**:
  ```json
  {
    "token": "eyJhbGciOiJIUzI1NiIsIn..."
  }
  ```

---

### `GET /api/network`
Retrieves local network interface parameters (Local IP, Gateway, Subnet, Wi-Fi SSID).
- **Response `200 OK`**:
  ```json
  {
    "localIP": "192.168.0.88",
    "netmask": "255.255.255.0",
    "iface": "Wi-Fi",
    "gateway": "192.168.0.1",
    "subnet": "192.168.0.0/24",
    "platform": "win32",
    "ssid": "DOMINATEE",
    "signal": "90%"
  }
  ```

---

### `GET /api/scan` (Server-Sent Events)
Streams real-time network scan progress and discovered device objects.
- **Events**:
  - `start`: `{ "subnet": "192.168.0.0/24", "total": 254 }`
  - `device`: Device object `{ "ip": "192.168.0.113", "mac": "B8:27:EB:12:34:56", "vendor": "Raspberry Pi", "hostname": "OrangePi.local", ... }`
  - `done`: `{ "total": 35, "devices": [...] }`

---

### `POST /api/portscan`
Executes a multi-port security scan against a specific target IP.
- **Request Body**:
  ```json
  {
    "ip": "192.168.0.1",
    "profile": "common"
  }
  ```
- **Response `200 OK`**:
  ```json
  {
    "ip": "192.168.0.1",
    "openPorts": [80, 53, 443],
    "services": [...]
  }
  ```

---

### `GET /api/agents`
Returns active online agents paired to the session.
- **Response `200 OK`**:
  ```json
  {
    "agents": [
      {
        "id": 1,
        "agent_name": "Android Phone",
        "status": "online",
        "local_ip": "192.168.0.213"
      }
    ]
  }
  ```

---

## 🔌 2. WebSocket Protocol Specifications (`/ws`)

### Agent Handshake:
`ws://localhost:7890/ws?type=agent&key=AGENT_KEY&agentName=Android%20Phone&localIp=192.168.0.213`

### Message Schema:

#### 1. Agent Heartbeat Ping (Client -> Server)
```json
{
  "type": "heartbeat",
  "localIp": "192.168.0.213",
  "ssid": "DOMINATEE Network",
  "signal": "85%"
}
```

#### 2. Start Scan Request (Browser -> Server -> Agent)
```json
{
  "action": "start_scan",
  "agentId": 1
}
```

#### 3. ARP Table Sync Request (Browser -> Agent)
```json
{
  "action": "get_arp_table",
  "agentId": 1
}
```

#### 4. ARP Table Sync Response (Agent -> Browser)
```json
{
  "type": "arp_table_result",
  "arpMap": {
    "192.168.0.1": "C8:D3:A3:12:34:56",
    "192.168.0.113": "B8:27:EB:98:76:54"
  }
}
```
