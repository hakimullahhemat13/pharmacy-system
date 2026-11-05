// Supplier routes — add and list. Branch always comes from the token.
const express = require('express');
const { v4: uuidv4 } = require('uuid');

const pool = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');

const router = express.Router();

// POST /api/suppliers  (admin or pharmacist)  Body: { name, phone?, address? }
router.post('/', authRequired, requireRole('admin', 'pharmacist'), async (req, res) => {
  const body = req.body || {};
  const name = String(body.name || '').trim();
  if (!name) {
    return res.status(400).json({ status: 'error', message: 'Supplier name is required' });
  }
  const phone = body.phone ? String(body.phone).trim() : null;
  const address = body.address ? String(body.address).trim() : null;
  try {
    const id = uuidv4();
    await pool.query(
      'INSERT INTO suppliers (id, branch_id, name, phone, address) VALUES (?, ?, ?, ?, ?)',
      [id, req.user.branch_id, name, phone, address]
    );
    const [rows] = await pool.query(
      'SELECT id, branch_id, name, phone, address, created_at FROM suppliers WHERE id = ? LIMIT 1',
      [id]
    );
    return res.status(201).json({ status: 'ok', supplier: rows[0] });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

// GET /api/suppliers
router.get('/', authRequired, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, branch_id, name, phone, address, created_at FROM suppliers WHERE branch_id = ? AND is_deleted = 0 ORDER BY name',
      [req.user.branch_id]
    );
    return res.json({ status: 'ok', suppliers: rows });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

module.exports = router;
