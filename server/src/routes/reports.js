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
     JOIN sales sv ON sv.id = sr.reference_id AND sv.voided_at IS NULL
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
     WHERE branch_id = ? AND is_deleted = 0 AND voided_at IS NULL AND sale_date >= ? AND sale_date < ?`,
    [branchId, start, end]
  );
  const [itemRows] = await pool.query(
    `SELECT COALESCE(SUM(si.quantity), 0) AS items_sold,
            COALESCE(SUM(si.quantity * si.cost_price), 0) AS cost_total
     FROM sale_items si
     JOIN sales s ON s.id = si.sale_id
     WHERE s.branch_id = ? AND s.is_deleted = 0 AND s.voided_at IS NULL AND s.sale_date >= ? AND s.sale_date < ?`,
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
       WHERE s.branch_id = ? AND s.is_deleted = 0 AND s.voided_at IS NULL AND s.sale_date >= ? AND s.sale_date < ?
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
       WHERE s.branch_id = ? AND s.is_deleted = 0 AND s.voided_at IS NULL AND s.sale_date >= ? AND s.sale_date < ?
       GROUP BY DATE_FORMAT(s.sale_date, '%Y-%m-%d')
       ORDER BY day ASC`,
      [req.user.branch_id, start, end]
    );
    const [retDays] = await pool.query(
      `SELECT DATE_FORMAT(sr.created_at, '%Y-%m-%d') AS day,
              COALESCE(SUM(sr.quantity_change * si.unit_price), 0) AS value,
              COALESCE(SUM(sr.quantity_change * si.cost_price), 0) AS cost
       FROM stock_transactions sr
       JOIN sale_items si ON si.sale_id = sr.reference_id AND si.batch_id = sr.batch_id
       JOIN sales sv ON sv.id = sr.reference_id AND sv.voided_at IS NULL
       WHERE sr.branch_id = ? AND sr.type = 'sale_return' AND sr.created_at >= ? AND sr.created_at < ?
       GROUP BY DATE_FORMAT(sr.created_at, '%Y-%m-%d')`,
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
       WHERE s.branch_id = ? AND s.is_deleted = 0 AND s.voided_at IS NULL AND s.sale_date >= ? AND s.sale_date < ?
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
       JOIN sales sv ON sv.id = sr.reference_id AND sv.voided_at IS NULL
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

// GET /api/reports/export?period=daily|monthly|yearly&date=&year=&month=
// The same numbers the Reports page shows, as a real .xlsx download: a
// Summary sheet plus the period's detail rows (bills / days / months).
// exceljs is required lazily so a server without the package still runs —
// only this endpoint fails, and its message carries the install command.
// The breakdown merges below intentionally mirror /monthly and /yearly.
router.get('/export', authRequired, async (req, res) => {
  let ExcelJS;
  try {
    ExcelJS = require('exceljs');
  } catch (_) {
    return res.status(500).json({
      status: 'error',
      message: 'Excel export is not installed on the server — in the server folder run: npm install',
    });
  }

  const branchId = req.user.branch_id;
  const period = ['daily', 'monthly', 'yearly'].includes(String(req.query.period))
    ? String(req.query.period)
    : 'daily';

  let start;
  let end;
  let label;
  let filename;
  if (period === 'daily') {
    const date = req.query.date === undefined ? fmtDate(new Date()) : String(req.query.date);
    if (!isValidDateString(date)) {
      return res.status(400).json({ status: 'error', message: 'date must be YYYY-MM-DD' });
    }
    const next = new Date(`${date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    end = `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
    start = date;
    label = `Daily — ${date}`;
    filename = `pharmacy-report-daily-${date}.xlsx`;
  } else if (period === 'monthly') {
    const now = new Date();
    const year = req.query.year === undefined ? now.getFullYear() : Number(req.query.year);
    const month = req.query.month === undefined ? now.getMonth() + 1 : Number(req.query.month);
    if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
      return res.status(400).json({ status: 'error', message: 'Give a valid year and month (1-12)' });
    }
    start = `${year}-${pad(month)}-01`;
    end = month === 12 ? `${year + 1}-01-01` : `${year}-${pad(month + 1)}-01`;
    label = `Monthly — ${year}-${pad(month)}`;
    filename = `pharmacy-report-monthly-${year}-${pad(month)}.xlsx`;
  } else {
    const now = new Date();
    const year = req.query.year === undefined ? now.getFullYear() : Number(req.query.year);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return res.status(400).json({ status: 'error', message: 'Give a valid year' });
    }
    start = `${year}-01-01`;
    end = `${year + 1}-01-01`;
    label = `Yearly — ${year}`;
    filename = `pharmacy-report-yearly-${year}.xlsx`;
  }

  try {
    const summary = await summaryForRange(branchId, start, end);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Pharmacy System';
    wb.created = new Date();

    const ws = wb.addWorksheet('Summary');
    ws.columns = [{ width: 24 }, { width: 20 }];
    const title = ws.addRow(['Pharmacy report', label]);
    title.font = { bold: true, size: 14 };
    ws.addRow([]);
    const pairs = [
      ['Bills', summary.sales_count, '#,##0'],
      ['Items sold', summary.items_sold, '#,##0'],
      ['Revenue (AFN)', summary.revenue, '#,##0.00'],
      ['Cost (AFN)', summary.cost_total, '#,##0.00'],
      ['Profit (AFN)', summary.profit, '#,##0.00'],
      ['Returns (AFN)', summary.returns_total, '#,##0.00'],
      ['Returned items', summary.returned_items, '#,##0'],
      ['Discount (AFN)', summary.discount_total, '#,##0.00'],
    ];
    for (const [name, value, fmt] of pairs) {
      const row = ws.addRow([name, value]);
      row.getCell(1).font = { bold: true };
      row.getCell(2).numFmt = fmt;
    }

    const styleHeader = (sheet) => {
      sheet.getRow(1).font = { bold: true };
      sheet.views = [{ state: 'frozen', ySplit: 1 }];
    };

    if (period === 'daily') {
      const [sales] = await pool.query(
        `SELECT s.invoice_no, s.sale_date, s.total_amount, s.discount, s.net_total,
                c.name AS customer_name
         FROM sales s
         LEFT JOIN customers c ON c.id = s.customer_id
         WHERE s.branch_id = ? AND s.is_deleted = 0 AND s.voided_at IS NULL AND s.sale_date >= ? AND s.sale_date < ?
         ORDER BY s.sale_date ASC`,
        [branchId, start, end]
      );
      const sh = wb.addWorksheet('Bills');
      sh.columns = [
        { width: 16 }, { width: 20 }, { width: 22 }, { width: 14 }, { width: 14 }, { width: 14 },
      ];
      sh.addRow(['Invoice', 'Date', 'Customer', 'Total (AFN)', 'Discount (AFN)', 'Net (AFN)']);
      for (const s of sales) {
        sh.addRow([
          s.invoice_no,
          new Date(s.sale_date),
          s.customer_name || 'Walk-in customer',
          Number(s.total_amount),
          Number(s.discount),
          Number(s.net_total),
        ]);
      }
      sh.getColumn(2).numFmt = 'yyyy-mm-dd hh:mm';
      for (const col of [4, 5, 6]) sh.getColumn(col).numFmt = '#,##0.00';
      styleHeader(sh);
    } else if (period === 'monthly') {
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
         WHERE s.branch_id = ? AND s.is_deleted = 0 AND s.voided_at IS NULL AND s.sale_date >= ? AND s.sale_date < ?
         GROUP BY DATE_FORMAT(s.sale_date, '%Y-%m-%d')
         ORDER BY day ASC`,
        [branchId, start, end]
      );
      const [retDays] = await pool.query(
        `SELECT DATE_FORMAT(sr.created_at, '%Y-%m-%d') AS day,
                COALESCE(SUM(sr.quantity_change * si.unit_price), 0) AS value,
                COALESCE(SUM(sr.quantity_change * si.cost_price), 0) AS cost
         FROM stock_transactions sr
         JOIN sale_items si ON si.sale_id = sr.reference_id AND si.batch_id = sr.batch_id
         JOIN sales sv ON sv.id = sr.reference_id AND sv.voided_at IS NULL
         WHERE sr.branch_id = ? AND sr.type = 'sale_return' AND sr.created_at >= ? AND sr.created_at < ?
         GROUP BY DATE_FORMAT(sr.created_at, '%Y-%m-%d')`,
        [branchId, start, end]
      );
      const retByDay = new Map(retDays.map((r) => [String(r.day), { value: Number(r.value), cost: Number(r.cost) }]));
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
      for (const [key, ret] of retByDay) {
        byDayMap.set(key, { day: key, sales_count: 0, revenue: -ret.value, cost_total: -ret.cost });
      }
      const byDay = [...byDayMap.values()].sort((a, b) => String(a.day).localeCompare(String(b.day)));
      const sh = wb.addWorksheet('Days');
      sh.columns = [{ width: 14 }, { width: 10 }, { width: 16 }, { width: 16 }, { width: 16 }];
      sh.addRow(['Date', 'Bills', 'Revenue (AFN)', 'Cost (AFN)', 'Profit (AFN)']);
      for (const d of byDay) {
        sh.addRow([String(d.day), d.sales_count, d.revenue, d.cost_total, d.revenue - d.cost_total]);
      }
      for (const col of [3, 4, 5]) sh.getColumn(col).numFmt = '#,##0.00';
      styleHeader(sh);
    } else {
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
         WHERE s.branch_id = ? AND s.is_deleted = 0 AND s.voided_at IS NULL AND s.sale_date >= ? AND s.sale_date < ?
         GROUP BY MONTH(s.sale_date)
         ORDER BY month ASC`,
        [branchId, start, end]
      );
      const [retMonths] = await pool.query(
        `SELECT MONTH(sr.created_at) AS month,
                COALESCE(SUM(sr.quantity_change * si.unit_price), 0) AS value,
                COALESCE(SUM(sr.quantity_change * si.cost_price), 0) AS cost
         FROM stock_transactions sr
         JOIN sale_items si ON si.sale_id = sr.reference_id AND si.batch_id = sr.batch_id
         JOIN sales sv ON sv.id = sr.reference_id AND sv.voided_at IS NULL
         WHERE sr.branch_id = ? AND sr.type = 'sale_return' AND sr.created_at >= ? AND sr.created_at < ?
         GROUP BY MONTH(sr.created_at)`,
        [branchId, start, end]
      );
      const retByMonth = new Map(retMonths.map((r) => [Number(r.month), { value: Number(r.value), cost: Number(r.cost) }]));
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
      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      const byMonth = [...byMonthMap.values()].sort((a, b) => a.month - b.month);
      const sh = wb.addWorksheet('Months');
      sh.columns = [{ width: 14 }, { width: 10 }, { width: 16 }, { width: 16 }, { width: 16 }];
      sh.addRow(['Month', 'Bills', 'Revenue (AFN)', 'Cost (AFN)', 'Profit (AFN)']);
      for (const m of byMonth) {
        sh.addRow([monthNames[m.month - 1] || m.month, m.sales_count, m.revenue, m.cost_total, m.revenue - m.cost_total]);
      }
      for (const col of [3, 4, 5]) sh.getColumn(col).numFmt = '#,##0.00';
      styleHeader(sh);
    }

    const buffer = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(Buffer.from(buffer));
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

module.exports = router;
