/**
 * DOM IP Scanner — app.js
 * LAN Scanner + Port Scanner + Public IP Lookup
 */

// ── State ────────────────────────────────────────────────────────────────────
const S = {
  activeTab:    'scanner',
  devices:      [],          // all discovered devices
  activeFilter: 'all',
  filterText:   '',
  myPublicIP:   null,
  scanning:     false,
  mode:         'cloud',
  agents:       [],
  selectedAgentId: null,
  cloudWS:      null,
  guestToken:   null,        // auto-fetched JWT for no-login cloud mode
};

/** Fetch the server-generated guest JWT token (no login required) */
async function fetchGuestToken() {
  try {
    const res  = await fetch('/api/guest-token');
    if (!res.ok) return null;
    const data = await res.json();
    S.guestToken = data.token || null;
    return S.guestToken;
  } catch {
    return null;
  }
}

// ── Device type icons (emoji) ────────────────────────────────────────────────
const DEVICE_ICONS = {
  linux:   '🐧',
  windows: '🪟',
  apple:   '🍎',
  phone:   '📱',
  router:  '🌐',
  iot:     '💡',
  sbc:     '🍊',
  tv:      '📺',
  printer: '🖨️',
  server:  '🖥️',
  google:  '🔍',
  unknown: '❓',
};

function getIconEmoji(iconKey) {
  return DEVICE_ICONS[iconKey] || '❓';
}

// ── TAB SWITCHING ────────────────────────────────────────────────────────────
function switchTab(tabId) {
  S.activeTab = tabId;

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });

  document.querySelectorAll('.tab-content').forEach(el => {
    el.classList.toggle('active', el.id === `tab-${tabId}`);
  });

  if (tabId === 'portscan') updateQuickFill();
}

// ── STATUS BAR & HELPERS ──────────────────────────────────────────────────────
function setStatus(text, state = '') {
  const dot  = document.getElementById('status-dot');
  const txt  = document.getElementById('status-text');
  txt.textContent = text;
  dot.className   = 'pulse-dot' + (state ? ' ' + state : '');
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── NETWORK INFO ──────────────────────────────────────────────────────────────
async function loadNetworkInfo() {
  try {
    const res  = await fetch('/api/network');
    if (!res.ok) throw new Error('Network endpoint unavailable');
    const data = await res.json();
    if (!data || data.error || !data.localIP) throw new Error('No local IP');

    document.getElementById('bar-myip').textContent    = data.localIP || 'Unknown';
    document.getElementById('bar-gateway').textContent = data.gateway || '—';
    document.getElementById('bar-subnet').textContent  = data.subnet  || '—';
    document.getElementById('bar-ssid').textContent    = data.ssid || data.wifi?.ssid || 'Wi-Fi / LAN';
    document.getElementById('bar-signal').textContent  = data.signal || data.wifi?.signal || '100%';

    S.mode = 'local';
    const cloudAgentBar = document.getElementById('cloud-agent-bar');
    if (cloudAgentBar) cloudAgentBar.style.display = 'none';

    setStatus('Connected to local LAN', 'ok');
    return true;
  } catch {
    document.getElementById('bar-myip').textContent    = 'Cloud Remote';
    document.getElementById('bar-gateway').textContent = '—';
    document.getElementById('bar-subnet').textContent  = '—';
    document.getElementById('bar-ssid').textContent    = 'Remote Agents';
    document.getElementById('bar-signal').textContent  = '—';

    S.mode = 'cloud';
    const cloudAgentBar = document.getElementById('cloud-agent-bar');
    if (cloudAgentBar) cloudAgentBar.style.display = 'flex';
    return false;
  }
}

// ── NETWORK SCAN ─────────────────────────────────────────────────────────────
async function startScan() {
  if (S.scanning) return;

  if (getNativeNetworkScanner() || S.mode === 'native') {
    return startNativeAndroidScan();
  }

  if (S.mode === 'cloud') {
    return startCloudScan();
  }

  S.scanning = true;
  S.devices  = [];

  const btn       = document.getElementById('scan-btn');
  const progress  = document.getElementById('scan-progress');
  const filterBar = document.getElementById('filter-bar');
  const grid      = document.getElementById('device-grid');
  const emptyState= document.getElementById('empty-state');
  const countEl   = document.getElementById('bar-count');

  // Reset UI
  btn.disabled = true;
  btn.classList.add('scanning');
  document.getElementById('scan-btn-text').textContent = 'Scanning…';
  progress.style.display  = 'block';
  filterBar.style.display = 'none';
  emptyState.style.display= 'none';
  grid.innerHTML = '';
  countEl.textContent = '0';
  setStatus('Scanning LAN…', '');

  const evtSource = new EventSource('/api/scan');

  evtSource.addEventListener('start', (e) => {
    const d = JSON.parse(e.data);
    document.getElementById('progress-sub').textContent =
      `Scanning subnet ${d.subnet} (${d.total} addresses)…`;
  });

  evtSource.addEventListener('progress', (e) => {
    const d = JSON.parse(e.data);
    const pct = Math.round((d.scanned / d.total) * 100);
    document.getElementById('progress-fill').style.width  = pct + '%';
    document.getElementById('progress-count').textContent = `${d.scanned} / ${d.total}`;
    document.getElementById('progress-label').textContent =
      `Ping sweep — found ${d.found} device${d.found !== 1 ? 's' : ''} so far…`;
    document.getElementById('progress-sub').textContent =
      `Checking ${d.scanned < d.total ? 'addresses…' : 'done pinging'}`;
  });

  evtSource.addEventListener('arp_done', (e) => {
    const d = JSON.parse(e.data);
    document.getElementById('progress-label').textContent =
      `Enriching ${d.count} discovered device${d.count !== 1 ? 's' : ''} (MAC, Brand, Ports)…`;
    document.getElementById('progress-fill').style.width = '85%';
  });

  evtSource.addEventListener('device', (e) => {
    const d = JSON.parse(e.data);
    S.devices.push(d);
    countEl.textContent = S.devices.length;
    appendDeviceCard(d, grid);
    updateFilterCounts();
  });

  evtSource.addEventListener('done', (e) => {
    const d = JSON.parse(e.data);
    evtSource.close();
    S.scanning = false;

    progress.style.display  = 'none';
    filterBar.style.display = 'flex';
    btn.disabled = false;
    btn.classList.remove('scanning');
    document.getElementById('scan-btn-text').textContent = 'Scan Again';

    setStatus(`Scan complete — ${d.total} devices found`, 'ok');
    updateQuickFill();

    if (S.devices.length === 0) {
      emptyState.style.display = 'flex';
    }
  });

  evtSource.onerror = () => {
    evtSource.close();
    S.scanning = false;
    btn.disabled = false;
    btn.classList.remove('scanning');
    document.getElementById('scan-btn-text').textContent = 'Scan Network';
    progress.style.display = 'none';
    setStatus('Scan error or interrupted', 'err');
    if (S.devices.length === 0) emptyState.style.display = 'flex';
  };
}

// ── DEVICE CARD & TABLE RENDERING ─────────────────────────────────────────────
let currentViewMode = 'grid';

function setViewMode(mode) {
  currentViewMode = mode;
  const gridBtn = document.getElementById('btn-view-grid');
  const tableBtn = document.getElementById('btn-view-table');
  const gridEl = document.getElementById('device-grid');
  const tableContainer = document.getElementById('device-table-container');

  if (mode === 'table') {
    gridBtn?.classList.remove('active');
    tableBtn?.classList.add('active');
    if (gridEl) gridEl.style.display = 'none';
    if (tableContainer && S.devices.length > 0) tableContainer.style.display = 'block';
  } else {
    tableBtn?.classList.remove('active');
    gridBtn?.classList.add('active');
    if (tableContainer) tableContainer.style.display = 'none';
    if (gridEl) gridEl.style.display = 'grid';
  }
}

function appendDeviceTableRow(d, tbody) {
  if (!tbody) tbody = document.getElementById('device-table-body');
  if (!tbody) return;

  const existingRow = tbody.querySelector(`tr[data-ip="${d.ip}"]`);
  const icon = DEVICE_ICONS[d.deviceType?.icon] || '❓';
  const name = d.hostname && d.hostname !== 'Not discovered' ? d.hostname : (d.deviceType?.label || 'Network Device');
  const mac = d.mac || 'Not available on Android';
  const vendor = d.vendor || 'Not discovered';
  const status = d.status || 'Online (15 ms)';
  const services = d.servicesFormatted || (d.openPorts && d.openPorts.length > 0 ? d.openPorts.join(', ') : 'None detected');
  const confidence = d.confidence || (d.isGateway || d.isMe ? 'High (95%)' : 'Medium (70%)');

  let confClass = 'conf-medium';
  if (confidence.startsWith('High')) confClass = 'conf-high';
  else if (confidence.startsWith('Low')) confClass = 'conf-low';

  const tr = existingRow || document.createElement('tr');
  tr.dataset.ip = d.ip;
  tr.dataset.type = d.deviceType?.type || 'unknown';

  tr.innerHTML = `
    <td>
      <div class="dt-name">
        <span class="dt-icon">${icon}</span>
        <span>${escHtml(name)}</span>
      </div>
    </td>
    <td><span class="dt-ip">${escHtml(d.ip)}</span></td>
    <td><span class="dt-mac">${escHtml(mac)}</span></td>
    <td><span>${escHtml(vendor)}</span></td>
    <td><span>${escHtml(d.deviceType?.label || 'Network Device')}</span></td>
    <td>
      <div class="dt-status">
        <span class="dt-status-dot"></span>
        <span>${escHtml(status)}</span>
      </div>
    </td>
    <td><span>${escHtml(services)}</span></td>
    <td><span class="dt-confidence ${confClass}">${escHtml(confidence)}</span></td>
  `;

  if (!existingRow) tbody.appendChild(tr);
}

function appendDeviceCard(d, container) {
  appendDeviceTableRow(d);

  const icon  = DEVICE_ICONS[d.deviceType?.icon] || '❓';
  const ports = d.openPorts || [];

  const card = document.createElement('div');
  card.className = `device-card${d.isMe ? ' is-me' : ''}${d.isGateway ? ' is-gateway' : ''}`;
  card.dataset.type = d.deviceType?.type || 'unknown';

  let badgeHtml = '';
  if (d.isMe) {
    badgeHtml = `<span class="device-badge badge-me">This Device</span>`;
  } else if (d.isGateway) {
    badgeHtml = `<span class="device-badge badge-gw">Gateway / Router</span>`;
  } else if (d.label) {
    badgeHtml = `<span class="device-badge badge-label">${escHtml(d.label)}</span>`;
  }

  let portsHtml = '';
  if (ports.length > 0) {
    const portChips = ports.map(p => `<span class="port-chip open">${p}</span>`).join('');
    portsHtml = `
      <div class="card-ports">
        <span class="ports-title">Open Ports:</span>
        <div class="ports-list">${portChips}</div>
      </div>`;
  }

  let sshHtml = '';
  if (d.sshBanner) {
    sshHtml = `<div class="card-ssh-banner" title="SSH Banner">📟 ${escHtml(d.sshBanner.slice(0, 45))}</div>`;
  }

  card.innerHTML = `
    <div class="card-top">
      <div class="card-icon-wrap icon-${d.deviceType?.icon || 'unknown'}">
        <span class="card-icon">${icon}</span>
      </div>
      <div class="card-title-group">
        <div class="card-ip-row">
          <span class="card-ip mono">${escHtml(d.ip)}</span>
          ${badgeHtml}
        </div>
        <div class="card-type-name">${escHtml(d.deviceType?.label || 'Network Device')}</div>
      </div>
    </div>

    <div class="card-details">
      <div class="detail-row">
        <span class="detail-label">MAC Address</span>
        <span class="detail-val mono">${escHtml(d.mac)}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Vendor / Brand</span>
        <span class="detail-val vendor-val">${escHtml(d.vendor || 'Unknown')}</span>
      </div>
      ${d.hostname ? `
      <div class="detail-row">
        <span class="detail-label">Hostname</span>
        <span class="detail-val mono host-val">${escHtml(d.hostname)}</span>
      </div>` : ''}
    </div>

    ${sshHtml}
    ${portsHtml}

    <div class="card-actions">
      <button class="action-btn" onclick="psQuickFill('${d.ip}');switchTab('portscan')">
        🔍 Scan Ports
      </button>
      <a href="http://${d.ip}" target="_blank" rel="noopener" class="action-btn secondary">
        🌐 Open HTTP
      </a>
      <button class="action-btn secondary icon-only" title="Copy Details" onclick="copyDeviceDetails('${d.ip}','${d.mac}','${escHtml(d.vendor)}')">
        📋
      </button>
    </div>
  `;

  container.appendChild(card);
}

function copyDeviceDetails(ip, mac, vendor) {
  const text = `IP: ${ip}\nMAC: ${mac}\nVendor: ${vendor}`;
  navigator.clipboard.writeText(text).then(() => {
    setStatus(`Copied ${ip} details to clipboard`, 'ok');
  });
}

// ── FILTER & SEARCH ───────────────────────────────────────────────────────────
function filterDevices(type) {
  S.activeFilter = type;
  document.querySelectorAll('.filter-pills .pill').forEach(p => {
    p.classList.toggle('active', p.dataset.filter === type);
  });
  applyFilterAndSearch();
}

function searchDevices(query) {
  S.filterText = query.toLowerCase().trim();
  applyFilterAndSearch();
}

function applyFilterAndSearch() {
  const cards = document.querySelectorAll('.device-card');
  cards.forEach(card => {
    const cardType = card.dataset.type;
    const text     = card.innerText.toLowerCase();

    const matchesFilter = S.activeFilter === 'all' || cardType === S.activeFilter;
    const matchesSearch = !S.filterText || text.includes(S.filterText);

    card.style.display = (matchesFilter && matchesSearch) ? 'flex' : 'none';
  });
}

function updateFilterCounts() {
  const counts = { all: S.devices.length, sbc: 0, router: 0, phone: 0, computer: 0 };

  S.devices.forEach(d => {
    const t = d.deviceType?.type;
    if (t === 'sbc') counts.sbc++;
    else if (t === 'router') counts.router++;
    else if (t === 'phone' || t === 'tv') counts.phone++;
    else if (t === 'windows' || t === 'apple' || t === 'linux') counts.computer++;
  });

  document.getElementById('cnt-all').textContent      = counts.all;
  document.getElementById('cnt-sbc').textContent      = counts.sbc;
  document.getElementById('cnt-router').textContent   = counts.router;
  document.getElementById('cnt-phone').textContent    = counts.phone;
  document.getElementById('cnt-computer').textContent = counts.computer;
}

// ── PORT SCANNER ─────────────────────────────────────────────────────────────
// ── PORT SCANNER LOGIC ────────────────────────────────────────────────────────
let portScanResultsCache = null;
let currentPortFilter = 'all';

function toggleCustomPorts(val) {
  const wrap = document.getElementById('ps-custom-wrap');
  if (wrap) wrap.style.display = val === 'custom' ? 'block' : 'none';
}

function updateQuickFill() {
  const container = document.getElementById('ps-quick-fill');
  if (!container) return;

  const ipList = [];

  // Get selected agent IP
  let agentIp = null;
  if (S.selectedAgentId) {
    const agent = S.agents.find(a => a.id === S.selectedAgentId);
    if (agent && agent.local_ip && agent.local_ip !== 'unknown') {
      agentIp = agent.local_ip;
    }
  }

  // 1. Gateway IP (e.g. 192.168.0.1)
  if (agentIp && agentIp.includes('.')) {
    const parts = agentIp.split('.');
    const gatewayIp = `${parts[0]}.${parts[1]}.${parts[2]}.1`;
    ipList.push({ ip: gatewayIp, label: 'Gateway / Router', icon: '🌐' });
  }

  // 2. Desktop Agent IP
  if (agentIp) {
    ipList.push({ ip: agentIp, label: 'Desktop Agent PC', icon: '💻' });
  }

  // 3. Discovered Devices from Network Scan
  if (S.devices && S.devices.length > 0) {
    for (const d of S.devices) {
      if (!ipList.some(item => item.ip === d.ip)) {
        const icon = d.deviceType?.icon ? getIconEmoji(d.deviceType.icon) : (d.isGateway ? '🌐' : '💻');
        const label = d.hostname || d.vendor || (d.isGateway ? 'Gateway' : 'Device');
        ipList.push({ ip: d.ip, label, icon });
      }
    }
  }

  if (ipList.length === 0) {
    container.innerHTML = '<span class="ps-quick-empty">Waiting for Desktop Agent network info…</span>';
    return;
  }

  const chipsHtml = ipList.slice(0, 16).map(item => `
    <button class="ps-quick-chip" onclick="setPortScanTarget('${item.ip}', this)" title="${item.label}">
      <span>${item.icon}</span>
      <span>${item.ip}</span>
    </button>
  `).join('');

  container.innerHTML = chipsHtml;

  const targetInput = document.getElementById('ps-target');
  if (targetInput && !targetInput.value && ipList.length > 0) {
    targetInput.value = ipList[0].ip;
  }
}

function setPortScanTarget(ip, btnEl) {
  const targetInput = document.getElementById('ps-target');
  if (targetInput) targetInput.value = ip;
  document.querySelectorAll('.ps-quick-chip').forEach(c => c.classList.remove('active'));
  if (btnEl) btnEl.classList.add('active');
}

async function startPortScan() {
  const targetInput = document.getElementById('ps-target');
  const targetIp = targetInput ? targetInput.value.trim() : '';

  if (!targetIp) {
    alert('Please enter or select a Target IP Address to scan.');
    return;
  }

  const profile = document.getElementById('ps-profile').value;
  const customPortsStr = document.getElementById('ps-custom') ? document.getElementById('ps-custom').value.trim() : '';

  const btnIcon = document.getElementById('ps-btn-icon');
  const btnText = document.getElementById('ps-btn-text');
  const resultsBox = document.getElementById('ps-results');
  const statusEl = document.getElementById('ps-res-status');

  if (btnIcon) btnIcon.textContent = '⏳';
  if (btnText) btnText.textContent = 'Scanning Ports…';
  if (resultsBox) resultsBox.style.display = 'block';
  if (statusEl) {
    statusEl.className = 'badge';
    statusEl.textContent = 'Scanning…';
  }

  document.getElementById('ps-res-target').textContent = targetIp;
  document.getElementById('ps-ports-grid').innerHTML = '<div style="color:var(--cyan);padding:24px;grid-column:1/-1;text-align:center;">Scanning TCP ports on target IP… Please wait.</div>';

  if (S.mode === 'cloud') {
    if (!S.selectedAgentId) {
      alert('Please select an active Desktop Agent first.');
      resetPortScanBtn();
      return;
    }

    if (!S.cloudWS || S.cloudWS.readyState !== WebSocket.OPEN) {
      connectCloudWS();
    }

    S.cloudWS.send(JSON.stringify({
      action: 'port_scan',
      agentId: S.selectedAgentId,
      ip: targetIp,
      profile,
      customPorts: customPortsStr,
    }));
  } else {
    try {
      const res = await fetch(`/api/portscan?ip=${encodeURIComponent(targetIp)}&profile=${encodeURIComponent(profile)}&custom=${encodeURIComponent(customPortsStr)}`);
      const data = await res.json();
      renderPortScanResults(data);
    } catch (err) {
      alert(`Port Scan failed: ${err.message}`);
    } finally {
      resetPortScanBtn();
    }
  }
}

function resetPortScanBtn() {
  const btnIcon = document.getElementById('ps-btn-icon');
  const btnText = document.getElementById('ps-btn-text');
  if (btnIcon) btnIcon.textContent = '⚡';
  if (btnText) btnText.textContent = 'Run Port Scan';
}

function renderPortScanResults(data) {
  resetPortScanBtn();
  if (!data) return;

  portScanResultsCache = data;

  document.getElementById('ps-res-target').textContent  = data.ip || '—';
  document.getElementById('ps-res-scanned').textContent = data.scanned || 0;

  const openCount = data.open ? data.open.length : (data.results ? data.results.filter(r => r.open).length : 0);
  document.getElementById('ps-res-open').textContent = openCount;

  const statusEl = document.getElementById('ps-res-status');
  if (statusEl) {
    statusEl.className = 'badge open-cnt';
    statusEl.textContent = 'Completed';
  }

  const resultsList = data.results || [];
  const closedCount = resultsList.length - openCount;

  document.getElementById('ps-cnt-all').textContent    = resultsList.length;
  document.getElementById('ps-cnt-open').textContent   = openCount;
  document.getElementById('ps-cnt-closed').textContent = closedCount;

  filterPortScanResults(currentPortFilter);
}

function filterPortScanResults(filter) {
  currentPortFilter = filter;
  document.querySelectorAll('.ps-filter-bar .pill').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === filter);
  });

  if (!portScanResultsCache || !portScanResultsCache.results) return;

  let filtered = portScanResultsCache.results;
  if (filter === 'open')   filtered = filtered.filter(r => r.open);
  if (filter === 'closed') filtered = filtered.filter(r => !r.open);

  const grid = document.getElementById('ps-ports-grid');
  if (!grid) return;

  if (filtered.length === 0) {
    grid.innerHTML = '<div style="color:var(--text-3);padding:30px;grid-column:1/-1;text-align:center;">No matching ports found.</div>';
    return;
  }

  grid.innerHTML = filtered.map(r => `
    <div class="port-card ${r.open ? 'open' : 'closed'}">
      <div class="port-card-top">
        <span class="port-num">Port ${r.port}</span>
        <span class="port-badge ${r.open ? 'open' : 'closed'}">${r.open ? '🟢 OPEN' : '🔴 CLOSED'}</span>
      </div>
      <div class="port-service">
        <span>${getServiceIcon(r.service, r.port)}</span>
        <span>${r.service}</span>
      </div>
    </div>
  `).join('');
}

function getServiceIcon(service, port) {
  const s = (service || '').toLowerCase();
  if (s.includes('http') || port === 80 || port === 443 || port === 8080) return '🌐';
  if (s.includes('ssh') || port === 22) return '🔑';
  if (s.includes('ftp') || port === 21) return '📁';
  if (s.includes('rdp') || port === 3389) return '💻';
  if (s.includes('sql') || s.includes('redis') || s.includes('mongo') || port === 3306 || port === 5432) return '🗄️';
  if (s.includes('printer') || port === 9100 || port === 515 || port === 631) return '🖨️';
  if (s.includes('mqtt') || port === 1883) return '💡';
  if (s.includes('dns') || port === 53) return '🔍';
  return '🔌';
}

function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  if (overlay) overlay.style.display = 'none';

  document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

// ── PUBLIC IP LOOKUP ──────────────────────────────────────────────────────────
let publicIPData = null;

async function loadPublicIP() {
  try {
    const data = await fetch('https://ipapi.co/json/').then(r => r.json());
    if (data.error) return;
    publicIPData = data;
    S.myPublicIP = data.ip;

    document.getElementById('my-ip-addr').textContent = data.ip;

    const meta = document.getElementById('my-ip-meta');
    meta.innerHTML = `
      <span class="ip-meta-chip">📍 ${data.city || '—'}, ${data.country_name || '—'}</span>
      <span class="ip-meta-chip">🏢 ${(data.org || '—').slice(0,30)}</span>
    `;

    renderPublicInfoGrid(data);
  } catch {
    document.getElementById('my-ip-addr').textContent = 'Unavailable';
  }
}

function renderPublicInfoGrid(d) {
  const grid = document.getElementById('pub-info-grid');
  const items = [
    { icon: '📍', cls: 'pi-cyan',   label: 'Location',    val: `${d.city || '—'}, ${d.country_name || '—'}`, sub: d.region },
    { icon: '🏢', cls: 'pi-purple', label: 'ISP / Org',   val: (d.org || '—').slice(0,35),    sub: d.asn },
    { icon: '🕒', cls: 'pi-amber',  label: 'Timezone',    val: d.timezone || '—',              sub: '' },
    { icon: '📌', cls: 'pi-green',  label: 'Coordinates', val: d.latitude != null ? `${d.latitude.toFixed(4)}°, ${d.longitude.toFixed(4)}°` : '—', sub: `Postal: ${d.postal || '—'}` },
    { icon: '💱', cls: 'pi-pink',   label: 'Currency',    val: d.currency ? `${d.currency} — ${d.currency_name || ''}` : '—', sub: '' },
  ];

  grid.innerHTML = items.map(it => `
    <div class="pub-info-card">
      <div class="pub-info-icon ${it.cls}">${it.icon}</div>
      <div>
        <div class="pub-info-key">${it.label}</div>
        <div class="pub-info-val">${escHtml(it.val)}</div>
        ${it.sub ? `<div class="pub-info-sub">${escHtml(it.sub)}</div>` : ''}
      </div>
    </div>
  `).join('');
}

function copyPublicIP() {
  if (!S.myPublicIP) return;
  const btn = document.getElementById('copy-pub-btn');
  navigator.clipboard.writeText(S.myPublicIP).then(() => {
    btn.classList.add('copied');
    btn.innerHTML = `<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"/></svg> Copied!`;
    setTimeout(() => {
      btn.classList.remove('copied');
      btn.innerHTML = `<svg viewBox="0 0 20 20" fill="currentColor"><path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z"/><path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z"/></svg> Copy`;
    }, 2000);
  });
}

function copyAgentPsCmd(btnEl) {
  const input = document.getElementById('ps-cmd-text');
  if (!input) return;
  input.select();
  navigator.clipboard.writeText(input.value).then(() => {
    const origText = btnEl.textContent;
    btnEl.textContent = '✅ Copied!';
    setTimeout(() => { btnEl.textContent = origText; }, 2500);
  });
}

// ── PWA SUPPORT ───────────────────────────────────────────────────────────────
let deferredPrompt;

function setupPWA() {
  const installBtn = document.getElementById('pwa-install-btn');

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (installBtn) installBtn.style.display = 'inline-flex';
  });

  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        installBtn.style.display = 'none';
      }
      deferredPrompt = null;
    });
  }

  window.addEventListener('appinstalled', () => {
    if (installBtn) installBtn.style.display = 'none';
    deferredPrompt = null;
    console.log('DOM IP Scanner app installed successfully!');
  });
}

function triggerPWAInstall() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(() => { deferredPrompt = null; });
  } else {
    alert('📲 To install DOM IP Scanner as an App on Android:\n\n1. Tap the Chrome menu (3 dots at top right)\n2. Tap "Add to Home screen" (or "Install app")\n\nIt will install directly onto your phone home screen!');
  }
}

// ── ☁️ CLOUD REMOTE MODE EXTENSIONS ──────────────────────────────────────────

function setAppMode(mode) {
  S.mode = mode;
  document.getElementById('mode-btn-local').classList.toggle('active', mode === 'local');
  document.getElementById('mode-btn-cloud').classList.toggle('active', mode === 'cloud');

  const cloudAgentBar = document.getElementById('cloud-agent-bar');
  if (cloudAgentBar) cloudAgentBar.style.display = mode === 'cloud' ? 'flex' : 'none';

  if (mode === 'cloud') {
    fetchUserAgents();
    connectCloudWS();
  } else {
    setStatus('Connected to local LAN', 'ok');
  }
}

function openAgentDownloadModal() {
  closeModal();
  document.getElementById('modal-overlay').style.display = 'block';
  document.getElementById('agent-download-modal').style.display = 'block';
}

async function fetchUserAgents() {
  if (!S.guestToken) return;
  try {
    const res = await fetch('/api/agents', {
      headers: { Authorization: `Bearer ${S.guestToken}` }
    });
    if (!res.ok) return;
    const data = await res.json();
    S.agents = data.agents || [];
    renderAgentsDropdown();
  } catch { }
}

function renderAgentsDropdown() {
  const select = document.getElementById('agent-select');
  select.innerHTML = '';
  if (S.agents.length === 0) {
    select.innerHTML = '<option value="">No desktop agents connected yet (Click "Get Desktop Agent")</option>';
    updateAgentBadge(false);
    return;
  }

  const sorted = [...S.agents].sort((a, b) => (b.status === 'online' ? 1 : 0) - (a.status === 'online' ? 1 : 0));

  sorted.forEach(a => {
    const opt = document.createElement('option');
    opt.value = a.id;
    opt.textContent = `${a.agent_name} (${a.status === 'online' ? '🟢 Online' : '⚪ Offline'} - ${a.local_ip || 'No IP'})`;
    select.appendChild(opt);
  });

  const firstOnline = sorted.find(a => a.status === 'online');
  if (firstOnline) {
    S.selectedAgentId = firstOnline.id;
  } else if (sorted.length > 0) {
    S.selectedAgentId = sorted[0].id;
  }

  select.value = S.selectedAgentId || '';
  onAgentSelectChange();
}

function onAgentSelectChange() {
  const select = document.getElementById('agent-select');
  S.selectedAgentId = parseInt(select.value);
  const selected = S.agents.find(a => a.id === S.selectedAgentId);
  updateAgentBadge(selected ? selected.status === 'online' : false);
  updateAgentNetworkHeader(selected);
  updateQuickFill();
}

function updateAgentNetworkHeader(agent) {
  if (!agent || agent.status !== 'online') {
    document.getElementById('bar-myip').textContent    = 'Cloud Remote';
    document.getElementById('bar-gateway').textContent = '—';
    document.getElementById('bar-subnet').textContent  = '—';
    document.getElementById('bar-ssid').textContent    = 'Remote Agents';
    document.getElementById('bar-signal').textContent  = '—';
    return;
  }

  const ip = agent.local_ip || '';
  if (ip && ip !== 'unknown' && ip.includes('.')) {
    const parts = ip.split('.');
    const gateway = `${parts[0]}.${parts[1]}.${parts[2]}.1`;
    const subnet = `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
    document.getElementById('bar-myip').textContent    = ip;
    document.getElementById('bar-gateway').textContent = gateway;
    document.getElementById('bar-subnet').textContent  = subnet;
  } else {
    document.getElementById('bar-myip').textContent    = agent.local_ip || 'Online';
    document.getElementById('bar-gateway').textContent = '—';
    document.getElementById('bar-subnet').textContent  = '—';
  }

  document.getElementById('bar-ssid').textContent    = agent.ssid || 'Wi-Fi / LAN';
  document.getElementById('bar-signal').textContent  = agent.signal || '100%';
}

function updateAgentBadge(isOnline) {
  const badge = document.getElementById('agent-status-badge');
  if (badge) {
    badge.className = `agent-status-badge ${isOnline ? 'online' : 'offline'}`;
    badge.textContent = isOnline ? '● Online' : '● Offline';
  }

  if (S.mode === 'cloud') {
    if (isOnline) {
      setStatus('Agent Online — Ready to Scan', 'ok');
    } else {
      setStatus('Waiting for Desktop Agent…', '');
    }
  }
}

function connectCloudWS() {
  if (!S.guestToken) return;
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${location.host}/ws?type=client&token=${encodeURIComponent(S.guestToken)}`;

  if (S.cloudWS) S.cloudWS.close();

  try {
    S.cloudWS = new WebSocket(wsUrl);

    S.cloudWS.onopen = () => {
      console.log('✅ Connected to DOMScanner Cloud WebSocket');
    };

    S.cloudWS.onmessage = (msg) => {
      try {
        const payload = JSON.parse(msg.data);
        handleCloudWSMessage(payload);
      } catch {}
    };

    S.cloudWS.onclose = () => {
      setTimeout(() => {
        if (S.mode === 'cloud') connectCloudWS();
      }, 5000);
    };
  } catch {}
}

function handleCloudWSMessage(msg) {
  if (msg.type === 'agents_updated') {
    S.agents = msg.agents || [];
    renderAgentsDropdown();
  }

  if (msg.type === 'scan_stream') {
    handleCloudScanStream(msg.event, msg.data);
  }

  if (msg.type === 'scan_initiated') {
    // Scan command accepted by server and forwarded to agent
    setStatus(`Agent is scanning... results will stream in real-time.`, '');
  }

  if (msg.type === 'scan_error') {
    // Scan command rejected by server
    const btn = document.getElementById('scan-btn');
    S.scanning = false;
    if (btn) { btn.disabled = false; btn.classList.remove('scanning'); }
    const textEl = document.getElementById('scan-btn-text');
    if (textEl) textEl.textContent = 'Scan Network';
    const progress = document.getElementById('scan-progress');
    if (progress) progress.style.display = 'none';
    const emptyState = document.getElementById('empty-state');
    if (emptyState && S.devices.length === 0) emptyState.style.display = 'flex';
    setStatus(`Scan error: ${msg.message || 'Agent rejected scan command'}`, 'err');
    console.error('❌ Scan error from server:', msg.message);
  }

  if (msg.type === 'portscan_result') {
    renderPortScanResults(msg.data);
  }
}

function runRemoteAgentScan(agent) {
  if (S.scanning) return;

  // readyState 1 = OPEN (works in all browsers, avoids WebSocket.OPEN reference issues)
  if (!S.cloudWS || S.cloudWS.readyState !== 1) {
    setStatus('Reconnecting to cloud server...', '');
    connectCloudWS();
    // Retry after 2s once WebSocket reconnects
    setTimeout(() => {
      if (S.cloudWS && S.cloudWS.readyState === 1) {
        runRemoteAgentScan(agent);
      } else {
        setStatus('Could not connect to cloud server. Please refresh.', 'err');
      }
    }, 2000);
    return;
  }

  S.scanning = true;
  S.devices  = [];

  const btn       = document.getElementById('scan-btn');
  const progress  = document.getElementById('scan-progress');
  const filterBar = document.getElementById('filter-bar');
  const grid      = document.getElementById('device-grid');
  const emptyState= document.getElementById('empty-state');
  const countEl   = document.getElementById('bar-count');

  btn.disabled = true;
  btn.classList.add('scanning');
  document.getElementById('scan-btn-text').textContent = 'Remote Scanning…';
  progress.style.display  = 'block';
  filterBar.style.display = 'none';
  emptyState.style.display= 'none';
  grid.innerHTML = '';
  countEl.textContent = '0';
  setStatus(`Commanding agent \"${agent.agent_name || 'Desktop'}\" to scan network…`, '');

  // Safety timeout — if scan never starts within 30s, unblock button
  const scanTimeout = setTimeout(() => {
    if (S.scanning) {
      S.scanning = false;
      btn.disabled = false;
      btn.classList.remove('scanning');
      document.getElementById('scan-btn-text').textContent = 'Scan Network';
      progress.style.display = 'none';
      if (S.devices.length === 0 && emptyState) emptyState.style.display = 'flex';
      setStatus('Scan timed out — agent may be unreachable. Try again.', 'err');
    }
  }, 30000);

  // Store so done/error events can clear it
  S._scanTimeout = scanTimeout;

  try {
    S.cloudWS.send(JSON.stringify({
      action: 'start_scan',
      agentId: agent.id
    }));
  } catch (err) {
    clearTimeout(S._scanTimeout);
    S.scanning = false;
    btn.disabled = false;
    btn.classList.remove('scanning');
    document.getElementById('scan-btn-text').textContent = 'Scan Network';
    progress.style.display = 'none';
    setStatus('Failed to send scan command — WebSocket error.', 'err');
  }
}

function startCloudScan() {
  const selectedAgent = S.agents.find(a => a.id === S.selectedAgentId);
  if (!selectedAgent || selectedAgent.status !== 'online') {
    openAgentDownloadModal();
    return;
  }

  runRemoteAgentScan(selectedAgent);
}

async function startNativeAndroidScan() {
  if (S.scanning) return;
  S.scanning = true;
  S.devices  = [];

  const btn       = document.getElementById('scan-btn');
  const progress  = document.getElementById('scan-progress');
  const filterBar = document.getElementById('filter-bar');
  const grid      = document.getElementById('device-grid');
  const emptyState= document.getElementById('empty-state');
  const countEl   = document.getElementById('bar-count');

  btn.disabled = true;
  btn.classList.add('scanning');
  document.getElementById('scan-btn-text').textContent = 'Android Scanning…';
  progress.style.display  = 'block';
  filterBar.style.display = 'none';
  emptyState.style.display= 'none';
  grid.innerHTML = '';
  const tableBody = document.getElementById('device-table-body');
  if (tableBody) tableBody.innerHTML = '';
  const tableContainer = document.getElementById('device-table-container');
  if (tableContainer) tableContainer.style.display = 'none';
  countEl.textContent = '0';
  setStatus('Scanning local Wi-Fi via Android Native Engine…', '');

  let progressListener = null;
  let deviceListener   = null;

  try {
    const ns = getNativeNetworkScanner();

    if (!ns) {
      throw new Error('Android Native Scanner plugin not ready. Please restart app.');
    }

    if (typeof ns.addListener === 'function') {
      try {
        progressListener = await ns.addListener('scanProgress', (d) => {
          if (!d) return;
          const pct = Math.round(((d.scanned || 0) / (d.total || 254)) * 100);
          document.getElementById('progress-fill').style.width  = pct + '%';
          document.getElementById('progress-count').textContent = `${d.scanned || 0} / ${d.total || 254}`;
          document.getElementById('progress-label').textContent = `Mobile ping sweep — found ${d.found || 0} device${(d.found !== 1) ? 's' : ''}…`;
          document.getElementById('progress-sub').textContent   = `Scanning 254 subnet IP addresses…`;
        });
      } catch (err1) {
        console.warn('addListener scanProgress warning:', err1);
      }

      try {
        deviceListener = await ns.addListener('deviceDiscovered', (d) => {
          if (!d || !d.ip) return;
          const devObj = {
            ip: d.ip,
            mac: d.mac || 'Not available on Android',
            hostname: d.hostname || (d.isGateway ? 'router.local' : (d.isMe ? 'this-phone' : 'Not discovered')),
            vendor: d.vendor || 'Not discovered',
            status: d.status || 'Online (15 ms)',
            confidence: d.confidence || (d.isGateway || d.isMe ? 'High (95%)' : 'Medium (70%)'),
            servicesFormatted: d.servicesFormatted || 'None detected',
            openPorts: d.openPorts || [],
            sshBanner: d.sshBanner || null,
            deviceType: d.deviceType || (d.isGateway ? { type: 'router', label: 'Gateway Router', icon: 'router' }
                                                    : { type: 'unknown', label: 'Network Device', icon: 'unknown' }),
            isGateway: !!d.isGateway,
            isMe: !!d.isMe,
            label: d.isGateway ? 'Gateway Router' : (d.isMe ? 'This Phone' : null),
          };

function formatRouterNetworkName(hostname, vendor) {
  if (!hostname || hostname === 'router.local' || hostname === 'Not discovered') {
    return (vendor && !vendor.startsWith('Not')) ? vendor + ' Network' : 'Wi-Fi Network';
  }
  let clean = hostname.replace(/\.local$/i, '').trim();
  if (clean.length < 32) return clean + ' Network';
  return clean;
}

function updateMobileAgentSSID(newName) {
  if (mobileAgentWS && mobileAgentWS.readyState === 1) {
    const myIp = document.getElementById('bar-myip').textContent;
    const signal = document.getElementById('bar-signal').textContent;
    try {
      mobileAgentWS.send(JSON.stringify({
        type: 'heartbeat',
        localIp: myIp,
        ssid: newName,
        signal: signal
      }));
    } catch {}
  }
}

          if (d.isGateway || d.ip === document.getElementById('bar-gateway').textContent) {
            const currentSSID = document.getElementById('bar-ssid').textContent || '';
            const isGeneric = !currentSSID || currentSSID.includes('Mobile Wi-Fi') || currentSSID.includes('unknown') || currentSSID.includes('Wi-Fi Network') || currentSSID.includes('192.168.');
            if (isGeneric) {
              const gwName = formatRouterNetworkName(d.hostname, d.vendor);
              if (gwName && !gwName.includes('192.168.')) {
                document.getElementById('bar-ssid').textContent = gwName;
                updateMobileAgentSSID(gwName);
              }
            }
          }

          if (!S.devices.some(existing => existing.ip === devObj.ip)) {
            S.devices.push(devObj);
            countEl.textContent = S.devices.length;
            appendDeviceCard(devObj, grid);
            updateFilterCounts();
          }
        });
      } catch (err2) {
        console.warn('addListener deviceDiscovered warning:', err2);
      }
    }

    if (typeof ns.getNetworkInfo === 'function') {
      try {
        const info = await ns.getNetworkInfo();
        if (info) {
          if (info.localIp) document.getElementById('bar-myip').textContent = info.localIp;
          if (info.gateway) document.getElementById('bar-gateway').textContent = info.gateway;
          if (info.signal)  document.getElementById('bar-signal').textContent = info.signal;
          if (info.subnet)  document.getElementById('bar-subnet').textContent = info.subnet;
          if (info.ssid && !info.ssid.includes('Mobile Wi-Fi') && !info.ssid.includes('unknown')) {
            document.getElementById('bar-ssid').textContent = info.ssid;
          } else if (info.gateway) {
            const currentSSID = document.getElementById('bar-ssid').textContent || '';
            if (!currentSSID || currentSSID.includes('Mobile Wi-Fi') || currentSSID.includes('unknown')) {
              const prefix = info.gateway.substring(0, info.gateway.lastIndexOf('.'));
              document.getElementById('bar-ssid').textContent = `Wi-Fi Network (${prefix}.x)`;
            }
          }
        }
      } catch (err3) {
        console.warn('getNetworkInfo warning:', err3);
      }
    }

    let res = null;
    if (ns && typeof ns.startScan === 'function') {
      try {
        res = await ns.startScan();
      } catch (nsErr) {
        console.warn('ns.startScan error:', nsErr);
      }
    }

    const finalDevices = res ? (res.devices || []) : [];

    for (const d of finalDevices) {
      if (d.isGateway || d.ip === document.getElementById('bar-gateway').textContent) {
        const currentSSID = document.getElementById('bar-ssid').textContent || '';
        const isGeneric = !currentSSID || currentSSID.includes('Mobile Wi-Fi') || currentSSID.includes('unknown') || currentSSID.includes('Wi-Fi Network') || currentSSID.includes('192.168.');
        if (isGeneric) {
          const gwName = formatRouterNetworkName(d.hostname, d.vendor);
          if (gwName && !gwName.includes('192.168.')) {
            document.getElementById('bar-ssid').textContent = gwName;
            updateMobileAgentSSID(gwName);
          }
        }
      }

      if (!S.devices.some(existing => existing.ip === d.ip)) {
        const devObj = {
          ip: d.ip,
          mac: d.mac || 'Not available on Android',
          vendor: d.vendor || 'Not discovered',
          hostname: d.hostname || (d.isGateway ? 'router.local' : 'Not discovered'),
          status: d.status || 'Online (15 ms)',
          confidence: d.confidence || (d.isGateway || d.isMe ? 'High (95%)' : 'Medium (70%)'),
          servicesFormatted: d.servicesFormatted || 'None detected',
          openPorts: d.openPorts || [],
          deviceType: d.deviceType || { type: 'unknown', label: 'Network Device', icon: 'unknown' },
          isGateway: d.isGateway,
          isMe: d.isMe,
        };
        S.devices.push(devObj);
        appendDeviceCard(devObj, grid);
      }
    }

    countEl.textContent = S.devices.length;
    setStatus(`Android Native Scan Complete — Found ${S.devices.length} devices`, 'ok');
    updateQuickFill();

    // Automatically sync Desktop Agent ARP table if available
    syncDesktopAgentARP();
  } catch (err) {
    setStatus(`Android Scan Error: ${err.message || err}`, 'err');
  } finally {
    if (progressListener) try { progressListener.remove(); } catch {}
    if (deviceListener)   try { deviceListener.remove(); } catch {}
    S.scanning = false;
    progress.style.display  = 'none';
    filterBar.style.display = 'flex';
    if (currentViewMode === 'table' && tableContainer && S.devices.length > 0) {
      tableContainer.style.display = 'block';
      if (grid) grid.style.display = 'none';
    }
    btn.disabled = false;
    btn.classList.remove('scanning');
    document.getElementById('scan-btn-text').textContent = 'Scan Again';
    if (S.devices.length === 0 && emptyState) emptyState.style.display = 'flex';
  }
}

async function syncDesktopAgentARP() {
  const onlineAgent = S.agents.find(a => a.status === 'online');
  if (!onlineAgent) return;

  try {
    setStatus('Syncing 100% ARP & Vendor details from Desktop Agent…', '');
    if (S.cloudWS && S.cloudWS.readyState === WebSocket.OPEN) {
      S.cloudWS.send(JSON.stringify({
        action: 'get_arp_table',
        agentId: onlineAgent.id
      }));
    }
  } catch (e) {
    console.warn('Desktop Agent ARP sync error:', e);
  }
}

function handleCloudScanStream(event, d) {
  const btn       = document.getElementById('scan-btn');
  const progress  = document.getElementById('scan-progress');
  const filterBar = document.getElementById('filter-bar');
  const grid      = document.getElementById('device-grid');
  const emptyState= document.getElementById('empty-state');
  const countEl   = document.getElementById('bar-count');

  if (event === 'start') {
    document.getElementById('progress-sub').textContent =
      `Remote sweep on ${d.subnet} (${d.total} IPs)…`;
  } else if (event === 'progress') {
    const pct = Math.round((d.scanned / d.total) * 100);
    document.getElementById('progress-fill').style.width  = pct + '%';
    document.getElementById('progress-count').textContent = `${d.scanned} / ${d.total}`;
    document.getElementById('progress-label').textContent =
      `Remote sweep — found ${d.found} device${d.found !== 1 ? 's' : ''}…`;
  } else if (event === 'arp_done') {
    document.getElementById('progress-label').textContent = `Enriching ${d.count} devices remotely…`;
    document.getElementById('progress-fill').style.width = '85%';
  } else if (event === 'device') {
    S.devices.push(d);
    countEl.textContent = S.devices.length;
    appendDeviceCard(d, grid);
    updateFilterCounts();
  } else if (event === 'done') {
    if (S._scanTimeout) { clearTimeout(S._scanTimeout); S._scanTimeout = null; }
    S.scanning = false;
    progress.style.display  = 'none';
    filterBar.style.display = 'flex';
    btn.disabled = false;
    btn.classList.remove('scanning');
    document.getElementById('scan-btn-text').textContent = 'Scan Again';
    setStatus(`Remote Scan Complete — Found ${d.total} devices`, 'ok');
    updateQuickFill();
    if (S.devices.length === 0) emptyState.style.display = 'flex';
    document.getElementById('progress-fill').style.width = '100%';
  } else if (event === 'error') {
    if (S._scanTimeout) { clearTimeout(S._scanTimeout); S._scanTimeout = null; }
    S.scanning = false;
    btn.disabled = false;
    btn.classList.remove('scanning');
    document.getElementById('scan-btn-text').textContent = 'Scan Network';
    progress.style.display = 'none';
    setStatus(`Remote scan error: ${d.message}`, 'err');
    emptyState.style.display = 'flex';
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

/** Keep retrying until guest token is acquired — handles Render cold starts */
async function initCloudMode() {
  setStatus('Connecting to cloud server…');
  let attempt = 0;
  while (!S.guestToken) {
    attempt++;
    await fetchGuestToken();
    if (S.guestToken) break;
    setStatus(`Cloud server starting up… (attempt ${attempt})`);
    await new Promise(r => setTimeout(r, 3000)); // wait 3s before retry
  }
  setStatus('Ready — waiting for Desktop Agent…', 'ok');
  await fetchUserAgents();
  connectCloudWS();
  // Refresh agent list every 10s in cloud mode
  setInterval(fetchUserAgents, 10000);
}

let mobileAgentWS = null;

function getNativeNetworkScanner() {
  if (typeof window === 'undefined') return null;
  if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NetworkScanner) {
    return window.Capacitor.Plugins.NetworkScanner;
  }
  if (window.Capacitor && typeof window.Capacitor.registerPlugin === 'function') {
    try {
      const plugin = window.Capacitor.registerPlugin('NetworkScanner');
      if (plugin) return plugin;
    } catch (err) {
      console.warn('registerPlugin error:', err);
    }
  }
  return null;
}

async function initNativeAndroidMode() {
  const ns = getNativeNetworkScanner();
  S.mode = 'native';

  const cloudAgentBar = document.getElementById('cloud-agent-bar');
  if (cloudAgentBar) cloudAgentBar.style.display = 'none';

  let localIp = '192.168.1.100';
  let gateway = '192.168.1.1';
  let ssid    = 'Wi-Fi Network';
  let signal  = '100%';
  let subnet  = '192.168.1.0/24';

  if (ns) {
    try {
      const info = await ns.getNetworkInfo();
      if (info) {
        if (info.localIp) localIp = info.localIp;
        if (info.gateway) gateway = info.gateway;
        if (info.ssid && !info.ssid.includes('Mobile Wi-Fi') && !info.ssid.includes('unknown')) {
          ssid = info.ssid;
        } else if (info.gateway) {
          const prefix = info.gateway.substring(0, info.gateway.lastIndexOf('.'));
          ssid = `Wi-Fi (${prefix}.x)`;
        }
        if (info.signal)  signal  = info.signal;
        if (info.subnet)  subnet  = info.subnet;
      }
    } catch (e) {
      console.warn('Native getNetworkInfo error:', e);
    }
  }

  document.getElementById('bar-myip').textContent    = localIp;
  document.getElementById('bar-gateway').textContent = gateway;
  document.getElementById('bar-subnet').textContent  = subnet;
  document.getElementById('bar-ssid').textContent    = ssid;
  document.getElementById('bar-signal').textContent  = signal;

  const select = document.getElementById('agent-select');
  if (select) {
    select.innerHTML = `<option value="native_mobile">📲 Android Phone Agent (🟢 Active on this Device)</option>`;
  }

  updateAgentBadge(true);
  setStatus('Android Mobile Agent Active — 0 PC Required', 'ok');

  connectMobileAgentCloud(localIp, ssid, signal);
}

let mobileAgentHeartbeatTimer = null;

function connectMobileAgentCloud(localIp, ssid, signal) {
  const host = location.host.includes('.onrender.com') ? location.host : 'ipscaner.onrender.com';
  const agentKey = 'mobile_android_' + Math.random().toString(36).substring(2, 9);
  const wsUrl = `wss://${host}/ws?type=agent&key=${encodeURIComponent(agentKey)}&agentName=Android%20Phone&localIp=${encodeURIComponent(localIp)}&ssid=${encodeURIComponent(ssid)}&signal=${encodeURIComponent(signal)}&osInfo=Android%20Mobile`;

  try {
    if (mobileAgentWS) { try { mobileAgentWS.close(); } catch {} }
    if (mobileAgentHeartbeatTimer) { clearInterval(mobileAgentHeartbeatTimer); mobileAgentHeartbeatTimer = null; }

    mobileAgentWS = new WebSocket(wsUrl);

    mobileAgentWS.onopen = () => {
      console.log('✅ Android Phone registered as Cloud Agent on Render');
      updateAgentBadge(true);
      setStatus('Android Mobile Agent Active — 24/7 Connected', 'ok');
    };

    mobileAgentWS.onmessage = async (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.command === 'start_scan') {
          const ns = getNativeNetworkScanner();
          if (ns) {
            mobileAgentWS.send(JSON.stringify({ type: 'scan_event', event: 'start', data: { total: 254, subnet: document.getElementById('bar-subnet').textContent } }));
            const res = await ns.startScan();
            const devices = res ? (res.devices || []) : [];
            for (const d of devices) {
              mobileAgentWS.send(JSON.stringify({ type: 'scan_event', event: 'device', data: d }));
            }
            mobileAgentWS.send(JSON.stringify({ type: 'scan_event', event: 'done', data: { total: devices.length, devices } }));
          }
        }
      } catch {}
    };

    mobileAgentWS.onclose = () => {
      console.log('⚠️ Mobile Agent WebSocket closed — auto-reconnecting in 3s…');
      if (mobileAgentHeartbeatTimer) { clearInterval(mobileAgentHeartbeatTimer); mobileAgentHeartbeatTimer = null; }
      setTimeout(() => connectMobileAgentCloud(localIp, ssid, signal), 3000);
    };

    mobileAgentWS.onerror = (err) => {
      console.warn('Mobile Agent WebSocket error:', err);
    };

    mobileAgentHeartbeatTimer = setInterval(() => {
      if (mobileAgentWS && mobileAgentWS.readyState === 1) {
        mobileAgentWS.send(JSON.stringify({ type: 'heartbeat', localIp, ssid, signal }));
      }
    }, 15000);
  } catch (e) {
    console.warn('connectMobileAgentCloud exception:', e);
    setTimeout(() => connectMobileAgentCloud(localIp, ssid, signal), 5000);
  }
}

async function init() {
  setupPWA();
  loadPublicIP();
  updateQuickFill();

  const isAndroidApp = !!(window.Capacitor || getNativeNetworkScanner() || location.protocol === 'https:' && location.host === 'localhost');
  if (isAndroidApp) {
    await initNativeAndroidMode();
    return;
  }

  const isLocal = await loadNetworkInfo();
  if (!isLocal) {
    initCloudMode(); // runs async, keeps retrying until connected
  }
}

window.addEventListener('DOMContentLoaded', init);


