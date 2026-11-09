// Stock routes — read-only views over medicine_batches.
// GET /api/stock                     current stock per medicine (with batch detail)
// GET /api/stock/expiring?months=3   batches expiring within N months (default 3),
//                                    plus already-expired ones that still have stock.
//                                    This is the data behind the expiry warnings.
const express = require('express');
const { v4: uuidv4 } = require('uuid');

const pool = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

router.get('/', authRequired, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT m.id AS medicine_id, m.name, m.generic_name, m.company, m.barcode, m.unit, m.category, m.sale_price, m.min_stock, m.warn_months, m.created_at,
              COALESCE(SUM(b.quantity_on_hand), 0) AS total_quantity,
              COUNT(b.id) AS batch_count
       FROM medicines m
       LEFT JOIN medicine_batches b
         ON b.medicine_id = m.id AND b.branch_id = m.branch_id AND b.is_deleted = 0
       WHERE m.branch_id = ? AND m.is_deleted = 0
       GROUP BY m.id, m.name, m.generic_name, m.company, m.barcode, m.unit, m.category, m.sale_price, m.min_stock, m.warn_months, m.created_at
       ORDER BY m.created_at DESC, m.name`,
      [req.user.branch_id]
    );
    const stock = rows.map((r) => ({
      ...r,
      total_quantity: Number(r.total_quantity),
      low_stock: Number(r.total_quantity) <= Number(r.min_stock),
    }));
    return res.json({ status: 'ok', stock });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

// Each medicine carries its own warning window (medicines.warn_months, set by
// the pharmacist per medicine): a batch appears here once its expiry is
// within that medicine's window — already-expired batches always appear.
router.get('/expiring', authRequired, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT b.id AS batch_id, b.batch_no, b.expiry_date, b.quantity_on_hand, b.purchase_price,
              m.id AS medicine_id, m.name AS medicine_name, m.barcode, m.warn_months,
              DATEDIFF(b.expiry_date, CURDATE()) AS days_remaining
       FROM medicine_batches b
       JOIN medicines m ON m.id = b.medicine_id
       WHERE b.branch_id = ? AND b.is_deleted = 0 AND m.is_deleted = 0 AND b.quantity_on_hand > 0
         AND b.expiry_date <= DATE_ADD(CURDATE(), INTERVAL m.warn_months MONTH)
       ORDER BY b.expiry_date ASC`,
      [req.user.branch_id]
    );
    const batches = rows.map((r) => ({
      ...r,
      level: r.days_remaining < 0 ? 'expired' : r.days_remaining <= 30 ? 'critical' : 'warning',
    }));
    return res.json({ status: 'ok', batches });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

// Every batch with stock, whatever its expiry date — the page behind the
// "all expiry dates, always visible" view. Sorted soonest-expiring first;
// a batch's level uses its own medicine's warn_months window.
router.get('/all-batches', authRequired, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT b.id AS batch_id, b.batch_no, b.expiry_date, b.quantity_on_hand,
              m.id AS medicine_id, m.name AS medicine_name, m.company, m.barcode,
              m.warn_months,
              DATEDIFF(b.expiry_date, CURDATE()) AS days_remaining
       FROM medicine_batches b
       JOIN medicines m ON m.id = b.medicine_id
       WHERE b.branch_id = ? AND b.is_deleted = 0 AND m.is_deleted = 0 AND b.quantity_on_hand > 0
       ORDER BY b.expiry_date ASC`,
      [req.user.branch_id]
    );
    const batches = rows.map((r) => {
      const warnDays = (Number(r.warn_months) || 3) * 30;
      const level =
        r.days_remaining < 0
          ? 'expired'
          : r.days_remaining <= 30
            ? 'critical'
            : r.days_remaining <= warnDays
              ? 'warning'
              : 'ok';
      return { ...r, level };
    });
    return res.json({ status: 'ok', batches });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

// POST /api/stock/batches/:batchId/write-off — remove expired stock from
// the books. Body: { quantity, reason? }. One transaction: the batch's
// quantity_on_hand drops and an 'expired' ledger row is written, so the
// stock count matches reality and the removal stays on record. Only
// already-expired batches can be written off, and never more than the
// batch still holds. No database migration is needed: the
// stock_transactions ENUM already contains 'expired'.
router.post('/batches/:batchId/write-off', authRequired, async (req, res) => {
  const qty = Number((req.body || {}).quantity);
  if (!Number.isInteger(qty) || qty <= 0) {
    return res.status(400).json({ status: 'error', message: 'Quantity must be a whole number above 0' });
  }
  const reason = String((req.body || {}).reason || '').trim().slice(0, 255) || 'expired';
  const branchId = req.user.branch_id;
  const userId = req.user.sub;
  const batchId = req.params.batchId;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [batches] = await conn.query(
      `SELECT b.id, b.medicine_id, b.batch_no, b.expiry_date, b.quantity_on_hand,
              m.name AS medicine_name
       FROM medicine_batches b
       JOIN medicines m ON m.id = b.medicine_id
       WHERE b.id = ? AND b.branch_id = ? AND b.is_deleted = 0 LIMIT 1 FOR UPDATE`,
      [batchId, branchId]
    );
    if (batches.length === 0) {
      await conn.rollback();
      return res.status(404).json({ status: 'error', message: 'Batch not found' });
    }
    const batch = batches[0];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (new Date(batch.expiry_date) >= today) {
      await conn.rollback();
      return res.status(400).json({ status: 'error', message: 'Only expired batches can be written off' });
    }
    if (qty > Number(batch.quantity_on_hand)) {
      await conn.rollback();
      return res.status(400).json({
        status: 'error',
        message: `Cannot write off ${qty}: only ${batch.quantity_on_hand} left in batch ${batch.batch_no}`,
      });
    }
    await conn.query(
      'UPDATE medicine_batches SET quantity_on_hand = quantity_on_hand - ? WHERE id = ?',
      [qty, batchId]
    );
    await conn.query(
      "INSERT INTO stock_transactions (id, branch_id, medicine_id, batch_id, type, quantity_change, reference_id, reason, created_by) VALUES (?, ?, ?, ?, 'expired', ?, ?, ?, ?)",
      [uuidv4(), branchId, batch.medicine_id, batchId, -qty, batchId, reason, userId]
    );
    await conn.commit();
    return res.json({
      status: 'ok',
      medicine_name: batch.medicine_name,
      batch_no: batch.batch_no,
      quantity: qty,
      remaining: Number(batch.quantity_on_hand) - qty,
    });
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* already rolled back */ }
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  } finally {
    conn.release();
  }
});

// GET /api/stock/write-offs — history of written-off stock, newest first.
router.get('/write-offs', authRequired, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT st.created_at, st.quantity_change, st.reason,
              m.name AS medicine_name, b.batch_no, b.expiry_date,
              u.full_name AS written_by
       FROM stock_transactions st
       JOIN medicines m ON m.id = st.medicine_id
       JOIN medicine_batches b ON b.id = st.batch_id
       LEFT JOIN users u ON u.id = st.created_by
       WHERE st.branch_id = ? AND st.type = 'expired'
       ORDER BY st.created_at DESC LIMIT 50`,
      [req.user.branch_id]
    );
    return res.json({ status: 'ok', writeOffs: rows });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

module.exports = router;
