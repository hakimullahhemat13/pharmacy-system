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

// GET /api/customers/:id/history — this customer's bills + totals
router.get('/:id/history', authRequired, async (req, res) => {
  try {
    const [cust] = await pool.query(
      'SELECT id, name, phone, balance, created_at FROM customers WHERE id = ? AND branch_id = ? AND is_deleted = 0 LIMIT 1',
      [req.params.id, req.user.branch_id]
    );
    if (!cust[0]) {
      return res.status(404).json({ status: 'error', message: 'Customer not found' });
    }
    const [sales] = await pool.query(
      `SELECT s.id, s.invoice_no, s.sale_date, s.net_total,
              COUNT(si.id) AS items
       FROM sales s
       LEFT JOIN sale_items si ON si.sale_id = s.id
       WHERE s.customer_id = ? AND s.branch_id = ? AND s.is_deleted = 0
       GROUP BY s.id, s.invoice_no, s.sale_date, s.net_total
       ORDER BY s.sale_date DESC, s.created_at DESC`,
      [req.params.id, req.user.branch_id]
    );
    const totals = sales.reduce(
      (acc, s) => ({ bills: acc.bills + 1, total_spent: acc.total_spent + Number(s.net_total || 0) }),
      { bills: 0, total_spent: 0 }
    );
    return res.json({ status: 'ok', customer: cust[0], totals, sales });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

// PUT /api/customers/:id  Body: { name, phone? }
router.put('/:id', authRequired, async (req, res) => {
  const body = req.body || {};
  const name = String(body.name || '').trim();
  if (!name) {
    return res.status(400).json({ status: 'error', message: 'Customer name is required' });
  }
  const phone = body.phone ? String(body.phone).trim() : null;
  try {
    const [result] = await pool.query(
      'UPDATE customers SET name = ?, phone = ? WHERE id = ? AND branch_id = ? AND is_deleted = 0',
      [name, phone, req.params.id, req.user.branch_id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ status: 'error', message: 'Customer not found' });
    }
    const [rows] = await pool.query(
      'SELECT id, branch_id, name, phone, balance, created_at FROM customers WHERE id = ? LIMIT 1',
      [req.params.id]
    );
    return res.json({ status: 'ok', customer: rows[0] });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

// DELETE /api/customers/:id — soft delete (sales history stays intact)
router.delete('/:id', authRequired, async (req, res) => {
  try {
    const [result] = await pool.query(
      'UPDATE customers SET is_deleted = 1 WHERE id = ? AND branch_id = ? AND is_deleted = 0',
      [req.params.id, req.user.branch_id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ status: 'error', message: 'Customer not found' });
    }
    return res.json({ status: 'ok' });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

module.exports = router;
