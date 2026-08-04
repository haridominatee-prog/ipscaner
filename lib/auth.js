/**
 * DOMScanner Authentication & Security Module
 * Handles JWT tokens, Password hashing, Rate limiting, and Middleware.
 */

const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcryptjs');
const crypto  = require('crypto');
const db      = require('./db');

const JWT_SECRET  = process.env.JWT_SECRET || 'domscanner-secret-key-change-in-production-2026';
const REFRESH_SECRET = process.env.REFRESH_SECRET || 'domscanner-refresh-key-change-in-production-2026';

const ACCESS_TOKEN_EXPIRE  = '1h';
const REFRESH_TOKEN_EXPIRE = '7d';

/** Hash plain text password */
async function hashPassword(password) {
  const salt = await bcrypt.genSalt(10);
  return await bcrypt.hash(password, salt);
}

/** Compare plain text password against hash */
async function comparePassword(password, hash) {
  return await bcrypt.compare(password, hash);
}

/** Generate access & refresh tokens */
async function generateTokens(userId, email) {
  const accessToken = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRE });
  const refreshToken = jwt.sign({ userId, email }, REFRESH_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRE });

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await db.saveRefreshToken(userId, refreshToken, expiresAt);

  return { accessToken, refreshToken };
}

/** Verify Access Token */
function verifyAccessToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

/** Verify Refresh Token */
function verifyRefreshToken(token) {
  try {
    return jwt.verify(token, REFRESH_SECRET);
  } catch {
    return null;
  }
}

/** Generate random agent pairing key */
function generateAgentKey() {
  return 'dom_agent_' + crypto.randomBytes(20).toString('hex');
}

/** Express Middleware: Require valid JWT auth header */
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized — Token missing' });
  }

  const token = authHeader.split(' ')[1];
  const decoded = verifyAccessToken(token);
  if (!decoded) {
    return res.status(401).json({ error: 'Unauthorized — Invalid or expired token' });
  }

  req.user = decoded;
  next();
}

/** Optional Auth Middleware (attaches user if present, proceeds regardless) */
function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    const decoded = verifyAccessToken(token);
    if (decoded) req.user = decoded;
  }
  next();
}

module.exports = {
  hashPassword,
  comparePassword,
  generateTokens,
  verifyAccessToken,
  verifyRefreshToken,
  generateAgentKey,
  requireAuth,
  optionalAuth,
  JWT_SECRET,
};
