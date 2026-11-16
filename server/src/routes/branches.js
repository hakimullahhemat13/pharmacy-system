// Branches — reading is admin only; creating, editing and deleting a
// branch is the Main Branch admin's alone. A child branch never creates
// a branch: the list stays readable for every admin (the user form's
// branch dropdown needs it), but the changes below refuse anyone who
// is not the Main Branch admin. A single pharmacy works with one branch
// and never needs this page; when a second branch opens, the Main admin
// adds it here. Every branch keeps its own users, stock and reports
// (all rows carry branch_id, taken from the login token), and the
// central dashboard (GET /api/reports/central) reads across branches.
//   GET    /api/branches       admin: all branches + user counts
//   POST   /api/branches       Main admin: create a branch
//   PUT    /api/branches/:id   Main admin: update name/address/phone
//   DELETE /api/branches/:id   Main admin: soft delete (guarded)
const express = require('express');
const { v4: uuidv4 } = require('uuid');

const pool = require('../db');
const { authRequired, requireRole, requireMainAdmin } = require('../middleware/auth');
const { auditLog } = require('../audit');

const router = express.Router();
router.use(authRequired, requireRole('admin'));

function validBranchBody(body) {
  const { name, address, phone } = body || {};
  if (!name || !String(name).trim()) {
    return { error: 'Branch name is required' };
  }
  // Same system-wide rule: a phone number, when given, is exactly 10 digits.
  if (phone && !/^\d{10}$/.test(String(phone).trim())) {
    return { error: 'Phone number must be exactly 10 digits' };
  }
  return {
    values: {
      name: String(name).trim(),
      address: address ? String(address).trim() : null,
      phone: phone ? String(phone).trim() : null,
    },
  };
}

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT b.id, b.name, b.address, b.phone, b.created_at,
              COUNT(u.id) AS user_count
       FROM branches b
       LEFT JOIN users u ON u.branch_id = b.id AND u.is_deleted = 0
       WHERE b.is_deleted = 0
       GROUP BY b.id, b.name, b.address, b.phone, b.created_at
       ORDER BY b.created_at`
    );
    return res.json({ status: 'ok', branches: rows });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

router.post('/', requireMainAdmin, async (req, res) => {
  const checked = validBranchBody(req.body);
  if (checked.error) {
    return res.status(400).json({ status: 'error', message: checked.error });
  }
  try {
    const id = uuidv4();
    await pool.query('INSERT INTO branches (id, name, address, phone) VALUES (?, ?, ?, ?)', [
      id,
      checked.values.name,
      checked.values.address,
      checked.values.phone,
    ]);
    auditLog(req, 'branch.created', 'branches', id, {
      summary: `Branch created: ${checked.values.name}`,
    });
    return res.status(201).json({
      status: 'ok',
      branch: { id, ...checked.values, user_count: 0 },
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

router.put('/:id', requireMainAdmin, async (req, res) => {
  const checked = validBranchBody(req.body);
  if (checked.error) {
    return res.status(400).json({ status: 'error', message: checked.error });
  }
  try {
    const [result] = await pool.query(
      'UPDATE branches SET name = ?, address = ?, phone = ? WHERE id = ? AND is_deleted = 0',
      [checked.values.name, checked.values.address, checked.values.phone, req.params.id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ status: 'error', message: 'Branch not found' });
    }
    auditLog(req, 'branch.updated', 'branches', req.params.id, {
      summary: `Branch updated: ${checked.values.name}`,
    });
    return res.json({ status: 'ok', message: 'Branch updated' });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

// Soft delete. Guarded: the admin's own branch can never be deleted, a
// branch with users must have its users deleted first, and the last
// branch can never go — the system always has at least one branch.
router.delete('/:id', requireMainAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, name FROM branches WHERE id = ? AND is_deleted = 0 LIMIT 1',
      [req.params.id]
    );
    if (!rows[0]) {
      return res.status(404).json({ status: 'error', message: 'Branch not found' });
    }
    if (req.params.id === req.user.branch_id) {
      return res.status(400).json({ status: 'error', message: 'You cannot delete your own branch' });
    }
    const [[{ c: branchCount }]] = await pool.query(
      'SELECT COUNT(*) AS c FROM branches WHERE is_deleted = 0'
    );
    if (Number(branchCount) <= 1) {
      return res.status(400).json({ status: 'error', message: 'Cannot delete the last branch' });
    }
    const [[{ c: userCount }]] = await pool.query(
      'SELECT COUNT(*) AS c FROM users WHERE branch_id = ? AND is_deleted = 0',
      [req.params.id]
    );
    if (Number(userCount) > 0) {
      return res.status(400).json({
        status: 'error',
        message: `Cannot delete ${rows[0].name}: it still has ${userCount} user(s). Delete its users first.`,
      });
    }
    await pool.query('UPDATE branches SET is_deleted = 1 WHERE id = ?', [req.params.id]);
    auditLog(req, 'branch.deleted', 'branches', req.params.id, {
      summary: `Branch deleted: ${rows[0].name}`,
    });
    return res.json({ status: 'ok', message: 'Branch deleted' });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

module.exports = router;
