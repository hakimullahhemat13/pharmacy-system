// Report routes — read-only summaries over sales.
// Profit = revenue (net_total, i.e. after discount) − cost of goods sold,
// where each sale item carries the cost_price snapshot from its batch, so
// reports stay correct even if purchase prices change later.
//   GET /api/reports/daily?date=YYYY-MM-DD     (default: today)
//   GET /api/reports/monthly?year=YYYY&month=M (default: current month)
//   GET /api/reports/yearly?year=YYYY          (default: current year)
const express = require('express');

const pool = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

function pad(n) { return String(n).padStart(2, '0'); }
function fmtDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function isValidDateString(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());
}

// Returns in a period, valued at the original sale's prices: each
// 'sale_return' ledger row joins back to its sale_items row (same sale,
// same batch) for the unit_price / cost_price snapshot. Returns are counted
// on the day the return happened (the ledger row's created_at), not the
// sale day — the refund leaves the till that day.
async function returnsForRange(branchId, start, end) {
  const [rows] = await pool.query(
    `SELECT COALESCE(SUM(sr.quantity_change), 0) AS qty,
            COALESCE(SUM(sr.quantity_change * si.unit_price), 0) AS value,
            COALESCE(SUM(sr.quantity_change * si.cost_price), 0) AS cost
     FROM stock_transactions sr
     JOIN sale_items si ON si.sale_id = sr.reference_id AND si.batch_id = sr.batch_id
     WHERE sr.branch_id = ? AND sr.type = 'sale_return' AND sr.created_at >= ? AND sr.created_at < ?`,
    [branchId, start, end]
  );
  return { qty: Number(rows[0].qty), value: Number(rows[0].value), cost: Number(rows[0].cost) };
}

async function summaryForRange(branchId, start, end) {
  const [salesRows] = await pool.query(
    `SELECT COUNT(*) AS sales_count,
            COALESCE(SUM(net_total), 0) AS revenue,
            COALESCE(SUM(discount), 0) AS discount_total
     FROM sales
     WHERE branch_id = ? AND is_deleted = 0 AND sale_date >= ? AND sale_date < ?`,
    [branchId, start, end]
  );
  const [itemRows] = await pool.query(
    `SELECT COALESCE(SUM(si.quantity), 0) AS items_sold,
            COALESCE(SUM(si.quantity * si.cost_price), 0) AS cost_total
     FROM sale_items si
     JOIN sales s ON s.id = si.sale_id
     WHERE s.branch_id = ? AND s.is_deleted = 0 AND s.sale_date >= ? AND s.sale_date < ?`,
    [branchId, start, end]
  );
  const ret = await returnsForRange(branchId, start, end);
  const revenue = Number(salesRows[0].revenue) - ret.value;
  const cost = Number(itemRows[0].cost_total) - ret.cost;
  return {
    sales_count: Number(salesRows[0].sales_count),
    items_sold: Number(itemRows[0].items_sold) - ret.qty,
    revenue,
    discount_total: Number(salesRows[0].discount_total),
    cost_total: cost,
    profit: revenue - cost,
    returns_total: ret.value,
    returned_items: ret.qty,
  };
}

// GET /api/reports/daily?date=YYYY-MM-DD
router.get('/daily', authRequired, async (req, res) => {
  const date = req.query.date === undefined ? fmtDate(new Date()) : String(req.query.date);
  if (!isValidDateString(date)) {
    return res.status(400).json({ status: 'error', message: 'date must be YYYY-MM-DD' });
  }
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const end = `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
  try {
    const summary = await summaryForRange(req.user.branch_id, date, end);
    const [sales] = await pool.query(
      `SELECT s.id, s.invoice_no, s.sale_date, s.total_amount, s.discount, s.net_total,
              c.name AS customer_name
       FROM sales s
       LEFT JOIN customers c ON c.id = s.customer_id
       WHERE s.branch_id = ? AND s.is_deleted = 0 AND s.sale_date >= ? AND s.sale_date < ?
       ORDER BY s.sale_date ASC`,
      [req.user.branch_id, date, end]
    );
    return res.json({ status: 'ok', date, summary, sales });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

// GET /api/reports/monthly?year=YYYY&month=M  (month 1-12)
router.get('/monthly', authRequired, async (req, res) => {
  const now = new Date();
  const year = req.query.year === undefined ? now.getFullYear() : Number(req.query.year);
  const month = req.query.month === undefined ? now.getMonth() + 1 : Number(req.query.month);
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
    return res.status(400).json({ status: 'error', message: 'Give a valid year and month (1-12)' });
  }
  const start = `${year}-${pad(month)}-01`;
  const end = month === 12 ? `${year + 1}-01-01` : `${year}-${pad(month + 1)}-01`;
  try {
    const summary = await summaryForRange(req.user.branch_id, start, end);
    const [days] = await pool.query(
      `SELECT DATE_FORMAT(s.sale_date, '%Y-%m-%d') AS day,
              COUNT(*) AS sales_count,
              COALESCE(SUM(s.net_total), 0) AS revenue,
              COALESCE(SUM(si.cost), 0) AS cost_total
       FROM sales s
       LEFT JOIN (
         SELECT sale_id, SUM(quantity * cost_price) AS cost
         FROM sale_items GROUP BY sale_id
       ) si ON si.sale_id = s.id
       WHERE s.branch_id = ? AND s.is_deleted = 0 AND s.sale_date >= ? AND s.sale_date < ?
       GROUP BY DATE(s.sale_date)
       ORDER BY day ASC`,
      [req.user.branch_id, start, end]
    );
    const [retDays] = await pool.query(
      `SELECT DATE_FORMAT(sr.created_at, '%Y-%m-%d') AS day,
              COALESCE(SUM(sr.quantity_change * si.unit_price), 0) AS value,
              COALESCE(SUM(sr.quantity_change * si.cost_price), 0) AS cost
       FROM stock_transactions sr
       JOIN sale_items si ON si.sale_id = sr.reference_id AND si.batch_id = sr.batch_id
       WHERE sr.branch_id = ? AND sr.type = 'sale_return' AND sr.created_at >= ? AND sr.created_at < ?
       GROUP BY DATE(sr.created_at)`,
      [req.user.branch_id, start, end]
    );
    const retByDay = new Map(
      retDays.map((r) => [String(r.day), { value: Number(r.value), cost: Number(r.cost) }])
    );
    const byDayMap = new Map();
    for (const d of days) {
      const key = String(d.day);
      const ret = retByDay.get(key) || { value: 0, cost: 0 };
      byDayMap.set(key, {
        day: d.day,
        sales_count: Number(d.sales_count),
        revenue: Number(d.revenue) - ret.value,
        cost_total: Number(d.cost_total || 0) - ret.cost,
      });
      retByDay.delete(key);
    }
    // A day can have returns but no sales — it still belongs in the table.
    for (const [key, ret] of retByDay) {
      byDayMap.set(key, { day: key, sales_count: 0, revenue: -ret.value, cost_total: -ret.cost });
    }
    const byDay = [...byDayMap.values()]
      .sort((a, b) => String(a.day).localeCompare(String(b.day)))
      .map((d) => ({ ...d, profit: d.revenue - d.cost_total }));
    return res.json({ status: 'ok', year, month, summary, days: byDay });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

// GET /api/reports/yearly?year=YYYY
router.get('/yearly', authRequired, async (req, res) => {
  const now = new Date();
  const year = req.query.year === undefined ? now.getFullYear() : Number(req.query.year);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return res.status(400).json({ status: 'error', message: 'Give a valid year' });
  }
  const start = `${year}-01-01`;
  const end = `${year + 1}-01-01`;
  try {
    const summary = await summaryForRange(req.user.branch_id, start, end);
    const [months] = await pool.query(
      `SELECT MONTH(s.sale_date) AS month,
              COUNT(*) AS sales_count,
              COALESCE(SUM(s.net_total), 0) AS revenue,
              COALESCE(SUM(si.cost), 0) AS cost_total
       FROM sales s
       LEFT JOIN (
         SELECT sale_id, SUM(quantity * cost_price) AS cost
         FROM sale_items GROUP BY sale_id
       ) si ON si.sale_id = s.id
       WHERE s.branch_id = ? AND s.is_deleted = 0 AND s.sale_date >= ? AND s.sale_date < ?
       GROUP BY MONTH(s.sale_date)
       ORDER BY month ASC`,
      [req.user.branch_id, start, end]
    );
    const [retMonths] = await pool.query(
      `SELECT MONTH(sr.created_at) AS month,
              COALESCE(SUM(sr.quantity_change * si.unit_price), 0) AS value,
              COALESCE(SUM(sr.quantity_change * si.cost_price), 0) AS cost
       FROM stock_transactions sr
       JOIN sale_items si ON si.sale_id = sr.reference_id AND si.batch_id = sr.batch_id
       WHERE sr.branch_id = ? AND sr.type = 'sale_return' AND sr.created_at >= ? AND sr.created_at < ?
       GROUP BY MONTH(sr.created_at)`,
      [req.user.branch_id, start, end]
    );
    const retByMonth = new Map(
      retMonths.map((r) => [Number(r.month), { value: Number(r.value), cost: Number(r.cost) }])
    );
    const byMonthMap = new Map();
    for (const m of months) {
      const key = Number(m.month);
      const ret = retByMonth.get(key) || { value: 0, cost: 0 };
      byMonthMap.set(key, {
        month: key,
        sales_count: Number(m.sales_count),
        revenue: Number(m.revenue) - ret.value,
        cost_total: Number(m.cost_total || 0) - ret.cost,
      });
      retByMonth.delete(key);
    }
    for (const [key, ret] of retByMonth) {
      byMonthMap.set(key, { month: key, sales_count: 0, revenue: -ret.value, cost_total: -ret.cost });
    }
    const byMonth = [...byMonthMap.values()]
      .sort((a, b) => a.month - b.month)
      .map((m) => ({ ...m, profit: m.revenue - m.cost_total }));
    return res.json({ status: 'ok', year, summary, months: byMonth });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

module.exports = router;
