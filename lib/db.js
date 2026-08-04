/**
 * DOMScanner Database Layer (SQLite)
 * Manages users, agents, scan history, refresh tokens, email verification, and 6-digit pairing codes.
 */

const path    = require('path');
const fs      = require('fs');

const DB_PATH = path.join(__dirname, '..', 'domscanner.db');

let db = null;

// Initialize SQLite Database
function initDB() {
  let sqlite3;
  try {
    sqlite3 = require('sqlite3').verbose();
  } catch (err) {
    console.error('Failed to load sqlite3 package:', err.message);
    return;
  }

  const dbFile = (process.env.NODE_ENV === 'production' || process.env.RENDER)
    ? path.join('/tmp', 'domscanner.db')
    : DB_PATH;

  db = new sqlite3.Database(dbFile, (err) => {
    if (err) {
      console.warn('Falling back to in-memory SQLite DB:', err.message);
      db = new sqlite3.Database(':memory:');
    } else {
      console.log('📦 Connected to DOMScanner SQLite database at', dbFile);
    }
  });

  try {
    db.run('PRAGMA foreign_keys = ON;');
  } catch {}

  // Create Tables
  db.serialize(() => {
    // Users table
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        email_verified INTEGER DEFAULT 0,
        verification_token TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Agents table
    db.run(`
      CREATE TABLE IF NOT EXISTS agents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        agent_name TEXT NOT NULL,
        agent_key TEXT UNIQUE NOT NULL,
        status TEXT DEFAULT 'offline',
        last_heartbeat DATETIME,
        os_info TEXT,
        local_ip TEXT,
        version TEXT DEFAULT '1.0.0',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Scan History table
    db.run(`
      CREATE TABLE IF NOT EXISTS scan_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        agent_id INTEGER,
        agent_name TEXT,
        subnet TEXT,
        devices_found_count INTEGER DEFAULT 0,
        devices_json TEXT,
        status TEXT DEFAULT 'completed',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Refresh Tokens table
    db.run(`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        token TEXT UNIQUE NOT NULL,
        expires_at DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // 6-Digit Pairing Codes table
    db.run(`
      CREATE TABLE IF NOT EXISTS pairing_codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        user_id INTEGER NOT NULL,
        expires_at DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
  });
}

// Helper wrapper for async query execution
function queryRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function queryGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function queryAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

// ── Database Methods ──────────────────────────────────────────────────────────

async function createUser(email, passwordHash) {
  const verToken = 'ver_' + Math.random().toString(36).substring(2, 15);
  const res = await queryRun(
    'INSERT INTO users (email, password_hash, email_verified, verification_token) VALUES (?, ?, 0, ?)',
    [email.toLowerCase().trim(), passwordHash, verToken]
  );
  return { id: res.id, email: email.toLowerCase().trim(), email_verified: 0, verification_token: verToken };
}

async function getUserByEmail(email) {
  return await queryGet('SELECT * FROM users WHERE email = ?', [email.toLowerCase().trim()]);
}

async function getUserById(id) {
  return await queryGet('SELECT id, email, email_verified, created_at FROM users WHERE id = ?', [id]);
}

async function verifyUserEmail(userId) {
  await queryRun('UPDATE users SET email_verified = 1 WHERE id = ?', [userId]);
}

// ── 6-Digit Short Pairing Code Methods ──

async function createPairingCode(userId) {
  // Generate random 6-digit number e.g. "849204"
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  // Valid for 15 minutes
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  // Delete previous code for user if exists
  await queryRun('DELETE FROM pairing_codes WHERE user_id = ?', [userId]);
  await queryRun('INSERT INTO pairing_codes (code, user_id, expires_at) VALUES (?, ?, ?)', [code, userId, expiresAt]);

  return { code, expiresAt };
}

async function validatePairingCode(code) {
  const cleanCode = (code || '').replace(/\D/g, ''); // strip dashes/spaces
  const row = await queryGet('SELECT * FROM pairing_codes WHERE code = ?', [cleanCode]);
  if (!row) return null;

  if (new Date(row.expires_at) < new Date()) {
    await queryRun('DELETE FROM pairing_codes WHERE id = ?', [row.id]);
    return null;
  }

  return row;
}

// ── Agent Methods ──

async function createAgent(userId, agentName, agentKey) {
  const res = await queryRun(
    'INSERT INTO agents (user_id, agent_name, agent_key, status) VALUES (?, ?, ?, "offline")',
    [userId, agentName, agentKey]
  );
  return await queryGet('SELECT * FROM agents WHERE id = ?', [res.id]);
}

async function getAgentByKey(agentKey) {
  return await queryGet('SELECT * FROM agents WHERE agent_key = ?', [agentKey]);
}

async function getAgentById(id) {
  return await queryGet('SELECT * FROM agents WHERE id = ?', [id]);
}

async function getAgentsByUserId(userId) {
  return await queryAll('SELECT * FROM agents WHERE user_id = ? ORDER BY created_at DESC', [userId]);
}

async function updateAgentStatus(agentId, status, osInfo = null, localIp = null, version = null) {
  const now = new Date().toISOString();
  await queryRun(
    `UPDATE agents SET status = ?, last_heartbeat = ?,
      os_info = COALESCE(?, os_info),
      local_ip = COALESCE(?, local_ip),
      version = COALESCE(?, version)
     WHERE id = ?`,
    [status, now, osInfo, localIp, version, agentId]
  );
}

async function deleteAgent(agentId, userId) {
  return await queryRun('DELETE FROM agents WHERE id = ? AND user_id = ?', [agentId, userId]);
}

async function saveScanHistory(userId, agentId, agentName, subnet, devices) {
  const devicesJson = JSON.stringify(devices || []);
  const count = (devices || []).length;
  const res = await queryRun(
    `INSERT INTO scan_history (user_id, agent_id, agent_name, subnet, devices_found_count, devices_json, status)
     VALUES (?, ?, ?, ?, ?, ?, 'completed')`,
    [userId, agentId, agentName || 'Local Engine', subnet || 'Local Subnet', count, devicesJson]
  );
  return res.id;
}

async function getScanHistoryByUserId(userId, limit = 50) {
  const rows = await queryAll(
    'SELECT * FROM scan_history WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
    [userId, limit]
  );
  return rows.map(r => ({
    ...r,
    devices: r.devices_json ? JSON.parse(r.devices_json) : []
  }));
}

async function getScanById(scanId, userId) {
  const r = await queryGet('SELECT * FROM scan_history WHERE id = ? AND user_id = ?', [scanId, userId]);
  if (!r) return null;
  return {
    ...r,
    devices: r.devices_json ? JSON.parse(r.devices_json) : []
  };
}

async function saveRefreshToken(userId, token, expiresAt) {
  await queryRun(
    'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
    [userId, token, expiresAt]
  );
}

async function getRefreshToken(token) {
  return await queryGet('SELECT * FROM refresh_tokens WHERE token = ?', [token]);
}

async function deleteRefreshToken(token) {
  await queryRun('DELETE FROM refresh_tokens WHERE token = ?', [token]);
}

// Auto-initialize
initDB();

module.exports = {
  createUser,
  getUserByEmail,
  getUserById,
  verifyUserEmail,
  createPairingCode,
  validatePairingCode,
  createAgent,
  getAgentByKey,
  getAgentById,
  getAgentsByUserId,
  updateAgentStatus,
  deleteAgent,
  saveScanHistory,
  getScanHistoryByUserId,
  getScanById,
  saveRefreshToken,
  getRefreshToken,
  deleteRefreshToken,
};
