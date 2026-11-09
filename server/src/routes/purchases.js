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
  if (paidAmount > totalAmount) {
    return res.status(400).json({ status: 'error', message: 'paid_amount cannot be more than the purchase total' });
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
      `SELECT p.id, p.supplier_id, p.invoice_no, p.purchase_date, p.total_amount, p.paid_amount, p.notes,
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
      `SELECT pi.id, pi.medicine_id, m.name AS medicine_name, pi.batch_id, b.batch_no, b.expiry_date,
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

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

// PUT /api/purchases/:id  (admin or pharmacist)
// Correct a recorded purchase, in one transaction. Stock moves by
// DIFFERENCES only, and never below what has already been sold: if units
// from this purchase are gone, removing or shrinking them is refused with
// the medicine named. Items carry their purchase_items id when they
// already exist; items without an id are new rows; old rows missing from
// the list are removed and their stock is taken back out.
router.put('/:id', authRequired, requireRole('admin', 'pharmacist'), async (req, res) => {
  const body = req.body || {};
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) {
    return res.status(400).json({ status: 'error', message: 'A purchase needs at least one item' });
  }
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
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [head] = await conn.query(
      'SELECT * FROM purchases WHERE id = ? AND branch_id = ? AND is_deleted = 0 LIMIT 1',
      [req.params.id, branchId]
    );
    if (head.length === 0) {
      await conn.rollback();
      return res.status(404).json({ status: 'error', message: 'Purchase not found' });
    }
    const purchase = head[0];

    const supplierId = body.supplier_id ? String(body.supplier_id) : null;
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
    const invoiceNo = body.invoice_no ? String(body.invoice_no).trim() : null;
    const notes = body.notes ? String(body.notes).trim() : purchase.notes;
    const newTotal = items.reduce((sum, it) => sum + Number(it.quantity) * Number(it.purchase_price || 0), 0);
    const paidAmount =
      body.paid_amount === undefined || body.paid_amount === null ? Number(purchase.paid_amount) : Number(body.paid_amount);
    if (!Number.isFinite(paidAmount) || paidAmount < 0) {
      await conn.rollback();
      return res.status(400).json({ status: 'error', message: 'paid_amount must be a number, 0 or more' });
    }
    if (paidAmount > newTotal) {
      await conn.rollback();
      return res.status(400).json({
        status: 'error',
        message: `Paid amount (${paidAmount}) is more than the new total (${newTotal}) — lower the paid amount`,
      });
    }

    const [oldItems] = await conn.query(
      `SELECT pi.id, pi.medicine_id, pi.batch_id, pi.quantity, pi.purchase_price,
              b.batch_no, DATE_FORMAT(b.expiry_date, '%Y-%m-%d') AS expiry_date,
              m.name AS medicine_name
       FROM purchase_items pi
       JOIN medicine_batches b ON b.id = pi.batch_id
       JOIN medicines m ON m.id = pi.medicine_id
       WHERE pi.purchase_id = ?`,
      [purchase.id]
    );

    const ledger = (medicineId, batchId, type, delta) =>
      conn.query(
        "INSERT INTO stock_transactions (id, branch_id, medicine_id, batch_id, type, quantity_change, reference_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [uuidv4(), branchId, medicineId, batchId, type, delta, purchase.id, userId]
      );

    // Take stock out of the batch a row originally filled. Refuses when
    // part of that stock has already been sold (on_hand is what remains).
    const takeOut = async (old, qty) => {
      const [b] = await conn.query('SELECT quantity_on_hand FROM medicine_batches WHERE id = ? LIMIT 1', [old.batch_id]);
      const onHand = Number(b[0].quantity_on_hand);
      if (onHand < qty) {
        throw badRequest(
          `Cannot change this purchase: ${qty - onHand} units of ${old.medicine_name} from it were already sold`
        );
      }
      await conn.query('UPDATE medicine_batches SET quantity_on_hand = quantity_on_hand - ? WHERE id = ?', [qty, old.batch_id]);
      await ledger(old.medicine_id, old.batch_id, 'adjustment', -qty);
    };

    // Put stock into a batch (created or topped up, exactly like a new purchase).
    const putIn = async (medicineId, batchNo, expiry, qty, price) => {
      const [batch] = await conn.query(
        'SELECT id FROM medicine_batches WHERE branch_id = ? AND medicine_id = ? AND batch_no = ? AND expiry_date = ? AND is_deleted = 0 LIMIT 1',
        [branchId, medicineId, batchNo, expiry]
      );
      let batchId;
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
          [batchId, branchId, medicineId, batchNo, expiry, price, qty]
        );
      }
      await ledger(medicineId, batchId, 'purchase', qty);
      return batchId;
    };

    // Rows the edit no longer lists: take their stock back out, drop the row.
    const keptIds = new Set(items.filter((it) => it.id).map((it) => String(it.id)));
    for (const old of oldItems) {
      if (!keptIds.has(old.id)) {
        await takeOut(old, Number(old.quantity));
        await conn.query('DELETE FROM purchase_items WHERE id = ?', [old.id]);
      }
    }

    for (const it of items) {
      const qty = Number(it.quantity);
      const price = it.purchase_price === undefined || it.purchase_price === null ? 0 : Number(it.purchase_price);
      const medId = String(it.medicine_id);
      const batchNo = String(it.batch_no).trim();
      const [med] = await conn.query(
        'SELECT id, name FROM medicines WHERE id = ? AND branch_id = ? AND is_deleted = 0 LIMIT 1',
        [medId, branchId]
      );
      if (med.length === 0) {
        throw badRequest(`Medicine not found in this branch: ${medId}`);
      }
      const old = it.id ? oldItems.find((o) => o.id === String(it.id)) : null;
      if (it.id && !old) {
        throw badRequest('An item does not belong to this purchase');
      }

      if (old && old.medicine_id === medId && String(old.batch_no) === batchNo && String(old.expiry_date) === String(it.expiry_date)) {
        // Same batch: only the difference moves.
        const delta = qty - Number(old.quantity);
        if (delta > 0) {
          await conn.query('UPDATE medicine_batches SET quantity_on_hand = quantity_on_hand + ? WHERE id = ?', [delta, old.batch_id]);
          await ledger(medId, old.batch_id, 'purchase', delta);
        } else if (delta < 0) {
          await takeOut(old, -delta);
        }
        if (price !== Number(old.purchase_price)) {
          await conn.query('UPDATE medicine_batches SET purchase_price = ? WHERE id = ?', [price, old.batch_id]);
        }
        await conn.query('UPDATE purchase_items SET quantity = ?, purchase_price = ? WHERE id = ?', [qty, price, old.id]);
      } else {
        // New row, or the row moved to another medicine/batch: out of the
        // old batch (if any), into the resolved one.
        if (old) {
          await takeOut(old, Number(old.quantity));
        }
        const batchId = await putIn(medId, batchNo, it.expiry_date, qty, price);
        if (old) {
          await conn.query(
            'UPDATE purchase_items SET medicine_id = ?, batch_id = ?, quantity = ?, purchase_price = ? WHERE id = ?',
            [medId, batchId, qty, price, old.id]
          );
        } else {
          await conn.query(
            'INSERT INTO purchase_items (id, purchase_id, medicine_id, batch_id, quantity, purchase_price) VALUES (?, ?, ?, ?, ?, ?)',
            [uuidv4(), purchase.id, medId, batchId, qty, price]
          );
        }
      }
    }

    await conn.query(
      'UPDATE purchases SET supplier_id = ?, invoice_no = ?, total_amount = ?, paid_amount = ?, notes = ? WHERE id = ?',
      [supplierId, invoiceNo, newTotal, paidAmount, notes, purchase.id]
    );
    await conn.commit();
    return res.json({
      status: 'ok',
      purchase: { id: purchase.id, supplier_id: supplierId, invoice_no: invoiceNo, total_amount: newTotal, paid_amount: paidAmount },
    });
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* already rolled back */ }
    return res.status(err.statusCode || 500).json({ status: 'error', message: err.statusCode ? err.message : err.code || err.message });
  } finally {
    conn.release();
  }
});

// DELETE /api/purchases/:id  (admin or pharmacist)
// Soft delete with full stock reversal. Refused when any unit from this
// purchase has already been sold — deleting it would corrupt the stock.
router.delete('/:id', authRequired, requireRole('admin', 'pharmacist'), async (req, res) => {
  const branchId = req.user.branch_id;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [head] = await conn.query(
      'SELECT id FROM purchases WHERE id = ? AND branch_id = ? AND is_deleted = 0 LIMIT 1',
      [req.params.id, branchId]
    );
    if (head.length === 0) {
      await conn.rollback();
      return res.status(404).json({ status: 'error', message: 'Purchase not found' });
    }
    const [items] = await conn.query(
      `SELECT pi.medicine_id, pi.batch_id, pi.quantity, b.quantity_on_hand,
              m.name AS medicine_name
       FROM purchase_items pi
       JOIN medicine_batches b ON b.id = pi.batch_id
       JOIN medicines m ON m.id = pi.medicine_id
       WHERE pi.purchase_id = ?`,
      [req.params.id]
    );
    for (const it of items) {
      if (Number(it.quantity_on_hand) < Number(it.quantity)) {
        await conn.rollback();
        return res.status(400).json({
          status: 'error',
          message: `Cannot delete this purchase: ${Number(it.quantity) - Number(it.quantity_on_hand)} units of ${it.medicine_name} from it were already sold`,
        });
      }
    }
    for (const it of items) {
      await conn.query('UPDATE medicine_batches SET quantity_on_hand = quantity_on_hand - ? WHERE id = ?', [it.quantity, it.batch_id]);
      await conn.query(
        "INSERT INTO stock_transactions (id, branch_id, medicine_id, batch_id, type, quantity_change, reference_id, created_by) VALUES (?, ?, ?, ?, 'adjustment', ?, ?, ?)",
        [uuidv4(), branchId, it.medicine_id, it.batch_id, -Number(it.quantity), req.params.id, req.user.id]
      );
    }
    await conn.query('UPDATE purchases SET is_deleted = 1 WHERE id = ?', [req.params.id]);
    await conn.commit();
    return res.json({ status: 'ok' });
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* already rolled back */ }
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  } finally {
    conn.release();
  }
});

module.exports = router;
