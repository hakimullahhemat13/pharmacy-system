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
  const revenue = Number(salesRows[0].revenue);
  const cost = Number(itemRows[0].cost_total);
  return {
    sales_count: Number(salesRows[0].sales_count),
    items_sold: Number(itemRows[0].items_sold),
    revenue,
    discount_total: Number(salesRows[0].discount_total),
    cost_total: cost,
    profit: revenue - cost,
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
      `SELECT DATE(s.sale_date) AS day,
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
    const byDay = days.map((d) => ({
      day: d.day,
      sales_count: Number(d.sales_count),
      revenue: Number(d.revenue),
      cost_total: Number(d.cost_total || 0),
      profit: Number(d.revenue) - Number(d.cost_total || 0),
    }));
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
    const byMonth = months.map((m) => ({
      month: Number(m.month),
      sales_count: Number(m.sales_count),
      revenue: Number(m.revenue),
      cost_total: Number(m.cost_total || 0),
      profit: Number(m.revenue) - Number(m.cost_total || 0),
    }));
    return res.json({ status: 'ok', year, summary, months: byMonth });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

module.exports = router;
