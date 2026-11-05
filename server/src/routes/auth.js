// Auth routes — login + current user
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const pool = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/login  { username, password }
router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ status: 'error', message: 'Username and password are required' });
  }
  try {
    const [rows] = await pool.query(
      'SELECT id, branch_id, full_name, username, password_hash, role, language, is_active FROM users WHERE username = ? AND is_deleted = 0 LIMIT 1',
      [String(username).trim()]
    );
    const user = rows[0];
    // Same message for "no such user" and "wrong password" — do not reveal which one failed
    if (!user || !(await bcrypt.compare(String(password), user.password_hash))) {
      return res.status(401).json({ status: 'error', message: 'Invalid username or password' });
    }
    if (!user.is_active) {
      return res.status(403).json({ status: 'error', message: 'This user is disabled' });
    }
    const token = jwt.sign(
      { sub: user.id, username: user.username, role: user.role, branch_id: user.branch_id },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
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
