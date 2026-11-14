// Settings — per-user options and (for admins) branch + user management.
//   POST  /api/settings/password          change own password
//   PUT   /api/settings/language          save own interface language
//   GET   /api/settings/branch            own branch info
//   PUT   /api/settings/branch            admin: update branch name/phone/address
//   GET   /api/settings/users             admin: users of own branch
//   POST  /api/settings/users             admin: create a user in own branch
//   PATCH /api/settings/users/:id/active  admin: activate / deactivate a user
// Branch and identity ALWAYS come from the login token, never the request.
const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const pool = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired);

const LANGUAGES = ['ps', 'fa', 'en'];
const ROLES = ['admin', 'pharmacist', 'cashier'];

// --- Own password -----------------------------------------------------------
router.post('/password', async (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password) {
    return res.status(400).json({ status: 'error', message: 'Current and new password are required' });
  }
  if (String(new_password).length < 6) {
    return res.status(400).json({ status: 'error', message: 'New password is too short (minimum 6 characters)' });
  }
  try {
    const [rows] = await pool.query(
      'SELECT password_hash FROM users WHERE id = ? AND is_deleted = 0 LIMIT 1',
      [req.user.sub]
    );
    if (!rows[0]) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }
    const matches = await bcrypt.compare(String(current_password), rows[0].password_hash);
    if (!matches) {
      return res.status(401).json({ status: 'error', message: 'Current password is wrong' });
    }
    const hash = await bcrypt.hash(String(new_password), 12);
    await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.user.sub]);
    return res.json({ status: 'ok', message: 'Password changed' });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

// --- Own language -----------------------------------------------------------
router.put('/language', async (req, res) => {
  const { language } = req.body || {};
  if (!LANGUAGES.includes(language)) {
    return res.status(400).json({ status: 'error', message: 'Language must be one of: ps, fa, en' });
  }
  try {
    await pool.query('UPDATE users SET language = ? WHERE id = ?', [language, req.user.sub]);
    return res.json({ status: 'ok', language });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

// --- Branch info --------------------------------------------------------------
router.get('/branch', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, name, address, phone FROM branches WHERE id = ? AND is_deleted = 0 LIMIT 1',
      [req.user.branch_id]
    );
    if (!rows[0]) {
      return res.status(404).json({ status: 'error', message: 'Branch not found' });
    }
    return res.json({ status: 'ok', branch: rows[0] });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

router.put('/branch', requireRole('admin'), async (req, res) => {
  const { name, address, phone } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ status: 'error', message: 'Branch name is required' });
  }
  // Same system-wide rule: a phone number, when given, is exactly 10 digits.
  if (phone && !/^\d{10}$/.test(String(phone).trim())) {
    return res.status(400).json({ status: 'error', message: 'Phone number must be exactly 10 digits' });
  }
  try {
    await pool.query('UPDATE branches SET name = ?, address = ?, phone = ? WHERE id = ?', [
      String(name).trim(),
      address ? String(address).trim() : null,
      phone ? String(phone).trim() : null,
      req.user.branch_id,
    ]);
    return res.json({ status: 'ok', message: 'Branch updated' });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

// --- Users of the branch (admin) ---------------------------------------------
router.get('/users', requireRole('admin'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, full_name, username, role, language, is_active, created_at FROM users WHERE branch_id = ? AND is_deleted = 0 ORDER BY created_at',
      [req.user.branch_id]
    );
    return res.json({ status: 'ok', users: rows });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

router.post('/users', requireRole('admin'), async (req, res) => {
  const { full_name, username, password, role } = req.body || {};
  if (!full_name || !String(full_name).trim()) {
    return res.status(400).json({ status: 'error', message: 'Full name is required' });
  }
  if (!username || String(username).trim().length < 3) {
    return res.status(400).json({ status: 'error', message: 'Username is too short (minimum 3 characters)' });
  }
  if (!password || String(password).length < 6) {
    return res.status(400).json({ status: 'error', message: 'Password is too short (minimum 6 characters)' });
  }
  if (!ROLES.includes(role)) {
    return res.status(400).json({ status: 'error', message: 'Role must be one of: admin, pharmacist, cashier' });
  }
  try {
    const cleanUsername = String(username).trim();
    const [existing] = await pool.query('SELECT id FROM users WHERE username = ? LIMIT 1', [cleanUsername]);
    if (existing.length > 0) {
      return res.status(409).json({ status: 'error', message: `Username "${cleanUsername}" is already taken` });
    }
    const hash = await bcrypt.hash(String(password), 12);
    const id = uuidv4();
    await pool.query(
      'INSERT INTO users (id, branch_id, full_name, username, password_hash, role, language, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)',
      [id, req.user.branch_id, String(full_name).trim(), cleanUsername, hash, role, 'ps']
    );
    return res.status(201).json({
      status: 'ok',
      user: { id, full_name: String(full_name).trim(), username: cleanUsername, role },
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

router.patch('/users/:id/active', requireRole('admin'), async (req, res) => {
  const { is_active } = req.body || {};
  if (typeof is_active !== 'boolean') {
    return res.status(400).json({ status: 'error', message: 'is_active must be true or false' });
  }
  if (req.params.id === req.user.sub && !is_active) {
    return res.status(400).json({ status: 'error', message: 'You cannot deactivate your own account' });
  }
  try {
    const [result] = await pool.query(
      'UPDATE users SET is_active = ? WHERE id = ? AND branch_id = ? AND is_deleted = 0',
      [is_active ? 1 : 0, req.params.id, req.user.branch_id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ status: 'error', message: 'User not found in your branch' });
    }
    return res.json({ status: 'ok', message: is_active ? 'User activated' : 'User deactivated' });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

// DELETE /api/settings/users/:id — admin only. Soft delete: the user can no
// longer log in, but their past sales and purchases keep their name (the
// sales list joins users without filtering is_deleted). An admin cannot
// delete their own account, and the branch's last active admin is protected.
router.delete('/users/:id', requireRole('admin'), async (req, res) => {
  if (req.params.id === req.user.sub) {
    return res.status(400).json({ status: 'error', message: 'You cannot delete your own account' });
  }
  try {
    const [target] = await pool.query(
      'SELECT id, role, is_active FROM users WHERE id = ? AND branch_id = ? AND is_deleted = 0 LIMIT 1',
      [req.params.id, req.user.branch_id]
    );
    if (!target[0]) {
      return res.status(404).json({ status: 'error', message: 'User not found in your branch' });
    }
    if (target[0].role === 'admin' && target[0].is_active) {
      const [admins] = await pool.query(
        "SELECT COUNT(*) AS c FROM users WHERE branch_id = ? AND role = 'admin' AND is_active = 1 AND is_deleted = 0",
        [req.user.branch_id]
      );
      if (Number(admins[0].c) <= 1) {
        return res.status(400).json({ status: 'error', message: 'Cannot delete the last active admin' });
      }
    }
    await pool.query('UPDATE users SET is_deleted = 1, is_active = 0 WHERE id = ?', [req.params.id]);
    return res.json({ status: 'ok', message: 'User deleted' });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

// POST /api/settings/users/:id/reset-password — admin only. Passwords are
// stored as one-way bcrypt hashes, so nobody can read an existing password
// back; the admin sets a NEW one instead. Body: { password } (min 6 chars,
// same rule as creating a user). The user logs in with the new password;
// their old sessions keep working until they log out.
router.post('/users/:id/reset-password', requireRole('admin'), async (req, res) => {
  const { password } = req.body || {};
  if (!password || String(password).length < 6) {
    return res.status(400).json({ status: 'error', message: 'Password is too short (minimum 6 characters)' });
  }
  try {
    const [target] = await pool.query(
      'SELECT id FROM users WHERE id = ? AND branch_id = ? AND is_deleted = 0 LIMIT 1',
      [req.params.id, req.user.branch_id]
    );
    if (!target[0]) {
      return res.status(404).json({ status: 'error', message: 'User not found in your branch' });
    }
    const hash = await bcrypt.hash(String(password), 12);
    await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.params.id]);
    return res.json({ status: 'ok', message: 'Password reset' });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

module.exports = router;
