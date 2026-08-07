# DOM IP Scanner — Developer Maintenance Manual

This manual provides technical reference guidelines for maintaining, updating, and extending **DOM IP Scanner**.

---

## 🗄️ 1. Database Schema (`domscanner.db`)

DOM IP Scanner uses **SQLite3** (`lib/db.js`) with automatic in-memory fallback.

### `agents` Table
| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | INTEGER PK | Auto-incrementing agent ID |
| `user_id` | INTEGER | Owner user ID (or guest user ID `1`) |
| `agent_name` | TEXT | Display name (e.g. `Android Phone`, `Desktop Agent`) |
| `agent_key` | TEXT UNIQUE | Secure random token generated for WebSocket auth |
| `status` | TEXT | Connection state (`online` \| `offline`) |
| `os_info` | TEXT | OS details (`Windows`, `Android Mobile`, `Linux`) |
| `local_ip` | TEXT | Internal IPv4 address (`192.168.0.213`) |
| `last_heartbeat`| DATETIME | Timestamp of last WebSocket ping |

---

## 🔌 2. WebSocket Communication Hub (`lib/ws-server.js`)

All real-time communication between browser clients and remote desktop/mobile agents flows through `wsServerHub`.

### Packet Types:
- **`start_scan`**: Client requests agent to scan local `/24` subnet.
- **`scan_event`**: Agent streams scan progress (`start`, `device`, `done`, `error`) back to client.
- **`heartbeat`**: Agent sends ping every 15s to maintain 24/7 online state.
- **`get_arp_table`**: Client requests Desktop Agent to send its kernel ARP map.
- **`arp_table_result`**: Desktop Agent replies with IP-to-MAC map (`arpMap`).

---

## 🍊 3. Adding New Hardware Vendors & Icons

To add a new hardware vendor or icon:

1. **Backend Vendor Matcher (`lib/scanner-engine.js` & `NetworkScannerPlugin.java`)**:
   Add OUI 6-character prefix to `getVendorFromMac()`:
   ```java
   if (p.startsWith("AA:BB:CC")) return "New Brand Name";
   ```
2. **Frontend Icon Dictionary (`app.js`)**:
   Add key to `DEVICE_ICONS`:
   ```javascript
   const DEVICE_ICONS = {
     newtype: '⚡',
     // ...
   };
   ```

---

## 📦 4. Release Engineering & Version Bumping

When pushing a new release:
1. Update `version` in `package.json`.
2. Update `versionCode` and `versionName` in `android/app/build.gradle`.
3. Sync web assets:
   ```powershell
   Copy-Item app.js android/app/src/main/assets/public/app.js -Force
   Copy-Item index.html android/app/src/main/assets/public/index.html -Force
   Copy-Item style.css android/app/src/main/assets/public/style.css -Force
   ```
4. Recompile Android APK (`build-apk.bat`).
5. Update `CHANGELOG.md`.
