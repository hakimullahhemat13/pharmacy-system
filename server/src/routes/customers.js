// Customer routes — add and list. Branch always comes from the token.
const express = require('express');
const { v4: uuidv4 } = require('uuid');

const pool = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');
const { auditLog } = require('../audit');

const router = express.Router();

// Same rule as suppliers: a mobile number, when given, is exactly
// 10 digits. Empty stays allowed (phone is optional).
function phoneError(phone) {
  if (phone === null) return null;
  return /^\d{10}$/.test(phone) ? null : 'Phone number must be exactly 10 digits';
}

// POST /api/customers  Body: { name, phone? }
router.post('/', authRequired, async (req, res) => {
  const body = req.body || {};
  const name = String(body.name || '').trim();
  if (!name) {
    return res.status(400).json({ status: 'error', message: 'Customer name is required' });
  }
  const phone = body.phone ? String(body.phone).trim() : null;
  const pErr = phoneError(phone);
  if (pErr) {
    return res.status(400).json({ status: 'error', message: pErr });
  }
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
    auditLog(req, 'customer.created', 'customers', id, {
      summary: `Customer added: ${rows[0].name}`,
      name: rows[0].name,
    });
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
    // A cashier sees only their own bills in a customer's due: other
    // cashiers' credit sales are not theirs to see.
    const isCashier = req.user.role === 'cashier';
    const cashierFilter = isCashier ? ' AND s.created_by = ?' : '';
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
                    SUM(st.quantity_change * i.unit_price * (CASE WHEN sv.total_amount > 0 THEN sv.net_total / sv.total_amount ELSE 0 END)) AS refunded_total
             FROM stock_transactions st
             JOIN sale_items i ON i.sale_id = st.reference_id AND i.batch_id = st.batch_id
             JOIN sales sv ON sv.id = st.reference_id
             WHERE st.type = 'sale_return'
             GROUP BY st.reference_id
           ) rt ON rt.sale_id = s.id
           LEFT JOIN (
             SELECT sale_id, SUM(amount) AS paid_sum
             FROM sale_payments WHERE is_deleted = 0 GROUP BY sale_id
           ) pay ON pay.sale_id = s.id
           WHERE s.is_deleted = 0 AND s.customer_id IS NOT NULL${cashierFilter}
         ) per_sale
         GROUP BY customer_id
       ) d ON d.customer_id = c.id
       WHERE c.branch_id = ? AND c.is_deleted = 0
       ORDER BY c.name`,
      isCashier ? [req.user.sub, req.user.branch_id] : [req.user.branch_id]
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
    // A cashier sees only their own bills for this customer.
    const isCashier = req.user.role === 'cashier';
    const [rows] = await pool.query(
      `SELECT s.id, s.invoice_no, s.sale_date, s.net_total, s.paid_amount, s.voided_at,
              COUNT(si.id) AS items,
              COALESCE(rt.refunded_total, 0) AS refunded_total,
              COALESCE(pay.paid_sum, 0) AS payments_sum
       FROM sales s
       LEFT JOIN sale_items si ON si.sale_id = s.id
       LEFT JOIN (
         SELECT st.reference_id AS sale_id,
                SUM(st.quantity_change * i.unit_price * (CASE WHEN sv.total_amount > 0 THEN sv.net_total / sv.total_amount ELSE 0 END)) AS refunded_total
         FROM stock_transactions st
         JOIN sale_items i ON i.sale_id = st.reference_id AND i.batch_id = st.batch_id
         JOIN sales sv ON sv.id = st.reference_id
         WHERE st.type = 'sale_return'
         GROUP BY st.reference_id
       ) rt ON rt.sale_id = s.id
       LEFT JOIN (
         SELECT sale_id, SUM(amount) AS paid_sum
         FROM sale_payments WHERE is_deleted = 0 GROUP BY sale_id
       ) pay ON pay.sale_id = s.id
       WHERE s.customer_id = ? AND s.branch_id = ? AND s.is_deleted = 0${isCashier ? ' AND s.created_by = ?' : ''}
       GROUP BY s.id, s.invoice_no, s.sale_date, s.net_total, s.paid_amount, s.voided_at,
                rt.refunded_total, pay.paid_sum
       ORDER BY s.sale_date DESC, s.created_at DESC`,
      isCashier ? [req.params.id, req.user.branch_id, req.user.sub] : [req.params.id, req.user.branch_id]
    );
    // Same money math as the sales list: a NULL paid_amount means the bill
    // was paid in full at the till; a voided bill keeps no money (paid 0,
    // refunded = what was paid, due 0).
    const sales = rows.map((r) => {
      const net = Number(r.net_total);
      const refunded = Math.round(Number(r.refunded_total) * 100) / 100;
      const paidAtSale = r.paid_amount === null ? net : Number(r.paid_amount);
      const paidTotal = Math.round((paidAtSale + Number(r.payments_sum)) * 100) / 100;
      if (r.voided_at) {
        return { ...r, refunded_total: paidTotal, paid_total: 0, due_amount: 0, voided: 1 };
      }
      return {
        ...r,
        refunded_total: refunded,
        paid_total: paidTotal,
        due_amount: Math.max(0, Math.round((net - refunded - paidTotal) * 100) / 100),
        voided: 0,
      };
    });
    // Totals count only bills that still stand: a voided bill spent
    // nothing, and a returned part is not spent either.
    const totals = sales
      .filter((s) => !s.voided_at)
      .reduce(
        (acc, s) => ({
          bills: acc.bills + 1,
          total_spent: acc.total_spent + (Number(s.net_total || 0) - Number(s.refunded_total || 0)),
        }),
        { bills: 0, total_spent: 0 }
      );
    return res.json({ status: 'ok', customer: cust[0], totals, sales });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

// PUT /api/customers/:id  Body: { name, phone? }
router.put('/:id', authRequired, requireRole('admin', 'pharmacist'), async (req, res) => {
  const body = req.body || {};
  const name = String(body.name || '').trim();
  if (!name) {
    return res.status(400).json({ status: 'error', message: 'Customer name is required' });
  }
  const phone = body.phone ? String(body.phone).trim() : null;
  const pErr = phoneError(phone);
  if (pErr) {
    return res.status(400).json({ status: 'error', message: pErr });
  }
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
    auditLog(req, 'customer.updated', 'customers', req.params.id, {
      summary: `Customer edited: ${rows[0].name}`,
      name: rows[0].name,
    });
    return res.json({ status: 'ok', customer: rows[0] });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

// DELETE /api/customers/:id — soft delete (sales history stays intact)
router.delete('/:id', authRequired, requireRole('admin', 'pharmacist'), async (req, res) => {
  try {
    const [found] = await pool.query(
      'SELECT name FROM customers WHERE id = ? AND branch_id = ? AND is_deleted = 0 LIMIT 1',
      [req.params.id, req.user.branch_id]
    );
    const [result] = await pool.query(
      'UPDATE customers SET is_deleted = 1 WHERE id = ? AND branch_id = ? AND is_deleted = 0',
      [req.params.id, req.user.branch_id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ status: 'error', message: 'Customer not found' });
    }
    auditLog(req, 'customer.deleted', 'customers', req.params.id, {
      summary: `Customer deleted: ${found[0] ? found[0].name : req.params.id}`,
    });
    return res.json({ status: 'ok' });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

module.exports = router;
