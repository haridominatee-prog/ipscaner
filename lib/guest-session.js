/**
 * DOMScanner Guest Session Manager
 * Generates a shared guest JWT without DB dependency.
 * Works even when sqlite3 fails on Render.
 */

const jwt  = require('jsonwebtoken');
const auth = require('./auth');

const GUEST_USER_ID = 1;
const GUEST_EMAIL   = 'guest@domscanner.local';

let guestToken  = null;
let guestUserId = GUEST_USER_ID;

/**
 * Generate a long-lived guest JWT immediately — no DB required.
 * Called once at server startup.
 */
async function initGuestSession() {
  try {
    guestToken = jwt.sign(
      { userId: GUEST_USER_ID, email: GUEST_EMAIL },
      auth.JWT_SECRET,
      { expiresIn: '30d' }
    );
    console.log('🔑 Guest session token generated (30d, no-DB mode)');
    return { userId: GUEST_USER_ID, token: guestToken };
  } catch (err) {
    console.error('⚠️  Guest session error:', err.message);
    return null;
  }
}

function getGuestToken()  { return guestToken; }
function getGuestUserId() { return guestUserId; }

module.exports = { initGuestSession, getGuestToken, getGuestUserId };
