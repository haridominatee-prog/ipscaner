/**
 * DOMScanner Guest Session Manager
 * Creates a shared guest user + JWT token so the app works
 * without any login/signup, just like the local version.
 */

const jwt    = require('jsonwebtoken');
const db     = require('./db');
const auth   = require('./auth');

const GUEST_EMAIL    = 'guest@domscanner.local';
const GUEST_PASSWORD = 'domscanner-guest-2026';

let guestUserId  = null;
let guestToken   = null;

/**
 * Ensure the shared guest user exists, then generate a long-lived JWT.
 * Called once at server startup.
 */
async function initGuestSession() {
  // Wait a moment for DB to initialise tables
  await new Promise(r => setTimeout(r, 800));

  try {
    let user = await db.getUserByEmail(GUEST_EMAIL);
    if (!user) {
      const hash = await auth.hashPassword(GUEST_PASSWORD);
      user = await db.createUser(GUEST_EMAIL, hash);
      await db.verifyUserEmail(user.id);
      console.log('👤 Guest user created (ID:', user.id + ')');
    }

    guestUserId = user.id;

    // Issue a 30-day access token — no need to refresh constantly
    guestToken = jwt.sign(
      { userId: user.id, email: GUEST_EMAIL },
      auth.JWT_SECRET,
      { expiresIn: '30d' }
    );

    console.log('🔑 Guest session token generated (30d)');
    return { userId: guestUserId, token: guestToken };
  } catch (err) {
    console.error('⚠️  Guest session init error:', err.message);
    return null;
  }
}

function getGuestToken()  { return guestToken; }
function getGuestUserId() { return guestUserId; }

module.exports = { initGuestSession, getGuestToken, getGuestUserId };
