// Stock routes — read-only views over medicine_batches.
// GET /api/stock                     current stock per medicine (with batch detail)
// GET /api/stock/expiring?months=3   batches expiring within N months (default 3),
//                                    plus already-expired ones that still have stock.
//                                    This is the data behind the expiry warnings.
const express = require('express');
const { v4: uuidv4 } = require('uuid');

const pool = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');
const { auditLog } = require('../audit');
const { isDayClosed, todayStr, dayOf, dayClosedMessage } = require('../dayClose');

const router = express.Router();

router.get('/', authRequired, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT m.id AS medicine_id, m.name, m.generic_name, m.company, m.barcode, m.unit, m.category, m.sale_price, m.min_stock, m.warn_months, m.approval_status, m.rejection_note, m.created_at,
              COALESCE(SUM(CASE WHEN b.expiry_date >= CURDATE() THEN b.quantity_on_hand ELSE 0 END), 0) AS total_quantity,
              COALESCE(SUM(CASE WHEN b.expiry_date < CURDATE() THEN b.quantity_on_hand ELSE 0 END), 0) AS expired_quantity,
              COUNT(b.id) AS batch_count,
              (SELECT MIN(b2.expiry_date) FROM medicine_batches b2
                WHERE b2.medicine_id = m.id AND b2.branch_id = m.branch_id AND b2.is_deleted = 0 AND b2.quantity_on_hand > 0 AND b2.expiry_date >= CURDATE()) AS nearest_expiry
       FROM medicines m
       LEFT JOIN medicine_batches b
         ON b.medicine_id = m.id AND b.branch_id = m.branch_id AND b.is_deleted = 0
       WHERE m.branch_id = ? AND m.is_deleted = 0
       GROUP BY m.id, m.name, m.generic_name, m.company, m.barcode, m.unit, m.category, m.sale_price, m.min_stock, m.warn_months, m.approval_status, m.rejection_note, m.created_at
       ORDER BY m.created_at DESC, m.name`,
      [req.user.branch_id]
    );
    const stock = rows.map((r) => ({
      ...r,
      total_quantity: Number(r.total_quantity),
      expired_quantity: Number(r.expired_quantity),
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
         AND DATEDIFF(b.expiry_date, CURDATE()) <= m.warn_months * 30
       ORDER BY b.expiry_date ASC`,
      [req.user.branch_id]
    );
    // Same day-count levels as everywhere else (levelFor): the window is
    // warn_months x 30 days, not calendar months.
    const batches = rows.map((r) => {
      const row = { ...r, level: levelFor(r.days_remaining, r.warn_months) };
      if (req.user.role === 'cashier') delete row.purchase_price;
      return row;
    });
    return res.json({ status: 'ok', batches });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

// A batch's level uses its own medicine's warn_months window: expired
// when past date, critical within 30 days, warning within the window.
function levelFor(daysRemaining, warnMonths) {
  const warnDays = (Number(warnMonths) || 3) * 30;
  if (daysRemaining < 0) return 'expired';
  if (daysRemaining <= 30) return 'critical';
  if (daysRemaining <= warnDays) return 'warning';
  return 'ok';
}

// The batch list behind both the Expiry page and the Excel export — one
// query, so the sheet always matches the screen.
async function allBatches(branchId) {
  const [rows] = await pool.query(
    `SELECT b.id AS batch_id, b.batch_no, b.expiry_date, b.quantity_on_hand, b.purchase_price,
            m.id AS medicine_id, m.name AS medicine_name, m.company, m.barcode,
            m.warn_months,
            DATEDIFF(b.expiry_date, CURDATE()) AS days_remaining
     FROM medicine_batches b
     JOIN medicines m ON m.id = b.medicine_id
     WHERE b.branch_id = ? AND b.is_deleted = 0 AND m.is_deleted = 0 AND b.quantity_on_hand > 0
     ORDER BY b.expiry_date ASC`,
    [branchId]
  );
  return rows.map((r) => ({ ...r, level: levelFor(r.days_remaining, r.warn_months) }));
}

// Every batch with stock, whatever its expiry date — the page behind the
// "all expiry dates, always visible" view. Sorted soonest-expiring first.
router.get('/all-batches', authRequired, async (req, res) => {
  try {
    let batches = await allBatches(req.user.branch_id);
    if (req.user.role === 'cashier') {
      batches = batches.map((b) => {
        const row = { ...b };
        delete row.purchase_price;
        return row;
      });
    }
    return res.json({ status: 'ok', batches });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

// GET /api/stock/expiry-export?filter=all|expired|warning|ok&q= — the
// expiry list as a real .xlsx download, for handing to suppliers when
// near-expiry stock goes back. Same rows and same filter rules as the
// Expiry page, so the sheet matches the screen. exceljs is required
// lazily, same as the reports export.
router.get('/expiry-export', authRequired, requireRole('admin', 'pharmacist'), async (req, res) => {
  let ExcelJS;
  try {
    ExcelJS = require('exceljs');
  } catch (_) {
    return res.status(500).json({
      status: 'error',
      message: 'Excel export is not installed on the server — in the server folder run: npm install',
    });
  }
  const filter = ['expired', 'warning', 'ok'].includes(String(req.query.filter))
    ? String(req.query.filter)
    : 'all';
  const q = String(req.query.q || '').trim().toLowerCase();
  try {
    let batches = await allBatches(req.user.branch_id);
    if (filter === 'expired') batches = batches.filter((b) => b.level === 'expired');
    else if (filter === 'warning') batches = batches.filter((b) => b.level === 'warning' || b.level === 'critical');
    else if (filter === 'ok') batches = batches.filter((b) => b.level === 'ok');
    if (q) {
      batches = batches.filter(
        (b) =>
          String(b.medicine_name).toLowerCase().includes(q) ||
          String(b.company || '').toLowerCase().includes(q) ||
          String(b.batch_no).toLowerCase().includes(q)
      );
    }
    const today = todayStr();
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Pharmacy System';
    wb.created = new Date();
    const ws = wb.addWorksheet('Expiry list');
    const title = ws.addRow([`Expiry list — ${filter} — ${today}`]);
    title.font = { bold: true, size: 14 };
    ws.addRow([]);
    ws.addRow(['Medicine', 'Company', 'Batch', 'Expiry date', 'Days left', 'Status', 'Qty', 'Value (cost, AFN)']);
    for (const b of batches) {
      ws.addRow([
        b.medicine_name,
        b.company || '',
        b.batch_no,
        dayOf(b.expiry_date),
        Number(b.days_remaining),
        b.level,
        Number(b.quantity_on_hand),
        Math.round(Number(b.quantity_on_hand) * Number(b.purchase_price || 0) * 100) / 100,
      ]);
    }
    const totalQty = batches.reduce((s, b) => s + Number(b.quantity_on_hand), 0);
    const totalValue = batches.reduce(
      (s, b) => s + Number(b.quantity_on_hand) * Number(b.purchase_price || 0),
      0
    );
    const totalRow = ws.addRow(['Total', '', '', '', '', '', totalQty, Math.round(totalValue * 100) / 100]);
    totalRow.font = { bold: true };
    ws.getColumn(8).numFmt = '#,##0.00';
    ws.getRow(3).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 3 }];
    const buffer = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="pharmacy-expiry-list-${today}.xlsx"`);
    return res.send(Buffer.from(buffer));
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
router.post('/batches/:batchId/write-off', authRequired, requireRole('admin', 'pharmacist'), async (req, res) => {
  const qty = Number((req.body || {}).quantity);
  if (!Number.isInteger(qty) || qty <= 0) {
    return res.status(400).json({ status: 'error', message: 'Quantity must be a whole number above 0' });
  }
  const reason = String((req.body || {}).reason || '').trim().slice(0, 255) || 'expired';
  const branchId = req.user.branch_id;
  const userId = req.user.sub;
  const batchId = req.params.batchId;

  // A write-off is a stock movement dated today — a closed today takes none.
  const writeOffDay = todayStr();
  if (await isDayClosed(pool, branchId, writeOffDay)) {
    return res.status(400).json({ status: 'error', message: dayClosedMessage(writeOffDay) });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [batches] = await conn.query(
      `SELECT b.id, b.medicine_id, b.batch_no, b.expiry_date, b.quantity_on_hand, b.purchase_price,
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
    // The loss in money: what those units cost (their batch cost price).
    const amount = Math.round(qty * Number(batch.purchase_price) * 100) / 100;
    auditLog(req, 'stock.write_off', 'medicine_batches', batchId, {
      summary: `Wrote off ${qty} of ${batch.medicine_name} (batch ${batch.batch_no}): ${reason} — ${amount} AFN`,
      medicine_name: batch.medicine_name, batch_no: batch.batch_no, quantity: qty, amount, reason,
    });
    return res.json({
      status: 'ok',
      medicine_name: batch.medicine_name,
      batch_no: batch.batch_no,
      quantity: qty,
      amount,
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
router.get('/write-offs', authRequired, requireRole('admin', 'pharmacist'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT st.created_at, st.quantity_change, st.reason,
              m.name AS medicine_name, b.batch_no, b.expiry_date,
              ROUND(ABS(st.quantity_change) * b.purchase_price, 2) AS amount,
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
