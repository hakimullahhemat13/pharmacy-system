// Medicine routes — add (keyboard or barcode scanner), list, search, barcode lookup
// Every route requires login. The branch always comes from the user's token,
// never from the request body, so one branch can never touch another's data.
const express = require('express');
const { v4: uuidv4 } = require('uuid');

const pool = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');

const router = express.Router();

const COLUMNS =
  'id, branch_id, name, generic_name, company, barcode, unit, category, sale_price, min_stock, created_at, updated_at';

// POST /api/medicines  (admin or pharmacist)
// Body: { name, generic_name?, company?, barcode?, unit?, category?, sale_price?, min_stock? }
// A barcode scanner simply "types" the barcode into the barcode field —
// the same endpoint serves keyboard entry and scanner entry.
router.post('/', authRequired, requireRole('admin', 'pharmacist'), async (req, res) => {
  const body = req.body || {};
  const name = String(body.name || '').trim();
  if (!name) {
    return res.status(400).json({ status: 'error', message: 'Medicine name is required' });
  }

  const genericName = body.generic_name ? String(body.generic_name).trim() : null;
  const company = body.company ? String(body.company).trim() : null;
  const barcode = body.barcode ? String(body.barcode).trim() : null;
  const unit = body.unit ? String(body.unit).trim() : 'tablet';
  const category = body.category ? String(body.category).trim() : null;

  const salePrice = body.sale_price === undefined || body.sale_price === null ? 0 : Number(body.sale_price);
  if (!Number.isFinite(salePrice) || salePrice < 0) {
    return res.status(400).json({ status: 'error', message: 'Sale price must be a number, 0 or more' });
  }
  const minStock = body.min_stock === undefined || body.min_stock === null ? 10 : Number(body.min_stock);
  if (!Number.isInteger(minStock) || minStock < 0) {
    return res.status(400).json({ status: 'error', message: 'Minimum stock must be a whole number, 0 or more' });
  }

  const branchId = req.user.branch_id;

  try {
    if (barcode) {
      const [dup] = await pool.query(
        'SELECT id, name FROM medicines WHERE branch_id = ? AND barcode = ? AND is_deleted = 0 LIMIT 1',
        [branchId, barcode]
      );
      if (dup.length > 0) {
        return res.status(409).json({
          status: 'error',
          message: `This barcode is already registered to: ${dup[0].name}`,
          medicine: dup[0],
        });
      }
    }

    const id = uuidv4();
    await pool.query(
      'INSERT INTO medicines (id, branch_id, name, generic_name, company, barcode, unit, category, sale_price, min_stock) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, branchId, name, genericName, company, barcode, unit, category, salePrice, minStock]
    );
    const [rows] = await pool.query(`SELECT ${COLUMNS} FROM medicines WHERE id = ? LIMIT 1`, [id]);
    return res.status(201).json({ status: 'ok', medicine: rows[0] });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ status: 'error', message: 'This barcode is already registered in this branch' });
    }
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

// GET /api/medicines            — list for the user's branch
// GET /api/medicines?q=text     — search name / generic name / barcode (partial match)
// GET /api/medicines?barcode=X  — exact barcode lookup (what a scanner needs at sale time)
router.get('/', authRequired, async (req, res) => {
  const branchId = req.user.branch_id;
  const barcode = req.query.barcode ? String(req.query.barcode).trim() : null;
  const q = req.query.q ? String(req.query.q).trim() : null;
  try {
    let rows;
    if (barcode) {
      [rows] = await pool.query(
        `SELECT ${COLUMNS} FROM medicines WHERE branch_id = ? AND barcode = ? AND is_deleted = 0 LIMIT 1`,
        [branchId, barcode]
      );
    } else if (q) {
      const like = `%${q}%`;
      [rows] = await pool.query(
        `SELECT ${COLUMNS} FROM medicines WHERE branch_id = ? AND is_deleted = 0 AND (name LIKE ? OR generic_name LIKE ? OR barcode LIKE ?) ORDER BY name`,
        [branchId, like, like, like]
      );
    } else {
      [rows] = await pool.query(
        `SELECT ${COLUMNS} FROM medicines WHERE branch_id = ? AND is_deleted = 0 ORDER BY name`,
        [branchId]
      );
    }
    return res.json({ status: 'ok', medicines: rows });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

// GET /api/medicines/:id
router.get('/:id', authRequired, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT ${COLUMNS} FROM medicines WHERE id = ? AND branch_id = ? AND is_deleted = 0 LIMIT 1`,
      [req.params.id, req.user.branch_id]
    );
    if (!rows[0]) {
      return res.status(404).json({ status: 'error', message: 'Medicine not found' });
    }
    return res.json({ status: 'ok', medicine: rows[0] });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

module.exports = router;
