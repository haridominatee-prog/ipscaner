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
  mode:         'cloud',     // Option 2 ONLY
  agents:       [],
  selectedAgentId: null,
  cloudWS:      null,
};

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

// ── DEVICE CARD RENDERING ─────────────────────────────────────────────────────
function appendDeviceCard(d, container) {
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
function updateQuickFill() {
  const wrap = document.getElementById('ps-quick-fill');
  if (!wrap) return;

  if (S.devices.length === 0) {
    wrap.innerHTML = '<span style="font-size:12px;color:var(--text-3);">Run a Network Scan to see devices here</span>';
    return;
  }

  wrap.innerHTML = S.devices.map(d => `
    <button class="chip-ip" onclick="psQuickFill('${d.ip}')">${d.ip}</button>
  `).join('');
}

function psQuickFill(ip) {
  document.getElementById('ps-target').value = ip;
}

function toggleCustomPorts(val) {
  const customWrap = document.getElementById('ps-custom-wrap');
  customWrap.style.display = val === 'custom' ? 'block' : 'none';
}

async function startPortScan() {
  const target = document.getElementById('ps-target').value.trim();
  const profile = document.getElementById('ps-profile').value;
  const customStr = document.getElementById('ps-custom').value.trim();

  if (!target) {
    alert('Please enter a target IP address.');
    return;
  }

  const btn     = document.getElementById('ps-start-btn');
  const results = document.getElementById('ps-results');
  btn.disabled  = true;
  btn.innerHTML = `<div class="ps-spinner sm"></div> Scanning…`;
  results.style.display = 'none';

  try {
    const res = await fetch('/api/portscan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip: target, profile, customPorts: customStr }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Port scan failed');

    renderPortScanResults(data);
  } catch (err) {
    alert(`Port scan error: ${err.message}`);
  } finally {
    btn.disabled  = false;
    btn.innerHTML = `
      <svg viewBox="0 0 20 20" fill="currentColor">
        <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd"/>
      </svg> Run Port Scan`;
  }
}

function renderPortScanResults(d) {
  const container = document.getElementById('ps-results');
  const grid      = document.getElementById('ps-ports-grid');

  document.getElementById('ps-res-target').textContent  = d.ip;
  document.getElementById('ps-res-scanned').textContent = d.scanned;
  document.getElementById('ps-res-open').textContent    = d.open.length;

  grid.innerHTML = d.results.map(r => `
    <div class="ps-port-card ${r.open ? 'open' : 'closed'}">
      <div class="ps-port-num mono">${r.port}</div>
      <div class="ps-port-service">${escHtml(r.service)}</div>
      <span class="ps-port-status">${r.open ? 'OPEN' : 'CLOSED'}</span>
    </div>
  `).join('');

  container.style.display = 'block';
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
  try {
    const res = await fetch('/api/agents', {
      headers: { Authorization: `Bearer guest_token` }
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
}

function updateAgentBadge(isOnline) {
  const badge = document.getElementById('agent-status-badge');
  if (!badge) return;
  badge.className = `agent-status-badge ${isOnline ? 'online' : 'offline'}`;
  badge.textContent = isOnline ? '● Online' : '● Offline';
}

function connectCloudWS() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${location.host}/ws?type=client`;

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
}

function startCloudScan() {
  if (!S.selectedAgentId) {
    openAgentDownloadModal();
    return;
  }

  const selectedAgent = S.agents.find(a => a.id === S.selectedAgentId);
  if (!selectedAgent || selectedAgent.status !== 'online') {
    alert('The selected desktop agent is offline. Launch the agent on that machine first.');
    return;
  }

  if (!S.cloudWS || S.cloudWS.readyState !== WebSocket.OPEN) {
    connectCloudWS();
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
  setStatus(`Remote Scanning via ${selectedAgent.agent_name}…`, '');

  S.cloudWS.send(JSON.stringify({
    action: 'start_scan',
    agentId: S.selectedAgentId,
  }));
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
async function init() {
  setupPWA();
  loadPublicIP();
  updateQuickFill();

  const isLocal = await loadNetworkInfo();
  if (!isLocal) {
    setStatus('Ready (Cloud Agent Mode)');
    fetchUserAgents();
    connectCloudWS();
  }
}

window.addEventListener('DOMContentLoaded', init);

