// Medicine routes — add (keyboard or barcode scanner), list, search, barcode lookup
// Every route requires login. The branch always comes from the user's token,
// never from the request body, so one branch can never touch another's data.
const express = require('express');
const { v4: uuidv4 } = require('uuid');

const pool = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');

const router = express.Router();

const COLUMNS =
  'id, branch_id, name, generic_name, company, barcode, unit, category, sale_price, min_stock, warn_months, created_at, updated_at';

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

  const genericName = body.generic_name ? String(body.generic_name).trim() : '';
  const company = body.company ? String(body.company).trim() : '';
  const barcode = body.barcode ? String(body.barcode).trim() : '';
  const unit = body.unit ? String(body.unit).trim() : '';
  const category = body.category ? String(body.category).trim() : '';

  // Every main field is required — a medicine record with no company, no
  // barcode or no price is not usable at the till or in reports, so the
  // record is only accepted once all of them are filled in.
  const missing = [];
  if (!genericName) missing.push('generic_name');
  if (!company) missing.push('company');
  if (!barcode) missing.push('barcode');
  if (!unit) missing.push('unit');
  if (!category) missing.push('category');
  if (body.sale_price === undefined || body.sale_price === null || body.sale_price === '') missing.push('sale_price');
  if (body.min_stock === undefined || body.min_stock === null || body.min_stock === '') missing.push('min_stock');
  if (body.warn_months === undefined || body.warn_months === null || body.warn_months === '') missing.push('warn_months');
  if (missing.length > 0) {
    return res.status(400).json({ status: 'error', message: `These fields are required: ${missing.join(', ')}` });
  }

  const salePrice = Number(body.sale_price);
  if (!Number.isFinite(salePrice) || salePrice < 0) {
    return res.status(400).json({ status: 'error', message: 'Sale price must be a number, 0 or more' });
  }
  const minStock = Number(body.min_stock);
  if (!Number.isInteger(minStock) || minStock < 0) {
    return res.status(400).json({ status: 'error', message: 'Minimum stock must be a whole number, 0 or more' });
  }
  // Per-medicine expiry warning: how many months before expiry this medicine
  // starts appearing in the dashboard warnings (the pharmacist sets it).
  const warnMonths = Number(body.warn_months);
  if (!Number.isInteger(warnMonths) || warnMonths < 0 || warnMonths > 24) {
    return res.status(400).json({ status: 'error', message: 'Expiry warning must be a whole number of months, 0 to 24' });
  }

  // Optional opening stock: when a pharmacist registers a brand-new medicine
  // they usually already hold some of it. The quantity is NOT stored as a bare
  // number — it is recorded as a proper purchase (batch + expiry + purchase
  // price + ledger row), exactly as if it came through the Purchases page, so
  // expiry warnings and profit reports are correct from day one.
  const init = body.initial_stock && typeof body.initial_stock === 'object' ? body.initial_stock : null;
  let initData = null;
  if (init && init.quantity !== undefined && init.quantity !== null && init.quantity !== '') {
    const qty = Number(init.quantity);
    if (!Number.isInteger(qty) || qty < 0) {
      return res.status(400).json({ status: 'error', message: 'Initial stock quantity must be a whole number, 0 or more' });
    }
    if (qty > 0) {
      const pp = init.purchase_price === undefined || init.purchase_price === null ? 0 : Number(init.purchase_price);
      if (!Number.isFinite(pp) || pp < 0) {
        return res.status(400).json({ status: 'error', message: 'Initial stock purchase price must be a number, 0 or more' });
      }
      const expiry = String(init.expiry_date || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry) || Number.isNaN(new Date(`${expiry}T00:00:00Z`).getTime())) {
        return res.status(400).json({ status: 'error', message: 'Initial stock needs an expiry date (YYYY-MM-DD)' });
      }
      initData = {
        quantity: qty,
        purchase_price: pp,
        expiry_date: expiry,
        batch_no: init.batch_no ? String(init.batch_no).trim() : 'B1',
        supplier_id: init.supplier_id ? String(init.supplier_id) : null,
      };
    }
  }

  const branchId = req.user.branch_id;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    if (barcode) {
      const [dup] = await conn.query(
        'SELECT id, name FROM medicines WHERE branch_id = ? AND barcode = ? AND is_deleted = 0 LIMIT 1',
        [branchId, barcode]
      );
      if (dup.length > 0) {
        await conn.rollback();
        return res.status(409).json({
          status: 'error',
          message: `This barcode is already registered to: ${dup[0].name}`,
          medicine: dup[0],
        });
      }
    }

    if (initData && initData.supplier_id) {
      const [sup] = await conn.query(
        'SELECT id FROM suppliers WHERE id = ? AND branch_id = ? AND is_deleted = 0 LIMIT 1',
        [initData.supplier_id, branchId]
      );
      if (sup.length === 0) {
        await conn.rollback();
        return res.status(400).json({ status: 'error', message: 'Supplier not found in this branch' });
      }
    }

    const id = uuidv4();
    await conn.query(
      'INSERT INTO medicines (id, branch_id, name, generic_name, company, barcode, unit, category, sale_price, min_stock, warn_months) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, branchId, name, genericName, company, barcode, unit, category, salePrice, minStock, warnMonths]
    );

    let initialStock = null;
    if (initData) {
      const batchId = uuidv4();
      await conn.query(
        'INSERT INTO medicine_batches (id, branch_id, medicine_id, batch_no, expiry_date, purchase_price, quantity_on_hand) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [batchId, branchId, id, initData.batch_no, initData.expiry_date, initData.purchase_price, initData.quantity]
      );
      const [cntRows] = await conn.query('SELECT COUNT(*) AS c FROM purchases WHERE branch_id = ?', [branchId]);
      const invoiceNo = `OPEN-${String(Number(cntRows[0].c) + 1).padStart(4, '0')}`;
      const total = initData.quantity * initData.purchase_price;
      const purchaseId = uuidv4();
      await conn.query(
        'INSERT INTO purchases (id, branch_id, supplier_id, invoice_no, total_amount, paid_amount, created_by, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [purchaseId, branchId, initData.supplier_id, invoiceNo, total, total, req.user.sub, 'Opening stock']
      );
      await conn.query(
        'INSERT INTO purchase_items (id, purchase_id, medicine_id, batch_id, quantity, purchase_price) VALUES (?, ?, ?, ?, ?, ?)',
        [uuidv4(), purchaseId, id, batchId, initData.quantity, initData.purchase_price]
      );
      await conn.query(
        "INSERT INTO stock_transactions (id, branch_id, medicine_id, batch_id, type, quantity_change, reference_id, created_by) VALUES (?, ?, ?, ?, 'purchase', ?, ?, ?)",
        [uuidv4(), branchId, id, batchId, initData.quantity, purchaseId, req.user.sub]
      );
      initialStock = {
        quantity: initData.quantity,
        batch_no: initData.batch_no,
        expiry_date: initData.expiry_date,
        purchase_price: initData.purchase_price,
        invoice_no: invoiceNo,
      };
    }

    await conn.commit();
    const [rows] = await pool.query(`SELECT ${COLUMNS} FROM medicines WHERE id = ? LIMIT 1`, [id]);
    return res.status(201).json({ status: 'ok', medicine: rows[0], initial_stock: initialStock });
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* already rolled back */ }
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ status: 'error', message: 'This barcode is already registered in this branch' });
    }
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  } finally {
    conn.release();
  }
});

// PUT /api/medicines/:id — correct a medicine's details. A typing mistake in
// the name, company, barcode or price must be fixable; stock quantities are
// NOT changed here — they only move through purchases and sales.
router.put('/:id', authRequired, requireRole('admin', 'pharmacist'), async (req, res) => {
  const branchId = req.user.branch_id;
  const body = req.body || {};

  const name = body.name ? String(body.name).trim() : '';
  if (!name) {
    return res.status(400).json({ status: 'error', message: 'Medicine name is required' });
  }
  const genericName = body.generic_name ? String(body.generic_name).trim() : '';
  const company = body.company ? String(body.company).trim() : '';
  const barcode = body.barcode ? String(body.barcode).trim() : '';
  const unit = body.unit ? String(body.unit).trim() : '';
  const category = body.category ? String(body.category).trim() : '';

  const missing = [];
  if (!genericName) missing.push('generic_name');
  if (!company) missing.push('company');
  if (!barcode) missing.push('barcode');
  if (!unit) missing.push('unit');
  if (!category) missing.push('category');
  if (body.sale_price === undefined || body.sale_price === null || body.sale_price === '') missing.push('sale_price');
  if (body.min_stock === undefined || body.min_stock === null || body.min_stock === '') missing.push('min_stock');
  if (body.warn_months === undefined || body.warn_months === null || body.warn_months === '') missing.push('warn_months');
  if (missing.length > 0) {
    return res.status(400).json({ status: 'error', message: `These fields are required: ${missing.join(', ')}` });
  }
  const salePrice = Number(body.sale_price);
  if (!Number.isFinite(salePrice) || salePrice < 0) {
    return res.status(400).json({ status: 'error', message: 'Sale price must be a number, 0 or more' });
  }
  const minStock = Number(body.min_stock);
  if (!Number.isInteger(minStock) || minStock < 0) {
    return res.status(400).json({ status: 'error', message: 'Minimum stock must be a whole number, 0 or more' });
  }
  const warnMonths = Number(body.warn_months);
  if (!Number.isInteger(warnMonths) || warnMonths < 0 || warnMonths > 24) {
    return res.status(400).json({ status: 'error', message: 'Expiry warning must be a whole number of months, 0 to 24' });
  }

  try {
    const [existing] = await pool.query(
      'SELECT id FROM medicines WHERE id = ? AND branch_id = ? AND is_deleted = 0 LIMIT 1',
      [req.params.id, branchId]
    );
    if (!existing[0]) {
      return res.status(404).json({ status: 'error', message: 'Medicine not found' });
    }
    const [dup] = await pool.query(
      'SELECT id, name FROM medicines WHERE branch_id = ? AND barcode = ? AND is_deleted = 0 AND id <> ? LIMIT 1',
      [branchId, barcode, req.params.id]
    );
    if (dup[0]) {
      return res.status(409).json({
        status: 'error',
        message: `A medicine with this barcode already exists: ${dup[0].name}`,
      });
    }
    await pool.query(
      `UPDATE medicines
          SET name = ?, generic_name = ?, company = ?, barcode = ?, unit = ?, category = ?, sale_price = ?, min_stock = ?, warn_months = ?
        WHERE id = ? AND branch_id = ?`,
      [name, genericName, company, barcode, unit, category, salePrice, minStock, warnMonths, req.params.id, branchId]
    );
    const [rows] = await pool.query(`SELECT ${COLUMNS} FROM medicines WHERE id = ?`, [req.params.id]);
    return res.json({ status: 'ok', medicine: rows[0] });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ status: 'error', message: 'A medicine with this barcode already exists' });
    }
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

// DELETE /api/medicines/:id — soft delete. The medicine disappears from the
// list, the till and the expiry warnings, but its past sales, purchases and
// reports stay intact — history is never rewritten. (The row stays in the
// database with is_deleted = 1, so an admin could restore it if needed.)
router.delete('/:id', authRequired, requireRole('admin', 'pharmacist'), async (req, res) => {
  try {
    const [result] = await pool.query(
      'UPDATE medicines SET is_deleted = 1 WHERE id = ? AND branch_id = ? AND is_deleted = 0',
      [req.params.id, req.user.branch_id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ status: 'error', message: 'Medicine not found' });
    }
    return res.json({ status: 'ok', message: 'Medicine deleted' });
  } catch (err) {
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
