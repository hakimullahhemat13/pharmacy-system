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

// GET /api/customers — each row also carries due_total: everything the
// customer still owes across their credit (por) bills, computed from the
// sales, returns and payments themselves (never a stored number).
router.get('/', authRequired, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT c.id, c.branch_id, c.name, c.phone, c.balance, c.created_at,
              COALESCE(d.due_total, 0) AS due_total
       FROM customers c
       LEFT JOIN (
         SELECT customer_id, SUM(due) AS due_total
         FROM (
           SELECT s.customer_id,
                  GREATEST(
                    s.net_total
                    - COALESCE(rt.refunded_total, 0)
                    - (CASE WHEN s.paid_amount IS NULL THEN s.net_total ELSE s.paid_amount END
                       + COALESCE(pay.paid_sum, 0)),
                    0
                  ) AS due
           FROM sales s
           LEFT JOIN (
             SELECT st.reference_id AS sale_id,
                    SUM(st.quantity_change * i.unit_price) AS refunded_total
             FROM stock_transactions st
             JOIN sale_items i ON i.sale_id = st.reference_id AND i.batch_id = st.batch_id
             WHERE st.type = 'sale_return'
             GROUP BY st.reference_id
           ) rt ON rt.sale_id = s.id
           LEFT JOIN (
             SELECT sale_id, SUM(amount) AS paid_sum
             FROM sale_payments WHERE is_deleted = 0 GROUP BY sale_id
           ) pay ON pay.sale_id = s.id
           WHERE s.is_deleted = 0 AND s.customer_id IS NOT NULL
         ) per_sale
         GROUP BY customer_id
       ) d ON d.customer_id = c.id
       WHERE c.branch_id = ? AND c.is_deleted = 0
       ORDER BY c.name`,
      [req.user.branch_id]
    );
    const customers = rows.map((r) => ({ ...r, due_total: Math.round(Number(r.due_total) * 100) / 100 }));
    return res.json({ status: 'ok', customers });
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
