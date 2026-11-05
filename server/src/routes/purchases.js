// Purchase routes — stock enters the system ONLY through purchases.
// One purchase = one database transaction: purchase row + items + batches
// (created or topped up) + stock ledger rows. Either everything is saved
// or nothing is — a half-recorded purchase can never corrupt the stock.
const express = require('express');
const { v4: uuidv4 } = require('uuid');

const pool = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');

const router = express.Router();

function isValidDateString(value) {
  if (typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime());
}

// POST /api/purchases  (admin or pharmacist)
// Body: {
//   supplier_id?, invoice_no?, paid_amount?, notes?,
//   items: [ { medicine_id, batch_no, expiry_date (YYYY-MM-DD), quantity, purchase_price } ]
// }
router.post('/', authRequired, requireRole('admin', 'pharmacist'), async (req, res) => {
  const body = req.body || {};
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) {
    return res.status(400).json({ status: 'error', message: 'A purchase needs at least one item' });
  }

  // Validate every item BEFORE opening the transaction.
  for (const [i, it] of items.entries()) {
    const label = `Item ${i + 1}`;
    if (!it || !it.medicine_id) {
      return res.status(400).json({ status: 'error', message: `${label}: medicine_id is required` });
    }
    if (!it.batch_no || !String(it.batch_no).trim()) {
      return res.status(400).json({ status: 'error', message: `${label}: batch_no is required` });
    }
    if (!isValidDateString(it.expiry_date)) {
      return res.status(400).json({ status: 'error', message: `${label}: expiry_date must be YYYY-MM-DD` });
    }
    const qty = Number(it.quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
      return res.status(400).json({ status: 'error', message: `${label}: quantity must be a whole number above 0` });
    }
    const price = it.purchase_price === undefined || it.purchase_price === null ? 0 : Number(it.purchase_price);
    if (!Number.isFinite(price) || price < 0) {
      return res.status(400).json({ status: 'error', message: `${label}: purchase_price must be a number, 0 or more` });
    }
  }

  const branchId = req.user.branch_id;
  const userId = req.user.id;
  const supplierId = body.supplier_id ? String(body.supplier_id) : null;
  const invoiceNo = body.invoice_no ? String(body.invoice_no).trim() : null;
  const notes = body.notes ? String(body.notes).trim() : null;
  const totalAmount = items.reduce((sum, it) => sum + Number(it.quantity) * Number(it.purchase_price || 0), 0);
  const paidAmount = body.paid_amount === undefined || body.paid_amount === null ? totalAmount : Number(body.paid_amount);
  if (!Number.isFinite(paidAmount) || paidAmount < 0) {
    return res.status(400).json({ status: 'error', message: 'paid_amount must be a number, 0 or more' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    if (supplierId) {
      const [sup] = await conn.query(
        'SELECT id FROM suppliers WHERE id = ? AND branch_id = ? AND is_deleted = 0 LIMIT 1',
        [supplierId, branchId]
      );
      if (sup.length === 0) {
        await conn.rollback();
        return res.status(400).json({ status: 'error', message: 'Supplier not found in this branch' });
      }
    }

    const purchaseId = uuidv4();
    await conn.query(
      'INSERT INTO purchases (id, branch_id, supplier_id, invoice_no, total_amount, paid_amount, created_by, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [purchaseId, branchId, supplierId, invoiceNo, totalAmount, paidAmount, userId, notes]
    );

    const savedItems = [];
    for (const it of items) {
      const medicineId = String(it.medicine_id);
      const batchNo = String(it.batch_no).trim();
      const qty = Number(it.quantity);
      const price = Number(it.purchase_price || 0);

      const [med] = await conn.query(
        'SELECT id, name FROM medicines WHERE id = ? AND branch_id = ? AND is_deleted = 0 LIMIT 1',
        [medicineId, branchId]
      );
      if (med.length === 0) {
        await conn.rollback();
        return res.status(400).json({ status: 'error', message: `Medicine not found in this branch: ${medicineId}` });
      }

      // Same medicine + same batch number + same expiry = same batch: top it up.
      let batchId;
      const [batch] = await conn.query(
        'SELECT id FROM medicine_batches WHERE branch_id = ? AND medicine_id = ? AND batch_no = ? AND expiry_date = ? AND is_deleted = 0 LIMIT 1',
        [branchId, medicineId, batchNo, it.expiry_date]
      );
      if (batch.length > 0) {
        batchId = batch[0].id;
        await conn.query(
          'UPDATE medicine_batches SET quantity_on_hand = quantity_on_hand + ?, purchase_price = ? WHERE id = ?',
          [qty, price, batchId]
        );
      } else {
        batchId = uuidv4();
        await conn.query(
          'INSERT INTO medicine_batches (id, branch_id, medicine_id, batch_no, expiry_date, purchase_price, quantity_on_hand) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [batchId, branchId, medicineId, batchNo, it.expiry_date, price, qty]
        );
      }

      await conn.query(
        'INSERT INTO purchase_items (id, purchase_id, medicine_id, batch_id, quantity, purchase_price) VALUES (?, ?, ?, ?, ?, ?)',
        [uuidv4(), purchaseId, medicineId, batchId, qty, price]
      );

      // Ledger row — the permanent record of this stock movement.
      await conn.query(
        "INSERT INTO stock_transactions (id, branch_id, medicine_id, batch_id, type, quantity_change, reference_id, created_by) VALUES (?, ?, ?, ?, 'purchase', ?, ?, ?)",
        [uuidv4(), branchId, medicineId, batchId, qty, purchaseId, userId]
      );

      savedItems.push({ medicine_id: medicineId, medicine_name: med[0].name, batch_id: batchId, batch_no: batchNo, expiry_date: it.expiry_date, quantity: qty, purchase_price: price });
    }

    await conn.commit();
    return res.status(201).json({
      status: 'ok',
      purchase: { id: purchaseId, supplier_id: supplierId, invoice_no: invoiceNo, total_amount: totalAmount, paid_amount: paidAmount, items: savedItems },
    });
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* already rolled back */ }
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  } finally {
    conn.release();
  }
});

// GET /api/purchases — newest first, with supplier name
router.get('/', authRequired, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT p.id, p.invoice_no, p.purchase_date, p.total_amount, p.paid_amount, p.notes,
              s.name AS supplier_name
       FROM purchases p
       LEFT JOIN suppliers s ON s.id = p.supplier_id
       WHERE p.branch_id = ? AND p.is_deleted = 0
       ORDER BY p.purchase_date DESC, p.created_at DESC`,
      [req.user.branch_id]
    );
    return res.json({ status: 'ok', purchases: rows });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

// GET /api/purchases/:id — one purchase with its items
router.get('/:id', authRequired, async (req, res) => {
  try {
    const [head] = await pool.query(
      `SELECT p.id, p.invoice_no, p.purchase_date, p.total_amount, p.paid_amount, p.notes,
              s.name AS supplier_name
       FROM purchases p
       LEFT JOIN suppliers s ON s.id = p.supplier_id
       WHERE p.id = ? AND p.branch_id = ? AND p.is_deleted = 0 LIMIT 1`,
      [req.params.id, req.user.branch_id]
    );
    if (!head[0]) {
      return res.status(404).json({ status: 'error', message: 'Purchase not found' });
    }
    const [items] = await pool.query(
      `SELECT pi.medicine_id, m.name AS medicine_name, pi.batch_id, b.batch_no, b.expiry_date,
              pi.quantity, pi.purchase_price
       FROM purchase_items pi
       JOIN medicines m ON m.id = pi.medicine_id
       JOIN medicine_batches b ON b.id = pi.batch_id
       WHERE pi.purchase_id = ?`,
      [req.params.id]
    );
    return res.json({ status: 'ok', purchase: { ...head[0], items } });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

module.exports = router;
