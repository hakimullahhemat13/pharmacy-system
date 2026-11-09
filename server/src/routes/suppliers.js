// Supplier routes — accounts in both directions:
//   * what the pharmacy bought from each supplier (purchases.total_amount),
//   * what it already paid (purchases.paid_amount at purchase time, plus
//     later payments recorded in supplier_payments),
//   * due = purchases − paid — what the pharmacy still owes the supplier.
// Purchases stay the only way stock enters; this file owns the money.
// Branch always comes from the token.
const express = require('express');
const { v4: uuidv4 } = require('uuid');

const pool = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');

const router = express.Router();

// Hakimullah's rule: a mobile number, when given, is exactly 10 digits —
// never fewer, never more. Empty stays allowed (phone is optional).
function phoneError(phone) {
  if (phone === null) return null;
  return /^\d{10}$/.test(phone) ? null : 'Phone number must be exactly 10 digits';
}

// The money position with one supplier. Works on the pool or on a
// transaction connection (anything with .query).
async function supplierMoney(db, branchId, supplierId) {
  const [p] = await db.query(
    `SELECT COALESCE(SUM(total_amount), 0) AS purchases_total,
            COALESCE(SUM(paid_amount), 0) AS paid_at_purchase
     FROM purchases
     WHERE branch_id = ? AND supplier_id = ? AND is_deleted = 0`,
    [branchId, supplierId]
  );
  const [pay] = await db.query(
    `SELECT COALESCE(SUM(amount), 0) AS payments_total
     FROM supplier_payments
     WHERE branch_id = ? AND supplier_id = ? AND is_deleted = 0`,
    [branchId, supplierId]
  );
  const [ret] = await db.query(
    `SELECT COALESCE(SUM(pr.quantity * pr.unit_price), 0) AS returns_total
     FROM purchase_returns pr
     JOIN purchases pu ON pu.id = pr.purchase_id
     WHERE pu.branch_id = ? AND pu.supplier_id = ? AND pr.is_deleted = 0 AND pu.is_deleted = 0`,
    [branchId, supplierId]
  );
  const purchasesTotal = Number(p[0].purchases_total) - Number(ret[0].returns_total);
  const paidTotal = Number(p[0].paid_at_purchase) + Number(pay[0].payments_total);
  return {
    purchases_total: purchasesTotal,
    paid_total: paidTotal,
    due_total: Math.max(0, purchasesTotal - paidTotal),
  };
}

// POST /api/suppliers  (admin or pharmacist)  Body: { name, phone?, address? }
router.post('/', authRequired, requireRole('admin', 'pharmacist'), async (req, res) => {
  const body = req.body || {};
  const name = String(body.name || '').trim();
  if (!name) {
    return res.status(400).json({ status: 'error', message: 'Supplier name is required' });
  }
  const phone = body.phone ? String(body.phone).trim() : null;
  const address = body.address ? String(body.address).trim() : null;
  const pErr = phoneError(phone);
  if (pErr) {
    return res.status(400).json({ status: 'error', message: pErr });
  }
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

// GET /api/suppliers — every supplier with their account totals
router.get('/', authRequired, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT s.id, s.branch_id, s.name, s.phone, s.address, s.created_at,
              COALESCE(p.purchases_total, 0) - COALESCE(r.returns_total, 0) AS purchases_total,
              COALESCE(p.paid_at_purchase, 0) + COALESCE(pay.payments_total, 0) AS paid_total
       FROM suppliers s
       LEFT JOIN (
         SELECT supplier_id, SUM(total_amount) AS purchases_total, SUM(paid_amount) AS paid_at_purchase
         FROM purchases WHERE branch_id = ? AND is_deleted = 0 AND supplier_id IS NOT NULL
         GROUP BY supplier_id
       ) p ON p.supplier_id = s.id
       LEFT JOIN (
         SELECT supplier_id, SUM(amount) AS payments_total
         FROM supplier_payments WHERE branch_id = ? AND is_deleted = 0
         GROUP BY supplier_id
       ) pay ON pay.supplier_id = s.id
       LEFT JOIN (
         SELECT pu.supplier_id, SUM(pr.quantity * pr.unit_price) AS returns_total
         FROM purchase_returns pr
         JOIN purchases pu ON pu.id = pr.purchase_id
         WHERE pu.branch_id = ? AND pr.is_deleted = 0 AND pu.is_deleted = 0 AND pu.supplier_id IS NOT NULL
         GROUP BY pu.supplier_id
       ) r ON r.supplier_id = s.id
       WHERE s.branch_id = ? AND s.is_deleted = 0
       ORDER BY s.name`,
      [req.user.branch_id, req.user.branch_id, req.user.branch_id, req.user.branch_id]
    );
    const suppliers = rows.map((r) => ({
      ...r,
      due_total: Math.max(0, Number(r.purchases_total) - Number(r.paid_total)),
    }));
    return res.json({ status: 'ok', suppliers });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

// GET /api/suppliers/:id — account detail: totals, purchase history, payments
router.get('/:id', authRequired, async (req, res) => {
  try {
    const branchId = req.user.branch_id;
    const [rows] = await pool.query(
      'SELECT id, branch_id, name, phone, address, created_at FROM suppliers WHERE id = ? AND branch_id = ? AND is_deleted = 0 LIMIT 1',
      [req.params.id, branchId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Supplier not found' });
    }
    const money = await supplierMoney(pool, branchId, req.params.id);
    const [purchases] = await pool.query(
      `SELECT pu.id, pu.invoice_no, pu.purchase_date, pu.total_amount, pu.paid_amount,
              COALESCE(r.returned_total, 0) AS returned_total
       FROM purchases pu
       LEFT JOIN (
         SELECT purchase_id, SUM(quantity * unit_price) AS returned_total
         FROM purchase_returns WHERE is_deleted = 0 GROUP BY purchase_id
       ) r ON r.purchase_id = pu.id
       WHERE pu.branch_id = ? AND pu.supplier_id = ? AND pu.is_deleted = 0
       ORDER BY pu.purchase_date DESC, pu.created_at DESC`,
      [branchId, req.params.id]
    );
    const [payments] = await pool.query(
      `SELECT id, amount, created_at FROM supplier_payments
       WHERE branch_id = ? AND supplier_id = ? AND is_deleted = 0
       ORDER BY created_at DESC`,
      [branchId, req.params.id]
    );
    return res.json({
      status: 'ok',
      supplier: { ...rows[0], ...money, purchases, payments },
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

// PUT /api/suppliers/:id  (admin or pharmacist)  Body: { name, phone?, address? }
router.put('/:id', authRequired, requireRole('admin', 'pharmacist'), async (req, res) => {
  const body = req.body || {};
  const name = String(body.name || '').trim();
  if (!name) {
    return res.status(400).json({ status: 'error', message: 'Supplier name is required' });
  }
  const phone = body.phone ? String(body.phone).trim() : null;
  const address = body.address ? String(body.address).trim() : null;
  const pErr = phoneError(phone);
  if (pErr) {
    return res.status(400).json({ status: 'error', message: pErr });
  }
  try {
    const [result] = await pool.query(
      'UPDATE suppliers SET name = ?, phone = ?, address = ? WHERE id = ? AND branch_id = ? AND is_deleted = 0',
      [name, phone, address, req.params.id, req.user.branch_id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ status: 'error', message: 'Supplier not found' });
    }
    const [rows] = await pool.query(
      'SELECT id, branch_id, name, phone, address, created_at FROM suppliers WHERE id = ? LIMIT 1',
      [req.params.id]
    );
    return res.json({ status: 'ok', supplier: rows[0] });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

// POST /api/suppliers/:id/payment  (admin or pharmacist)  Body: { amount }
// Records a later payment toward what the pharmacy owes this supplier.
// Never more than the current due.
router.post('/:id/payment', authRequired, requireRole('admin', 'pharmacist'), async (req, res) => {
  const amount = Number((req.body || {}).amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ status: 'error', message: 'Payment amount must be more than zero' });
  }
  const branchId = req.user.branch_id;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [sup] = await conn.query(
      'SELECT id FROM suppliers WHERE id = ? AND branch_id = ? AND is_deleted = 0 LIMIT 1',
      [req.params.id, branchId]
    );
    if (sup.length === 0) {
      await conn.rollback();
      return res.status(404).json({ status: 'error', message: 'Supplier not found' });
    }
    const money = await supplierMoney(conn, branchId, req.params.id);
    if (amount > money.due_total) {
      await conn.rollback();
      return res.status(400).json({
        status: 'error',
        message: `Payment is more than the due amount (${money.due_total})`,
      });
    }
    const id = uuidv4();
    await conn.query(
      'INSERT INTO supplier_payments (id, branch_id, supplier_id, amount, created_by) VALUES (?, ?, ?, ?, ?)',
      [id, branchId, req.params.id, amount, req.user.id]
    );
    await conn.commit();
    return res.status(201).json({
      status: 'ok',
      payment: { id, supplier_id: req.params.id, amount },
      due_total: money.due_total - amount,
    });
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* already rolled back */ }
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  } finally {
    conn.release();
  }
});

module.exports = router;
