// Settings — per-user options and (for admins) branch + user management.
//   POST  /api/settings/password          change own password
//   PUT   /api/settings/language          save own interface language
//   GET   /api/settings/branch            own branch info
//   PUT   /api/settings/branch            admin: update branch name/phone/address
//   GET   /api/settings/users             admin: Main admin sees all branches, any other admin only their own
//   POST  /api/settings/users             admin: create a user (branch_id optional, defaults to own branch; another branch only for the Main admin)
//   PATCH /api/settings/users/:id/active  admin: activate / deactivate a user (own branch, or any branch for the Main admin)
// Branch and identity ALWAYS come from the login token, never the request.
const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const pool = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');
const { auditLog } = require('../audit');
const { getMainBranchId } = require('../mainBranch');

const router = express.Router();
router.use(authRequired);

const LANGUAGES = ['ps', 'fa', 'en'];
const ROLES = ['admin', 'pharmacist', 'cashier'];

// Whether the caller is the Main Branch admin — the only user who
// administers across branches. Every other admin sees and manages
// their own branch only: a child branch never sees the Main Branch's
// users or audit entries, and never touches them.
async function isMainAdminReq(req) {
  if (req.user.role !== 'admin') return false;
  return req.user.branch_id === (await getMainBranchId(pool));
}

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
    auditLog(req, 'user.password_changed', 'users', req.user.sub, { summary: 'Own password changed' });
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
    auditLog(req, 'branch.updated', 'branches', req.user.branch_id, {
      summary: `Branch details updated: ${String(name).trim()}`,
    });
    return res.json({ status: 'ok', message: 'Branch updated' });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

// --- Users (admin) ------------------------------------------------------------
// The Main Branch admin manages users of ALL branches; any other admin
// sees and manages only their own branch's users. With one branch this
// is exactly the old list for everyone.
router.get('/users', requireRole('admin'), async (req, res) => {
  try {
    const mainAdmin = await isMainAdminReq(req);
    const [rows] = mainAdmin
      ? await pool.query(
          `SELECT u.id, u.branch_id, u.full_name, u.username, u.role, u.language,
                  u.is_active, u.created_at, b.name AS branch_name
           FROM users u
           LEFT JOIN branches b ON b.id = u.branch_id
           WHERE u.is_deleted = 0
           ORDER BY b.created_at, u.created_at`
        )
      : await pool.query(
          `SELECT u.id, u.branch_id, u.full_name, u.username, u.role, u.language,
                  u.is_active, u.created_at, b.name AS branch_name
           FROM users u
           LEFT JOIN branches b ON b.id = u.branch_id
           WHERE u.is_deleted = 0 AND u.branch_id = ?
           ORDER BY u.created_at`,
          [req.user.branch_id]
        );
    return res.json({ status: 'ok', users: rows });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

router.post('/users', requireRole('admin'), async (req, res) => {
  const { full_name, username, password, role, branch_id } = req.body || {};
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
    // The new user's branch: an explicit branch_id when given (it must
    // exist and be active), otherwise the admin's own branch. Placing a
    // user in ANOTHER branch is the Main Branch admin's alone.
    let targetBranch = req.user.branch_id;
    let branchName = null;
    if (branch_id) {
      const [bRows] = await pool.query(
        'SELECT id, name FROM branches WHERE id = ? AND is_deleted = 0 LIMIT 1',
        [branch_id]
      );
      if (!bRows[0]) {
        return res.status(400).json({ status: 'error', message: 'Branch not found' });
      }
      if (bRows[0].id !== req.user.branch_id && !(await isMainAdminReq(req))) {
        return res.status(403).json({ status: 'error', message: 'Only the Main Branch admin can create users in another branch' });
      }
      targetBranch = bRows[0].id;
      branchName = bRows[0].name;
    }
    const hash = await bcrypt.hash(String(password), 12);
    const id = uuidv4();
    await pool.query(
      'INSERT INTO users (id, branch_id, full_name, username, password_hash, role, language, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)',
      [id, targetBranch, String(full_name).trim(), cleanUsername, hash, role, 'ps']
    );
    auditLog(req, 'user.created', 'users', id, {
      summary: `User created: ${cleanUsername} (${role})${branchName ? ` — ${branchName}` : ''}`,
      username: cleanUsername, role,
    });
    return res.status(201).json({
      status: 'ok',
      user: { id, branch_id: targetBranch, full_name: String(full_name).trim(), username: cleanUsername, role },
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
    const [target] = await pool.query(
      'SELECT username, branch_id FROM users WHERE id = ? AND is_deleted = 0 LIMIT 1',
      [req.params.id]
    );
    if (!target[0]) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }
    if (target[0].branch_id !== req.user.branch_id && !(await isMainAdminReq(req))) {
      return res.status(403).json({ status: 'error', message: 'Only the Main Branch admin can change users of another branch' });
    }
    const [result] = await pool.query(
      'UPDATE users SET is_active = ? WHERE id = ? AND is_deleted = 0',
      [is_active ? 1 : 0, req.params.id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }
    auditLog(req, is_active ? 'user.activated' : 'user.deactivated', 'users', req.params.id, {
      summary: `User ${target[0] ? target[0].username : req.params.id} ${is_active ? 'activated' : 'deactivated'}`,
    });
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
      'SELECT id, branch_id, username, role, is_active FROM users WHERE id = ? AND is_deleted = 0 LIMIT 1',
      [req.params.id]
    );
    if (!target[0]) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }
    if (target[0].branch_id !== req.user.branch_id && !(await isMainAdminReq(req))) {
      return res.status(403).json({ status: 'error', message: 'Only the Main Branch admin can delete users of another branch' });
    }
    if (target[0].role === 'admin' && target[0].is_active) {
      const [admins] = await pool.query(
        "SELECT COUNT(*) AS c FROM users WHERE branch_id = ? AND role = 'admin' AND is_active = 1 AND is_deleted = 0",
        [target[0].branch_id]
      );
      if (Number(admins[0].c) <= 1) {
        return res.status(400).json({ status: 'error', message: 'Cannot delete the last active admin' });
      }
    }
    await pool.query('UPDATE users SET is_deleted = 1, is_active = 0 WHERE id = ?', [req.params.id]);
    auditLog(req, 'user.deleted', 'users', req.params.id, {
      summary: `User deleted: ${target[0].username}`,
      username: target[0].username,
    });
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
      'SELECT id, username, branch_id FROM users WHERE id = ? AND is_deleted = 0 LIMIT 1',
      [req.params.id]
    );
    if (!target[0]) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }
    if (target[0].branch_id !== req.user.branch_id && !(await isMainAdminReq(req))) {
      return res.status(403).json({ status: 'error', message: 'Only the Main Branch admin can reset passwords of another branch' });
    }
    const hash = await bcrypt.hash(String(password), 12);
    await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.params.id]);
    auditLog(req, 'user.password_reset', 'users', req.params.id, {
      summary: `Password reset for user: ${target[0].username}`,
      username: target[0].username,
    });
    return res.json({ status: 'ok', message: 'Password reset' });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

// GET /api/settings/audit-log — admin only. Read-only view of the
// append-only audit log, newest first, with filters. The Main Branch
// admin sees every branch; any other admin sees only their own branch
// plus system rows with no branch (such as the automatic backup). Each
// entry carries its branch name.
router.get('/audit-log', requireRole('admin'), async (req, res) => {
  const { user_id, action, from, to } = req.query || {};
  const limit = Math.max(1, Math.min(200, parseInt(req.query.limit, 10) || 100));
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  const where = [];
  const params = [];
  if (user_id) {
    where.push('a.user_id = ?');
    params.push(user_id);
  }
  if (action) {
    where.push('a.action = ?');
    params.push(action);
  }
  if (from) {
    where.push('DATE(a.created_at) >= ?');
    params.push(from);
  }
  if (to) {
    where.push('DATE(a.created_at) <= ?');
    params.push(to);
  }
  try {
    const mainAdmin = await isMainAdminReq(req);
    if (!mainAdmin) {
      where.push('(a.branch_id = ? OR a.branch_id IS NULL)');
      params.push(req.user.branch_id);
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const [rows] = await pool.query(
      `SELECT a.id, a.created_at, a.action, a.table_name, a.record_id, a.details,
              u.full_name, u.username, br.name AS branch_name
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.user_id
       LEFT JOIN branches br ON br.id = a.branch_id
       ${whereSql}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const [[{ c: total }]] = await pool.query(
      `SELECT COUNT(*) AS c FROM audit_log a ${whereSql}`,
      params
    );
    const [acts] = mainAdmin
      ? await pool.query('SELECT DISTINCT action FROM audit_log ORDER BY action')
      : await pool.query(
          'SELECT DISTINCT action FROM audit_log WHERE branch_id = ? OR branch_id IS NULL ORDER BY action',
          [req.user.branch_id]
        );
    return res.json({ status: 'ok', entries: rows, total, actions: acts.map((r) => r.action) });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

module.exports = router;
