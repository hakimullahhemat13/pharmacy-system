// Approvals — the boss's review queue for child branches.
//
// A medicine or purchase entered in a child (non-main) branch waits in
// "pending" until the Main Branch admin accepts it: a pending medicine
// cannot be sold, and a pending purchase adds no stock. Rejecting sends
// the entry back to the branch with the boss's note, so it can be
// corrected and sent again (editing a rejected entry resubmits it).
//
// Sales cannot wait — the money and the medicine already changed hands
// — so instead each child branch's DAY waits for review: the day's
// summary (how many medicines sold, how many bought, revenue, profit)
// sits in the queue until the boss accepts it or sends it back. A day
// with no review row is pending; new activity on the day deletes the
// row again, so changed numbers always return for review.
//
// Only the Main Branch admin (the oldest branch's admin) may approve.
// Every decision is written to the audit log.
const express = require('express');
const { v4: uuidv4 } = require('uuid');

const pool = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');
const { auditLog } = require('../audit');
const { getMainBranchId, resetDayReview } = require('../mainBranch');
const { dayOf, isDayClosed, todayStr, dayClosedMessage } = require('../dayClose');

const router = express.Router();

const APPROVALS_MISSING_TABLE =
  'Approvals are not installed yet — run migration-approvals.sql, then restart the server';

function isMissingApprovals(err) {
  return !!err && (err.code === 'ER_NO_SUCH_TABLE' || err.code === 'ER_BAD_FIELD_ERROR');
}

function pad(n) { return String(n).padStart(2, '0'); }

function isValidDateString(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());
}

// The day after a YYYY-MM-DD date — the exclusive end of a one-day range.
function nextDayString(date) {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

// The rejection note is the whole point of sending an entry back: the
// branch must know what to correct, so it is required.
function validNote(body) {
  const note = String((body || {}).note || '').trim();
  if (!note) return { error: 'Write the reason — the branch needs to know what to correct' };
  if (note.length > 255) return { error: 'The reason must be 255 characters or fewer' };
  return { note };
}

// Only an admin of the Main Branch may approve. The check runs on every
// request, so moving a user to another branch revokes it at once.
async function requireMainAdmin(req, res, next) {
  try {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ status: 'error', message: 'You do not have permission for this' });
    }
    const mainId = await getMainBranchId(pool);
    if (req.user.branch_id !== mainId) {
      return res.status(403).json({
        status: 'error',
        message: 'Only the Main Branch admin can approve entries from other branches',
      });
    }
    return next();
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
}

// One day's summary for the review queue: sales net of that day's
// returns (the same convention as the reports), plus the day's approved
// purchases. Pending purchases are not counted — they have their own
// queue entries, and they land in the day's numbers when approved.
async function daySummary(branchId, date) {
  const end = nextDayString(date);
  const [salesRows] = await pool.query(
    `SELECT COUNT(*) AS sales_count,
            COALESCE(SUM(net_total), 0) AS revenue
     FROM sales
     WHERE branch_id = ? AND is_deleted = 0 AND voided_at IS NULL AND sale_date >= ? AND sale_date < ?`,
    [branchId, date, end]
  );
  const [itemRows] = await pool.query(
    `SELECT COALESCE(SUM(si.quantity), 0) AS items_sold,
            COALESCE(SUM(si.quantity * si.cost_price), 0) AS cost_total
     FROM sale_items si
     JOIN sales s ON s.id = si.sale_id
     WHERE s.branch_id = ? AND s.is_deleted = 0 AND s.voided_at IS NULL AND s.sale_date >= ? AND s.sale_date < ?`,
    [branchId, date, end]
  );
  const [retRows] = await pool.query(
    `SELECT COALESCE(SUM(sr.quantity_change), 0) AS qty,
            COALESCE(SUM(sr.quantity_change * si.unit_price * (CASE WHEN sv.total_amount > 0 THEN sv.net_total / sv.total_amount ELSE 0 END)), 0) AS value,
            COALESCE(SUM(sr.quantity_change * si.cost_price), 0) AS cost
     FROM stock_transactions sr
     JOIN sale_items si ON si.sale_id = sr.reference_id AND si.batch_id = sr.batch_id
     JOIN sales sv ON sv.id = sr.reference_id AND sv.voided_at IS NULL
     WHERE sr.branch_id = ? AND sr.type = 'sale_return' AND sr.created_at >= ? AND sr.created_at < ?`,
    [branchId, date, end]
  );
  // Bills and cost come from purchases alone: joining the items would
  // count one purchase's total once per item line.
  const [purchRows] = await pool.query(
    `SELECT COUNT(*) AS bills,
            COALESCE(SUM(total_amount), 0) AS cost
     FROM purchases
     WHERE branch_id = ? AND is_deleted = 0 AND approval_status = 'approved'
       AND purchase_date >= ? AND purchase_date < ?`,
    [branchId, date, end]
  );
  const [purchItemRows] = await pool.query(
    `SELECT COALESCE(SUM(pi.quantity), 0) AS items
     FROM purchase_items pi
     JOIN purchases p ON p.id = pi.purchase_id
     WHERE p.branch_id = ? AND p.is_deleted = 0 AND p.approval_status = 'approved'
       AND p.purchase_date >= ? AND p.purchase_date < ?`,
    [branchId, date, end]
  );
  // Goods sent back to a supplier on this day (valued on the return day,
  // the same convention as the reports): shown as their own line, so the
  // day's purchases and the reports always reconcile.
  const [purchRetRows] = await pool.query(
    `SELECT COALESCE(SUM(pr.quantity), 0) AS qty,
            COALESCE(SUM(pr.quantity * pr.unit_price), 0) AS value
     FROM purchase_returns pr
     JOIN purchases p ON p.id = pr.purchase_id
     WHERE p.branch_id = ? AND pr.is_deleted = 0 AND p.is_deleted = 0 AND p.approval_status = 'approved'
       AND pr.created_at >= ? AND pr.created_at < ?`,
    [branchId, date, end]
  );
  const revenue = Number(salesRows[0].revenue) - Number(retRows[0].value);
  const cost = Number(itemRows[0].cost_total) - Number(retRows[0].cost);
  return {
    sales_count: Number(salesRows[0].sales_count),
    items_sold: Number(itemRows[0].items_sold) - Number(retRows[0].qty),
    revenue,
    cost_total: cost,
    profit: revenue - cost,
    returns_total: Number(retRows[0].value),
    returned_items: Number(retRows[0].qty),
    purchase_bills: Number(purchRows[0].bills),
    items_bought: Number(purchItemRows[0].items),
    purchase_cost: Number(purchRows[0].cost),
    purchase_returns_total: Number(purchRetRows[0].value),
    purchase_returned_items: Number(purchRetRows[0].qty),
  };
}

// Days with real activity (a sale, or an approved purchase) for one
// branch, or for every branch but the main one. Each row carries its
// review state: no row in branch_day_reviews means "pending".
async function activityDays({ branchId = null, excludeMainId = null, limit = null } = {}) {
  const params = [];
  let where = '';
  if (branchId) {
    where = 'WHERE d.branch_id = ?';
    params.push(branchId);
  } else if (excludeMainId) {
    where = 'WHERE d.branch_id <> ?';
    params.push(excludeMainId);
  }
  const [rows] = await pool.query(
    `SELECT d.branch_id, d.day, b.name AS branch_name,
            r.status AS review_status, r.note AS review_note,
            r.reviewed_at AS reviewed_at, u.full_name AS reviewed_by_name
     FROM (
       SELECT branch_id, DATE(sale_date) AS day FROM sales
       WHERE is_deleted = 0 AND voided_at IS NULL
       GROUP BY branch_id, DATE(sale_date)
       UNION
       SELECT branch_id, DATE(purchase_date) AS day FROM purchases
       WHERE is_deleted = 0 AND approval_status = 'approved'
       GROUP BY branch_id, DATE(purchase_date)
       UNION
       SELECT branch_id, DATE(created_at) AS day FROM stock_transactions
       WHERE type IN ('sale_return', 'purchase_return')
       GROUP BY branch_id, DATE(created_at)
     ) d
     JOIN branches b ON b.id = d.branch_id
     LEFT JOIN branch_day_reviews r ON r.branch_id = d.branch_id AND r.review_date = d.day
     LEFT JOIN users u ON u.id = r.reviewed_by
     ${where}
     ORDER BY d.day ${branchId ? 'DESC' : 'ASC'}
     ${limit ? 'LIMIT ?' : ''}`,
    limit ? [...params, limit] : params
  );
  return rows.map((r) => ({
    branch_id: r.branch_id,
    branch_name: r.branch_name,
    date: dayOf(r.day),
    review_status: r.review_status || 'pending',
    review_note: r.review_note || null,
    reviewed_at: r.reviewed_at || null,
    reviewed_by_name: r.reviewed_by_name || null,
  }));
}

// GET /api/approvals/counts — the notification numbers. The Main admin
// gets the pending queue sizes; a child-branch user gets the counts of
// entries sent back to their branch for correction. Everyone else gets
// zeros. A missing migration degrades to zeros — the badge simply stays
// hidden until approvals are installed.
router.get('/counts', authRequired, async (req, res) => {
  try {
    const mainId = await getMainBranchId(pool);
    const isMainAdmin = req.user.role === 'admin' && req.user.branch_id === mainId;
    const counts = { medicines: 0, purchases: 0, days: 0, total: 0 };
    if (isMainAdmin) {
      const [[m]] = await pool.query(
        "SELECT COUNT(*) AS c FROM medicines WHERE is_deleted = 0 AND approval_status = 'pending' AND branch_id <> ?",
        [mainId]
      );
      const [[p]] = await pool.query(
        "SELECT COUNT(*) AS c FROM purchases WHERE is_deleted = 0 AND approval_status = 'pending' AND branch_id <> ?",
        [mainId]
      );
      const days = await activityDays({ excludeMainId: mainId });
      counts.medicines = Number(m.c);
      counts.purchases = Number(p.c);
      counts.days = days.filter((d) => d.review_status === 'pending').length;
    } else if (req.user.branch_id !== mainId) {
      const [[m]] = await pool.query(
        "SELECT COUNT(*) AS c FROM medicines WHERE branch_id = ? AND is_deleted = 0 AND approval_status = 'rejected'",
        [req.user.branch_id]
      );
      const [[p]] = await pool.query(
        "SELECT COUNT(*) AS c FROM purchases WHERE branch_id = ? AND is_deleted = 0 AND approval_status = 'rejected'",
        [req.user.branch_id]
      );
      const [[d]] = await pool.query(
        "SELECT COUNT(*) AS c FROM branch_day_reviews WHERE branch_id = ? AND status = 'rejected'",
        [req.user.branch_id]
      );
      counts.medicines = Number(m.c);
      counts.purchases = Number(p.c);
      counts.days = Number(d.c);
    }
    counts.total = counts.medicines + counts.purchases + counts.days;
    return res.json({ status: 'ok', is_main_admin: isMainAdmin, counts });
  } catch (err) {
    if (isMissingApprovals(err)) {
      return res.json({
        status: 'ok',
        is_main_admin: false,
        counts: { medicines: 0, purchases: 0, days: 0, total: 0 },
      });
    }
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

// GET /api/approvals/pending — the Main admin's queue, oldest first:
// waiting medicines, waiting purchases, and days waiting for review.
router.get('/pending', authRequired, requireMainAdmin, async (req, res) => {
  try {
    const mainId = await getMainBranchId(pool);
    const [medicines] = await pool.query(
      `SELECT m.id, m.branch_id, b.name AS branch_name, m.name, m.generic_name,
              m.company, m.barcode, m.unit, m.category, m.sale_price,
              m.min_stock, m.warn_months, m.created_at
       FROM medicines m
       JOIN branches b ON b.id = m.branch_id
       WHERE m.is_deleted = 0 AND m.approval_status = 'pending' AND m.branch_id <> ?
       ORDER BY m.created_at ASC`,
      [mainId]
    );
    const [purchases] = await pool.query(
      `SELECT p.id, p.branch_id, b.name AS branch_name, p.invoice_no,
              p.purchase_date, p.total_amount, p.paid_amount, p.notes,
              s.name AS supplier_name
       FROM purchases p
       JOIN branches b ON b.id = p.branch_id
       LEFT JOIN suppliers s ON s.id = p.supplier_id
       WHERE p.is_deleted = 0 AND p.approval_status = 'pending' AND p.branch_id <> ?
       ORDER BY p.purchase_date ASC, p.created_at ASC`,
      [mainId]
    );
    let items = [];
    if (purchases.length > 0) {
      const [itemRows] = await pool.query(
        `SELECT pi.purchase_id, m.name AS medicine_name, bt.batch_no,
                bt.expiry_date, pi.quantity, pi.purchase_price
         FROM purchase_items pi
         JOIN medicines m ON m.id = pi.medicine_id
         JOIN medicine_batches bt ON bt.id = pi.batch_id
         WHERE pi.purchase_id IN (?)
         ORDER BY pi.purchase_id`,
        [purchases.map((p) => p.id)]
      );
      items = itemRows;
    }
    const purchasesWithItems = purchases.map((p) => ({
      ...p,
      items: items.filter((it) => String(it.purchase_id) === String(p.id)),
    }));
    const days = await activityDays({ excludeMainId: mainId });
    const pendingDays = [];
    for (const d of days) {
      if (d.review_status !== 'pending') continue;
      pendingDays.push({ ...d, summary: await daySummary(d.branch_id, d.date) });
    }
    return res.json({ status: 'ok', medicines, purchases: purchasesWithItems, days: pendingDays });
  } catch (err) {
    if (isMissingApprovals(err)) {
      return res.status(400).json({ status: 'error', message: APPROVALS_MISSING_TABLE });
    }
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

// GET /api/approvals/my-branch — what a child branch needs to act on:
// its rejected entries (with the boss's notes) and its recent days with
// their review states. The Main Branch has nothing here — its entries
// never wait, and its days are never reviewed.
router.get('/my-branch', authRequired, requireRole('admin', 'pharmacist'), async (req, res) => {
  try {
    const mainId = await getMainBranchId(pool);
    if (req.user.branch_id === mainId) {
      return res.json({ status: 'ok', medicines: [], purchases: [], days: [] });
    }
    const [medicines] = await pool.query(
      `SELECT id, name, generic_name, company, barcode, sale_price, rejection_note
       FROM medicines
       WHERE branch_id = ? AND is_deleted = 0 AND approval_status = 'rejected'
       ORDER BY updated_at DESC`,
      [req.user.branch_id]
    );
    const [purchases] = await pool.query(
      `SELECT p.id, p.invoice_no, p.purchase_date, p.total_amount, p.rejection_note,
              s.name AS supplier_name
       FROM purchases p
       LEFT JOIN suppliers s ON s.id = p.supplier_id
       WHERE p.branch_id = ? AND p.is_deleted = 0 AND p.approval_status = 'rejected'
       ORDER BY p.updated_at DESC`,
      [req.user.branch_id]
    );
    const days = await activityDays({ branchId: req.user.branch_id, limit: 14 });
    const daysWithSummary = [];
    for (const d of days) {
      daysWithSummary.push({ ...d, summary: await daySummary(d.branch_id, d.date) });
    }
    return res.json({ status: 'ok', medicines, purchases, days: daysWithSummary });
  } catch (err) {
    if (isMissingApprovals(err)) {
      return res.status(400).json({ status: 'error', message: APPROVALS_MISSING_TABLE });
    }
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

// POST /api/approvals/medicines/:id/accept — the medicine becomes
// sellable at once. Only a waiting medicine can be accepted.
router.post('/medicines/:id/accept', authRequired, requireMainAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, name FROM medicines WHERE id = ? AND is_deleted = 0 AND approval_status = ? LIMIT 1',
      [req.params.id, 'pending']
    );
    if (!rows[0]) {
      return res.status(400).json({ status: 'error', message: 'This medicine is not waiting for approval' });
    }
    await pool.query(
      "UPDATE medicines SET approval_status = 'approved', rejection_note = NULL WHERE id = ?",
      [req.params.id]
    );
    auditLog(req, 'medicine.approved', 'medicines', req.params.id, {
      summary: `Medicine approved: ${rows[0].name}`,
      name: rows[0].name,
    });
    return res.json({ status: 'ok' });
  } catch (err) {
    if (isMissingApprovals(err)) {
      return res.status(400).json({ status: 'error', message: APPROVALS_MISSING_TABLE });
    }
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

// POST /api/approvals/medicines/:id/reject — Body: { note }. The entry
// goes back to its branch with the reason; editing it resubmits it.
router.post('/medicines/:id/reject', authRequired, requireMainAdmin, async (req, res) => {
  const checked = validNote(req.body);
  if (checked.error) {
    return res.status(400).json({ status: 'error', message: checked.error });
  }
  try {
    const [rows] = await pool.query(
      'SELECT id, name FROM medicines WHERE id = ? AND is_deleted = 0 AND approval_status = ? LIMIT 1',
      [req.params.id, 'pending']
    );
    if (!rows[0]) {
      return res.status(400).json({ status: 'error', message: 'This medicine is not waiting for approval' });
    }
    await pool.query(
      "UPDATE medicines SET approval_status = 'rejected', rejection_note = ? WHERE id = ?",
      [checked.note, req.params.id]
    );
    auditLog(req, 'medicine.rejected', 'medicines', req.params.id, {
      summary: `Medicine rejected: ${rows[0].name} — ${checked.note}`,
      name: rows[0].name,
      note: checked.note,
    });
    return res.json({ status: 'ok' });
  } catch (err) {
    if (isMissingApprovals(err)) {
      return res.status(400).json({ status: 'error', message: APPROVALS_MISSING_TABLE });
    }
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

// POST /api/approvals/purchases/:id/accept — the stock LANDS: every
// item's batch is topped up and a ledger row is written, in one
// transaction. A purchase whose medicine is still waiting cannot be
// accepted — the medicine comes first. The day's numbers change, so
// the day returns to "pending" review.
router.post('/purchases/:id/accept', authRequired, requireMainAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // FOR UPDATE locks this purchase row for the transaction, so two
    // concurrent accepts cannot both land the same stock.
    const [head] = await conn.query(
      'SELECT id, branch_id, invoice_no, purchase_date FROM purchases WHERE id = ? AND is_deleted = 0 AND approval_status = ? LIMIT 1 FOR UPDATE',
      [req.params.id, 'pending']
    );
    if (!head[0]) {
      await conn.rollback();
      return res.status(400).json({ status: 'error', message: 'This purchase is not waiting for approval' });
    }
    const purchase = head[0];
    // An accepted purchase lands stock and money on its purchase day
    // and writes ledger rows dated today — either day being closed
    // blocks the accept (same pattern as purchase PUT/DELETE).
    const purchaseDay = dayOf(purchase.purchase_date);
    const acceptDay = todayStr();
    const acceptClosedDay = (await isDayClosed(conn, purchase.branch_id, purchaseDay))
      ? purchaseDay
      : (await isDayClosed(conn, purchase.branch_id, acceptDay)) ? acceptDay : null;
    if (acceptClosedDay) {
      await conn.rollback();
      return res.status(400).json({ status: 'error', message: dayClosedMessage(acceptClosedDay) });
    }
    const [items] = await conn.query(
      `SELECT pi.medicine_id, pi.batch_id, pi.quantity, pi.purchase_price,
              m.name AS medicine_name, m.approval_status AS medicine_status,
              m.is_deleted AS medicine_deleted
       FROM purchase_items pi
       LEFT JOIN medicines m ON m.id = pi.medicine_id
       WHERE pi.purchase_id = ?`,
      [req.params.id]
    );
    for (const it of items) {
      if (!it.medicine_name || Number(it.medicine_deleted) === 1) {
        await conn.rollback();
        return res.status(400).json({
          status: 'error',
          message: 'This purchase names a medicine that no longer exists — reject it and let the branch correct it',
        });
      }
      if (it.medicine_status !== 'approved') {
        await conn.rollback();
        return res.status(400).json({
          status: 'error',
          message: `Approve the medicine first: ${it.medicine_name} is still waiting for approval`,
        });
      }
    }
    for (const it of items) {
      // The batch keeps one cost price: blend the new lot in at a
      // weighted average, so the units already on hand keep their cost.
      const [batchRows] = await conn.query(
        'SELECT quantity_on_hand, purchase_price FROM medicine_batches WHERE id = ? LIMIT 1 FOR UPDATE',
        [it.batch_id]
      );
      const oldQty = batchRows[0] ? Number(batchRows[0].quantity_on_hand) : 0;
      const oldPrice = batchRows[0] ? Number(batchRows[0].purchase_price) : 0;
      const newQty = Number(it.quantity);
      const newPrice = Number(it.purchase_price);
      const blended = oldQty + newQty > 0
        ? Math.round(((oldQty * oldPrice + newQty * newPrice) / (oldQty + newQty)) * 100) / 100
        : newPrice;
      await conn.query(
        'UPDATE medicine_batches SET quantity_on_hand = quantity_on_hand + ?, purchase_price = ? WHERE id = ?',
        [newQty, blended, it.batch_id]
      );
      await conn.query(
        "INSERT INTO stock_transactions (id, branch_id, medicine_id, batch_id, type, quantity_change, reference_id, created_by) VALUES (?, ?, ?, ?, 'purchase', ?, ?, ?)",
        [uuidv4(), purchase.branch_id, it.medicine_id, it.batch_id, Number(it.quantity), purchase.id, req.user.sub]
      );
    }
    await conn.query(
      "UPDATE purchases SET approval_status = 'approved', rejection_note = NULL WHERE id = ?",
      [req.params.id]
    );
    await conn.commit();
    // Awaited: the day must already be pending again when this
    // response returns (see the same hook in sales.js).
    await resetDayReview(pool, purchase.branch_id, dayOf(purchase.purchase_date)).catch((err) => console.error('resetDayReview failed:', err.message));
    auditLog(req, 'purchase.approved', 'purchases', req.params.id, {
      summary: `Purchase approved: ${purchase.invoice_no || purchase.id}`,
      invoice_no: purchase.invoice_no,
    });
    return res.json({ status: 'ok' });
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* already rolled back */ }
    if (isMissingApprovals(err)) {
      return res.status(400).json({ status: 'error', message: APPROVALS_MISSING_TABLE });
    }
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  } finally {
    conn.release();
  }
});

// POST /api/approvals/purchases/:id/reject — Body: { note }. No stock
// ever moved for a waiting purchase, so rejecting only marks it.
router.post('/purchases/:id/reject', authRequired, requireMainAdmin, async (req, res) => {
  const checked = validNote(req.body);
  if (checked.error) {
    return res.status(400).json({ status: 'error', message: checked.error });
  }
  try {
    const [rows] = await pool.query(
      'SELECT id, invoice_no FROM purchases WHERE id = ? AND is_deleted = 0 AND approval_status = ? LIMIT 1',
      [req.params.id, 'pending']
    );
    if (!rows[0]) {
      return res.status(400).json({ status: 'error', message: 'This purchase is not waiting for approval' });
    }
    await pool.query(
      "UPDATE purchases SET approval_status = 'rejected', rejection_note = ? WHERE id = ?",
      [checked.note, req.params.id]
    );
    auditLog(req, 'purchase.rejected', 'purchases', req.params.id, {
      summary: `Purchase rejected: ${rows[0].invoice_no || req.params.id} — ${checked.note}`,
      invoice_no: rows[0].invoice_no,
      note: checked.note,
    });
    return res.json({ status: 'ok' });
  } catch (err) {
    if (isMissingApprovals(err)) {
      return res.status(400).json({ status: 'error', message: APPROVALS_MISSING_TABLE });
    }
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

async function reviewBranchDay(req, res, status) {
  const body = req.body || {};
  const branchId = String(body.branch_id || '');
  const date = String(body.date || '');
  if (!branchId || !isValidDateString(date)) {
    return res.status(400).json({ status: 'error', message: 'Give a branch and a date (YYYY-MM-DD)' });
  }
  let note = null;
  if (status === 'rejected') {
    const checked = validNote(body);
    if (checked.error) {
      return res.status(400).json({ status: 'error', message: checked.error });
    }
    note = checked.note;
  }
  try {
    const mainId = await getMainBranchId(pool);
    if (branchId === mainId) {
      return res.status(400).json({ status: 'error', message: 'The Main Branch day is not reviewed — it is the reviewer' });
    }
    const [branches] = await pool.query(
      'SELECT id, name FROM branches WHERE id = ? AND is_deleted = 0 LIMIT 1',
      [branchId]
    );
    if (!branches[0]) {
      return res.status(404).json({ status: 'error', message: 'Branch not found' });
    }
    await pool.query(
      `INSERT INTO branch_day_reviews (id, branch_id, review_date, status, note, reviewed_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE status = VALUES(status), note = VALUES(note),
         reviewed_by = VALUES(reviewed_by), reviewed_at = NOW()`,
      [uuidv4(), branchId, date, status, note, req.user.sub]
    );
    auditLog(req, status === 'accepted' ? 'dayreview.accepted' : 'dayreview.rejected', 'branch_day_reviews', null, {
      summary:
        status === 'accepted'
          ? `Day ${date} of ${branches[0].name} accepted`
          : `Day ${date} of ${branches[0].name} rejected — ${note}`,
      branch_id: branchId,
      branch_name: branches[0].name,
      date,
      note,
    });
    return res.json({ status: 'ok' });
  } catch (err) {
    if (isMissingApprovals(err)) {
      return res.status(400).json({ status: 'error', message: APPROVALS_MISSING_TABLE });
    }
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
}

// POST /api/approvals/days/accept — Body: { branch_id, date }.
// POST /api/approvals/days/reject — Body: { branch_id, date, note }.
router.post('/days/accept', authRequired, requireMainAdmin, (req, res) => reviewBranchDay(req, res, 'accepted'));
router.post('/days/reject', authRequired, requireMainAdmin, (req, res) => reviewBranchDay(req, res, 'rejected'));

// POST /api/approvals/days/resubmit — Body: { branch_id, date }. A user
// of the branch sends a REJECTED day back for review after correcting
// it. An accepted day can never be un-accepted from here — the boss's
// decision stands unless new activity reopens the day.
router.post('/days/resubmit', authRequired, requireRole('admin', 'pharmacist'), async (req, res) => {
  const body = req.body || {};
  const branchId = String(body.branch_id || '');
  const date = String(body.date || '');
  if (!branchId || !isValidDateString(date)) {
    return res.status(400).json({ status: 'error', message: 'Give a branch and a date (YYYY-MM-DD)' });
  }
  if (branchId !== req.user.branch_id) {
    return res.status(403).json({ status: 'error', message: 'You can only resubmit your own branch day' });
  }
  try {
    const [rows] = await pool.query(
      'SELECT id, status FROM branch_day_reviews WHERE branch_id = ? AND review_date = ? LIMIT 1',
      [branchId, date]
    );
    if (rows[0] && rows[0].status === 'accepted') {
      return res.status(400).json({ status: 'error', message: 'This day was already accepted' });
    }
    if (rows[0]) {
      await pool.query('DELETE FROM branch_day_reviews WHERE id = ?', [rows[0].id]);
    }
    auditLog(req, 'dayreview.resubmitted', 'branch_day_reviews', rows[0] ? rows[0].id : null, {
      summary: `Day ${date} sent back for review`,
      branch_id: branchId,
      date,
    });
    return res.json({ status: 'ok' });
  } catch (err) {
    if (isMissingApprovals(err)) {
      return res.status(400).json({ status: 'error', message: APPROVALS_MISSING_TABLE });
    }
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

module.exports = router;
