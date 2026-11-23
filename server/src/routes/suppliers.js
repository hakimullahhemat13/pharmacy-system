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
const { isDayClosed, todayStr, dayClosedMessage } = require('../dayClose');
const { auditLog } = require('../audit');

const { round2 } = require('../money');

const router = express.Router();

// Hakimullah's rule: a mobile number, when given, is exactly 10 digits —
// never fewer, never more. Empty stays allowed (phone is optional).
function phoneError(phone) {
  if (phone === null) return null;
  return /^\d{10}$/.test(phone) ? null : 'Phone number must be exactly 10 digits';
}

// The date a supplier was added. Optional — when given it must be a real
// calendar date (YYYY-MM-DD); otherwise the database stamps today.
function dateAddedError(dateAdded) {
  if (dateAdded === null || dateAdded === undefined || dateAdded === '') return null;
  const s = String(dateAdded);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return 'Date added must be YYYY-MM-DD';
  const d = new Date(`${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return 'Date added must be a real date';
  const pad = (n) => String(n).padStart(2, '0');
  const back = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return back === s ? null : 'Date added must be a real date';
}

// The money position with one supplier. Works on the pool or on a
// transaction connection (anything with .query).
async function supplierMoney(db, branchId, supplierId) {
  // Waiting purchases are not in the books yet — they count toward the
  // supplier's account only once the Main Branch accepts them.
  const [p] = await db.query(
    `SELECT COALESCE(SUM(total_amount), 0) AS purchases_total,
            COALESCE(SUM(paid_amount), 0) AS paid_at_purchase
     FROM purchases
     WHERE branch_id = ? AND supplier_id = ? AND is_deleted = 0 AND approval_status = 'approved'`,
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
  const purchasesTotal = Math.round((Number(p[0].purchases_total) - Number(ret[0].returns_total)) * 100) / 100;
  const paidTotal = Math.round((Number(p[0].paid_at_purchase) + Number(pay[0].payments_total)) * 100) / 100;
  // Signed: a negative due is real — the supplier owes the pharmacy
  // (overpaid, or goods sent back). Never clamp it to zero, or that
  // credit is erased and can never be recovered.
  return {
    purchases_total: purchasesTotal,
    paid_total: paidTotal,
    due_total: Math.round((purchasesTotal - paidTotal) * 100) / 100,
  };
}

// POST /api/suppliers  (admin or pharmacist)  Body: { name, phone?, address?, date_added? }
router.post('/', authRequired, requireRole('admin', 'pharmacist'), async (req, res) => {
  const body = req.body || {};
  const name = String(body.name || '').trim();
  if (!name) {
    return res.status(400).json({ status: 'error', message: 'Supplier name is required' });
  }
  const phone = body.phone ? String(body.phone).trim() : null;
  const address = body.address ? String(body.address).trim() : null;
  const dateAdded = body.date_added ? String(body.date_added).trim() : null;
  const pErr = phoneError(phone);
  if (pErr) {
    return res.status(400).json({ status: 'error', message: pErr });
  }
  const dErr = dateAddedError(dateAdded);
  if (dErr) {
    return res.status(400).json({ status: 'error', message: dErr });
  }
  try {
    const id = uuidv4();
    if (dateAdded) {
      // Stored at noon, not midnight: the list shows created_at with
      // .slice(0, 10) on the UTC string, and midnight local time would
      // read as the previous day in timezones ahead of UTC.
      await pool.query(
        'INSERT INTO suppliers (id, branch_id, name, phone, address, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [id, req.user.branch_id, name, phone, address, `${dateAdded} 12:00:00`]
      );
    } else {
      await pool.query(
        'INSERT INTO suppliers (id, branch_id, name, phone, address) VALUES (?, ?, ?, ?, ?)',
        [id, req.user.branch_id, name, phone, address]
      );
    }
    const [rows] = await pool.query(
      'SELECT id, branch_id, name, phone, address, created_at FROM suppliers WHERE id = ? LIMIT 1',
      [id]
    );
    auditLog(req, 'supplier.created', 'suppliers', id, {
      summary: `Supplier added: ${rows[0].name}`,
      name: rows[0].name,
    });
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
         FROM purchases WHERE branch_id = ? AND is_deleted = 0 AND approval_status = 'approved' AND supplier_id IS NOT NULL
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
      due_total: Math.round((Number(r.purchases_total) - Number(r.paid_total)) * 100) / 100,
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
              pu.approval_status, pu.rejection_note,
              COALESCE(r.returned_total, 0) AS returned_total
       FROM purchases pu
       LEFT JOIN (
         SELECT purchase_id, SUM(quantity * unit_price) AS returned_total
         FROM purchase_returns WHERE is_deleted = 0 GROUP BY purchase_id
       ) r ON r.purchase_id = pu.id
       WHERE pu.branch_id = ? AND pu.supplier_id = ? AND pu.is_deleted = 0 AND pu.approval_status = 'approved'
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

// PUT /api/suppliers/:id  (admin or pharmacist)  Body: { name, phone?, address?, date_added? }
router.put('/:id', authRequired, requireRole('admin', 'pharmacist'), async (req, res) => {
  const body = req.body || {};
  const name = String(body.name || '').trim();
  if (!name) {
    return res.status(400).json({ status: 'error', message: 'Supplier name is required' });
  }
  const phone = body.phone ? String(body.phone).trim() : null;
  const address = body.address ? String(body.address).trim() : null;
  const dateAdded = body.date_added ? String(body.date_added).trim() : null;
  const pErr = phoneError(phone);
  if (pErr) {
    return res.status(400).json({ status: 'error', message: pErr });
  }
  const dErr = dateAddedError(dateAdded);
  if (dErr) {
    return res.status(400).json({ status: 'error', message: dErr });
  }
  try {
    const [result] = dateAdded
      ? await pool.query(
          'UPDATE suppliers SET name = ?, phone = ?, address = ?, created_at = ? WHERE id = ? AND branch_id = ? AND is_deleted = 0',
          [name, phone, address, `${dateAdded} 12:00:00`, req.params.id, req.user.branch_id]
        )
      : await pool.query(
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
    auditLog(req, 'supplier.updated', 'suppliers', req.params.id, {
      summary: `Supplier edited: ${rows[0].name}`,
      name: rows[0].name,
    });
    return res.json({ status: 'ok', supplier: rows[0] });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

// DELETE /api/suppliers/:id  (admin or pharmacist) — soft delete.
// Blocked while the pharmacy still owes this supplier: settle the due
// first, so no money trail is hidden. Purchase history keeps showing the
// supplier's name (purchases join suppliers without an is_deleted filter).
router.delete('/:id', authRequired, requireRole('admin', 'pharmacist'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, name FROM suppliers WHERE id = ? AND branch_id = ? AND is_deleted = 0 LIMIT 1',
      [req.params.id, req.user.branch_id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Supplier not found' });
    }
    const money = await supplierMoney(pool, req.user.branch_id, req.params.id);
    if (money.due_total !== 0) {
      return res.status(400).json({
        status: 'error',
        message:
          money.due_total > 0
            ? `Cannot delete ${rows[0].name}: ${money.due_total} AFN still due. Record the payment first.`
            : `Cannot delete ${rows[0].name}: the supplier still owes you ${Math.abs(money.due_total)} AFN.`,
      });
    }
    await pool.query('UPDATE suppliers SET is_deleted = 1 WHERE id = ? AND branch_id = ?', [
      req.params.id,
      req.user.branch_id,
    ]);
    auditLog(req, 'supplier.deleted', 'suppliers', req.params.id, {
      summary: `Supplier deleted: ${rows[0].name}`,
      name: rows[0].name,
    });
    return res.json({ status: 'ok' });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

// POST /api/suppliers/:id/payment  (admin or pharmacist)  Body: { amount }
// Records a later payment toward what the pharmacy owes this supplier.
// Never more than the current due.
router.post('/:id/payment', authRequired, requireRole('admin', 'pharmacist'), async (req, res) => {
  const amount = round2(Number((req.body || {}).amount));
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ status: 'error', message: 'Payment amount must be more than zero' });
  }
  const branchId = req.user.branch_id;

  // A supplier payment is cash out today — a closed today takes none.
  const supplierPayDay = todayStr();
  if (await isDayClosed(pool, branchId, supplierPayDay)) {
    return res.status(400).json({ status: 'error', message: dayClosedMessage(supplierPayDay) });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [sup] = await conn.query(
      'SELECT id, name FROM suppliers WHERE id = ? AND branch_id = ? AND is_deleted = 0 LIMIT 1',
      [req.params.id, branchId]
    );
    if (sup.length === 0) {
      await conn.rollback();
      return res.status(404).json({ status: 'error', message: 'Supplier not found' });
    }
    const money = await supplierMoney(conn, branchId, req.params.id);
    if (money.due_total <= 0) {
      await conn.rollback();
      return res.status(400).json({
        status: 'error',
        message:
          money.due_total < 0
            ? `This supplier owes you ${Math.abs(money.due_total)} AFN — no payment is due.`
            : 'Nothing is due to this supplier.',
      });
    }
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
      [id, branchId, req.params.id, amount, req.user.sub]
    );
    await conn.commit();
    auditLog(req, 'supplier.payment', 'suppliers', req.params.id, {
      summary: `Payment ${amount} AFN to ${sup[0].name}`,
      name: sup[0].name, amount,
    });
    return res.status(201).json({
      status: 'ok',
      payment: { id, supplier_id: req.params.id, amount },
      due_total: round2(money.due_total - amount),
    });
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* already rolled back */ }
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  } finally {
    conn.release();
  }
});

module.exports = router;
