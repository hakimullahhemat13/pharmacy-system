// Auth routes — login + current user
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const pool = require('../db');
const { authRequired } = require('../middleware/auth');
const { auditLog } = require('../audit');

const router = express.Router();

// In-memory login rate limiter (no new dependency): at most 10 FAILED
// login attempts per IP per 15 minutes, then 429. Successful logins
// do not count, so normal use on a shared computer is never locked out.
// Entries older than the window are dropped when checked, so the map
// cannot grow without bound.
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILED = 10;
const loginAttempts = new Map(); // ip -> { count, firstAt }

function loginRateLimit(req, res, next) {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (entry && now - entry.firstAt > LOGIN_WINDOW_MS) loginAttempts.delete(ip);
  const current = loginAttempts.get(ip);
  if (current && current.count >= LOGIN_MAX_FAILED) {
    return res.status(429).json({ status: 'error', message: 'Too many login attempts. Try again later.' });
  }
  return next();
}

function recordFailedLogin(req) {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now - entry.firstAt > LOGIN_WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, firstAt: now });
  } else {
    entry.count += 1;
  }
}

// A fixed dummy hash, compared even when no user row exists, so an
// unknown username costs the same bcrypt work as a known one and the
// timing no longer reveals whether the username exists.
const DUMMY_PASSWORD_HASH = '$2a$10$m6a0Shv1.go93SsXcLEqPeEsGYcBfQtfU26Idj.PAOkDBxDMBoVbe';

// POST /api/auth/login  { username, password }
router.post('/login', loginRateLimit, async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ status: 'error', message: 'Username and password are required' });
  }
  try {
    const [rows] = await pool.query(
      'SELECT id, branch_id, full_name, username, password_hash, role, language, is_active, token_version FROM users WHERE username = ? AND is_deleted = 0 LIMIT 1',
      [String(username).trim()]
    );
    const user = rows[0];
    // Always pay one bcrypt comparison — against the dummy hash when
    // there is no user — so the timing is the same either way.
    const passwordOk = user
      ? await bcrypt.compare(String(password), user.password_hash)
      : await bcrypt.compare(String(password), DUMMY_PASSWORD_HASH);
    // Same message for "no such user" and "wrong password" — do not reveal which one failed
    if (!user || !passwordOk) {
      recordFailedLogin(req);
      auditLog(null, 'user.login_failed', 'users', user ? user.id : null, {
        summary: `Failed login for username: ${String(username).trim()}`,
        username: String(username).trim(),
      });
      return res.status(401).json({ status: 'error', message: 'Invalid username or password' });
    }
    if (!user.is_active) {
      auditLog(
        { user: { sub: user.id, branch_id: user.branch_id } },
        'user.login_failed',
        'users',
        user.id,
        { summary: `Login refused, account disabled: ${user.username}`, username: user.username }
      );
      return res.status(403).json({ status: 'error', message: 'This user is disabled' });
    }
    // No expiry, by design: on this local, single-owner installation
    // the session stays valid until the user logs out (owner's choice,
    // 2026-11-08) — do NOT add expiresIn. Revocation is by other
    // means: token_version is bumped on every password change / admin
    // reset (old tokens are rejected in authRequired), and a
    // deactivated or deleted user loses access at once.
    const token = jwt.sign(
      {
        sub: user.id,
        username: user.username,
        role: user.role,
        branch_id: user.branch_id,
        token_version: user.token_version ?? 0,
      },
      process.env.JWT_SECRET
    );
    auditLog(
      { user: { sub: user.id, branch_id: user.branch_id } },
      'user.login',
      'users',
      user.id,
      { summary: `Logged in: ${user.username}`, username: user.username }
    );
    return res.json({
      status: 'ok',
      token,
      user: {
        id: user.id,
        full_name: user.full_name,
        username: user.username,
        role: user.role,
        branch_id: user.branch_id,
        language: user.language,
      },
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

// GET /api/auth/me  (requires login)
router.get('/me', authRequired, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, branch_id, full_name, username, role, language FROM users WHERE id = ? AND is_deleted = 0 LIMIT 1',
      [req.user.sub]
    );
    if (!rows[0]) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }
    return res.json({ status: 'ok', user: rows[0] });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

module.exports = router;
