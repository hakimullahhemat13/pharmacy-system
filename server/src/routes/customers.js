// Customer routes — add and list. Branch always comes from the token.
const express = require('express');
const { v4: uuidv4 } = require('uuid');

const pool = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

// POST /api/customers  Body: { name, phone? }
router.post('/', authRequired, async (req, res) => {
  const body = req.body || {};
  const name = String(body.name || '').trim();
  if (!name) {
    return res.status(400).json({ status: 'error', message: 'Customer name is required' });
  }
  const phone = body.phone ? String(body.phone).trim() : null;
  try {
    const id = uuidv4();
    await pool.query(
      'INSERT INTO customers (id, branch_id, name, phone) VALUES (?, ?, ?, ?)',
      [id, req.user.branch_id, name, phone]
    );
    const [rows] = await pool.query(
      'SELECT id, branch_id, name, phone, balance, created_at FROM customers WHERE id = ? LIMIT 1',
      [id]
    );
    return res.status(201).json({ status: 'ok', customer: rows[0] });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

// GET /api/customers
router.get('/', authRequired, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, branch_id, name, phone, balance, created_at FROM customers WHERE branch_id = ? AND is_deleted = 0 ORDER BY name',
      [req.user.branch_id]
    );
    return res.json({ status: 'ok', customers: rows });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

module.exports = router;
