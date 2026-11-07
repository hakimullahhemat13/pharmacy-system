// Stock routes — read-only views over medicine_batches.
// GET /api/stock                     current stock per medicine (with batch detail)
// GET /api/stock/expiring?months=3   batches expiring within N months (default 3),
//                                    plus already-expired ones that still have stock.
//                                    This is the data behind the expiry warnings.
const express = require('express');

const pool = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

router.get('/', authRequired, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT m.id AS medicine_id, m.name, m.generic_name, m.company, m.barcode, m.unit, m.category, m.sale_price, m.min_stock, m.created_at,
              COALESCE(SUM(b.quantity_on_hand), 0) AS total_quantity,
              COUNT(b.id) AS batch_count
       FROM medicines m
       LEFT JOIN medicine_batches b
         ON b.medicine_id = m.id AND b.branch_id = m.branch_id AND b.is_deleted = 0
       WHERE m.branch_id = ? AND m.is_deleted = 0
       GROUP BY m.id, m.name, m.generic_name, m.company, m.barcode, m.unit, m.category, m.sale_price, m.min_stock, m.created_at
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

router.get('/expiring', authRequired, async (req, res) => {
  const monthsRaw = req.query.months === undefined ? 3 : Number(req.query.months);
  const months = Number.isInteger(monthsRaw) && monthsRaw >= 0 && monthsRaw <= 24 ? monthsRaw : 3;
  try {
    const [rows] = await pool.query(
      `SELECT b.id AS batch_id, b.batch_no, b.expiry_date, b.quantity_on_hand, b.purchase_price,
              m.id AS medicine_id, m.name AS medicine_name, m.barcode,
              DATEDIFF(b.expiry_date, CURDATE()) AS days_remaining
       FROM medicine_batches b
       JOIN medicines m ON m.id = b.medicine_id
       WHERE b.branch_id = ? AND b.is_deleted = 0 AND m.is_deleted = 0 AND b.quantity_on_hand > 0
         AND b.expiry_date <= DATE_ADD(CURDATE(), INTERVAL ? MONTH)
       ORDER BY b.expiry_date ASC`,
      [req.user.branch_id, months]
    );
    const batches = rows.map((r) => ({
      ...r,
      level: r.days_remaining < 0 ? 'expired' : r.days_remaining <= 30 ? 'critical' : 'warning',
    }));
    return res.json({ status: 'ok', months, batches });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

module.exports = router;
