/**
 * DOMScanner Cloud REST API Routes
 * Handles user auth, email verification, 6-digit pairing codes, agent pairing, and downloads.
 */

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const db      = require('./db');
const auth    = require('./auth');

const router = express.Router();

// ── Authentication ─────────────────────────────────────────────────────────────

/** POST /api/auth/register */
router.post('/auth/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password || password.length < 6) {
      return res.status(400).json({ error: 'Valid email and password (min 6 chars) required' });
    }

    const existing = await db.getUserByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'User with this email already exists' });
    }

    const passwordHash = await auth.hashPassword(password);
    const user = await db.createUser(email, passwordHash);

    const tokens = await auth.generateTokens(user.id, user.email);

    res.status(201).json({
      message: 'Account created successfully',
      user: { id: user.id, email: user.email, email_verified: user.email_verified },
      ...tokens,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/auth/verify-email */
router.post('/auth/verify-email', auth.requireAuth, async (req, res) => {
  try {
    await db.verifyUserEmail(req.user.userId);
    res.json({ message: 'Email address verified successfully!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/auth/login */
router.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const user = await db.getUserByEmail(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const match = await auth.comparePassword(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const tokens = await auth.generateTokens(user.id, user.email);

    res.json({
      message: 'Login successful',
      user: { id: user.id, email: user.email, email_verified: user.email_verified },
      ...tokens,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/auth/refresh */
router.post('/auth/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: 'Refresh token required' });

    const decoded = auth.verifyRefreshToken(refreshToken);
    if (!decoded) return res.status(401).json({ error: 'Invalid or expired refresh token' });

    const stored = await db.getRefreshToken(refreshToken);
    if (!stored) return res.status(401).json({ error: 'Token revoked or not found' });

    const tokens = await auth.generateTokens(decoded.userId, decoded.email);
    await db.deleteRefreshToken(refreshToken);

    res.json(tokens);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/auth/logout */
router.post('/auth/logout', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) await db.deleteRefreshToken(refreshToken);
    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/auth/me */
router.get('/auth/me', auth.requireAuth, async (req, res) => {
  try {
    const user = await db.getUserById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 6-Digit Short Pairing Code API ──────────────────────────────────────────

/** POST /api/auth/pairing-code — Generate 6-digit code for Desktop Agent pairing */
router.post('/auth/pairing-code', auth.requireAuth, async (req, res) => {
  try {
    const pairing = await db.createPairingCode(req.user.userId);
    res.json({
      pairingCode: pairing.code,
      expiresAt: pairing.expiresAt,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Agent Auto-Pairing Endpoint (Zero-Touch 1-Click Connect) ─────────────────

const guestSession = require('./guest-session');

/** POST /api/agent/auto-pair — Zero-touch instant auto-connect without login or code */
router.post('/agent/auto-pair', async (req, res) => {
  try {
    const { name } = req.body;
    const agentName = (name || 'Desktop Agent').trim();

    // Always pair to the shared guest user
    const guestUserId = guestSession.getGuestUserId() || 1;

    // Clean up old agents with same name to prevent stale duplicates
    const existing = await db.getAgentsByUserId(guestUserId);
    for (const a of existing) {
      if (a.agent_name === agentName) {
        await db.deleteAgent(a.id, guestUserId);
      }
    }

    const agentKey = auth.generateAgentKey();
    const agent = await db.createAgent(guestUserId, agentName, agentKey);

    res.json({
      message: 'Agent auto-paired successfully!',
      agentKey: agent.agent_key,
      agentId: agent.id,
      agentName: agent.agent_name,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── Agent Pairing Endpoint (for Agent CLI / Executable) ──────────────────────

/** POST /api/agent/pair — Pairs Desktop Agent via Email/Password OR 6-Digit Code */
router.post('/agent/pair', async (req, res) => {
  try {
    const { email, password, pairingCode, name } = req.body;
    let userId = null;

    if (pairingCode) {
      const row = await db.validatePairingCode(pairingCode);
      if (!row) {
        return res.status(400).json({ error: 'Invalid or expired 6-digit pairing code' });
      }
      userId = row.user_id;
    } else if (email && password) {
      const user = await db.getUserByEmail(email);
      if (!user) return res.status(401).json({ error: 'Invalid email or password' });

      const match = await auth.comparePassword(password, user.password_hash);
      if (!match) return res.status(401).json({ error: 'Invalid email or password' });

      userId = user.id;
    } else {
      return res.status(400).json({ error: 'Either email/password or 6-digit pairing code is required' });
    }

    const agentName = (name || 'Desktop Agent').trim();
    const agentKey  = auth.generateAgentKey();

    const agent = await db.createAgent(userId, agentName, agentKey);

    res.json({
      message: 'Agent paired successfully!',
      agentKey: agent.agent_key,
      agentId: agent.id,
      agentName: agent.agent_name,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Agent Management ──────────────────────────────────────────────────────────

/** GET /api/agents */
router.get('/agents', auth.requireAuth, async (req, res) => {
  try {
    let agents = await db.getAgentsByUserId(req.user.userId);
    agents = (agents || []).filter(a => a.status === 'online');
    res.json({ agents });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /api/agents/:id */
router.delete('/agents/:id', auth.requireAuth, async (req, res) => {
  try {
    const agentId = parseInt(req.params.id);
    await db.deleteAgent(agentId, req.user.userId);
    res.json({ message: 'Agent unlinked' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Scan History ──────────────────────────────────────────────────────────────

/** GET /api/scan/history */
router.get('/scan/history', auth.requireAuth, async (req, res) => {
  try {
    const history = await db.getScanHistoryByUserId(req.user.userId);
    res.json({ history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/scan/history/:id */
router.get('/scan/history/:id', auth.requireAuth, async (req, res) => {
  try {
    const scanId = parseInt(req.params.id);
    const scan = await db.getScanById(scanId, req.user.userId);
    if (!scan) return res.status(404).json({ error: 'Scan record not found' });
    res.json({ scan });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Downloads Endpoint ────────────────────────────────────────────────────────

/** GET /api/downloads/agent/:os */
router.get('/downloads/agent/:os', (req, res) => {
  const osType = req.params.os.toLowerCase();
  const agentDir = path.join(__dirname, '..', 'agent');

  if (osType === 'ps1') {
    const psFile = path.join(agentDir, 'dom-agent-launcher.ps1');
    if (fs.existsSync(psFile)) {
      return res.download(psFile, 'dom-agent-launcher.ps1');
    }
  }

  if (osType === 'apk' || osType === 'android') {
    const apkFile = path.join(agentDir, 'DOMScanner.apk');
    if (fs.existsSync(apkFile)) {
      res.setHeader('Content-Type', 'application/vnd.android.package-archive');
      return res.download(apkFile, 'DOMScanner.apk');
    }
    return res.status(200).send(`
      <!DOCTYPE html>
      <html>
      <head><title>DOMScanner APK Download</title><meta name="viewport" content="width=device-width, initial-scale=1"></head>
      <body style="font-family:sans-serif;background:#0f172a;color:#f8fafc;padding:2rem;text-align:center;">
        <h2>📲 DOMScanner Android App</h2>
        <p>To install DOMScanner directly on your phone:</p>
        <p style="background:#1e293b;padding:1rem;border-radius:8px;display:inline-block;">
          1. Open <a href="/" style="color:#38bdf8;">DOMScanner Web Dashboard</a><br>
          2. Tap Chrome Menu (⋮) &rarr; <b>"Add to Home Screen"</b>
        </p>
      </body>
      </html>
    `);
  }

  if (osType === 'windows' || osType === 'win' || osType === 'cmd') {
    const cmdFile = path.join(agentDir, 'DOMScanner-Agent-Windows.cmd');
    if (fs.existsSync(cmdFile)) {
      return res.download(cmdFile, 'DOMScanner-Agent-Windows.cmd');
    }
  }

  // Fallback serve dom-agent.js script package
  const scriptFile = path.join(agentDir, 'dom-agent.js');
  res.download(scriptFile, `domscanner-agent-${osType}.js`);
});

module.exports = router;
