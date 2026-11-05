// Sales routes — the point of sale.
// A sale is one database transaction: FEFO batch allocation (earliest expiry
// first; expired batches are NEVER sold), stock decrement, sale + items with
// the cost price snapshotted from each batch (so profit reports stay correct
// even if prices change later), and ledger rows. Either the whole sale is
// recorded or none of it is.
const express = require('express');
const { v4: uuidv4 } = require('uuid');

const pool = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

// POST /api/sales
// Body: { customer_id?, discount?, items: [ { medicine_id, quantity, unit_price? } ] }
// unit_price defaults to the medicine's sale_price.
router.post('/', authRequired, async (req, res) => {
  const body = req.body || {};
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) {
    return res.status(400).json({ status: 'error', message: 'A sale needs at least one item' });
  }
  for (const [i, it] of items.entries()) {
    const label = `Item ${i + 1}`;
    if (!it || !it.medicine_id) {
      return res.status(400).json({ status: 'error', message: `${label}: medicine_id is required` });
    }
    const qty = Number(it.quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
      return res.status(400).json({ status: 'error', message: `${label}: quantity must be a whole number above 0` });
    }
    if (it.unit_price !== undefined && it.unit_price !== null) {
      const p = Number(it.unit_price);
      if (!Number.isFinite(p) || p < 0) {
        return res.status(400).json({ status: 'error', message: `${label}: unit_price must be a number, 0 or more` });
      }
    }
  }
  const discount = body.discount === undefined || body.discount === null ? 0 : Number(body.discount);
  if (!Number.isFinite(discount) || discount < 0) {
    return res.status(400).json({ status: 'error', message: 'discount must be a number, 0 or more' });
  }

  const branchId = req.user.branch_id;
  const userId = req.user.id;
  const customerId = body.customer_id ? String(body.customer_id) : null;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    if (customerId) {
      const [cust] = await conn.query(
        'SELECT id FROM customers WHERE id = ? AND branch_id = ? AND is_deleted = 0 LIMIT 1',
        [customerId, branchId]
      );
      if (cust.length === 0) {
        await conn.rollback();
        return res.status(400).json({ status: 'error', message: 'Customer not found in this branch' });
      }
    }

    // Allocate every item FEFO before writing anything.
    const allocations = [];
    let totalAmount = 0;
    for (const it of items) {
      const medicineId = String(it.medicine_id);
      const qtyWanted = Number(it.quantity);

      const [med] = await conn.query(
        'SELECT id, name, sale_price FROM medicines WHERE id = ? AND branch_id = ? AND is_deleted = 0 LIMIT 1',
        [medicineId, branchId]
      );
      if (med.length === 0) {
        await conn.rollback();
        return res.status(400).json({ status: 'error', message: `Medicine not found in this branch: ${medicineId}` });
      }
      const unitPrice = it.unit_price === undefined || it.unit_price === null
        ? Number(med[0].sale_price)
        : Number(it.unit_price);

      // Sellable batches only: in stock, in this branch, NOT expired. Earliest expiry first.
      const [batches] = await conn.query(
        `SELECT id, batch_no, expiry_date, purchase_price, quantity_on_hand
         FROM medicine_batches
         WHERE branch_id = ? AND medicine_id = ? AND is_deleted = 0
           AND quantity_on_hand > 0 AND expiry_date >= CURDATE()
         ORDER BY expiry_date ASC, created_at ASC
         FOR UPDATE`,
        [branchId, medicineId]
      );
      const available = batches.reduce((sum, b) => sum + Number(b.quantity_on_hand), 0);
      if (available < qtyWanted) {
        await conn.rollback();
        return res.status(400).json({
          status: 'error',
          message: `Not enough sellable stock for ${med[0].name}: requested ${qtyWanted}, available ${available} (expired batches are never sold)`,
        });
      }

      let remaining = qtyWanted;
      for (const b of batches) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, Number(b.quantity_on_hand));
        await conn.query(
          'UPDATE medicine_batches SET quantity_on_hand = quantity_on_hand - ? WHERE id = ?',
          [take, b.id]
        );
        allocations.push({
          medicine_id: medicineId,
          medicine_name: med[0].name,
          batch_id: b.id,
          batch_no: b.batch_no,
          expiry_date: b.expiry_date,
          quantity: take,
          unit_price: unitPrice,
          cost_price: Number(b.purchase_price),
        });
        totalAmount += take * unitPrice;
        remaining -= take;
      }
    }

    if (discount > totalAmount) {
      await conn.rollback();
      return res.status(400).json({ status: 'error', message: 'Discount cannot be more than the sale total' });
    }
    const netTotal = totalAmount - discount;

    // Per-branch invoice sequence: SALE-0001, SALE-0002, ...
    const [cntRows] = await conn.query('SELECT COUNT(*) AS c FROM sales WHERE branch_id = ?', [branchId]);
    const invoiceNo = `SALE-${String(Number(cntRows[0].c) + 1).padStart(4, '0')}`;

    const saleId = uuidv4();
    await conn.query(
      'INSERT INTO sales (id, branch_id, invoice_no, customer_id, total_amount, discount, net_total, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [saleId, branchId, invoiceNo, customerId, totalAmount, discount, netTotal, userId]
    );
    for (const a of allocations) {
      await conn.query(
        'INSERT INTO sale_items (id, sale_id, medicine_id, batch_id, quantity, unit_price, cost_price) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [uuidv4(), saleId, a.medicine_id, a.batch_id, a.quantity, a.unit_price, a.cost_price]
      );
      await conn.query(
        "INSERT INTO stock_transactions (id, branch_id, medicine_id, batch_id, type, quantity_change, reference_id, created_by) VALUES (?, ?, ?, ?, 'sale', ?, ?, ?)",
        [uuidv4(), branchId, a.medicine_id, a.batch_id, -a.quantity, saleId, userId]
      );
    }

    await conn.commit();
    return res.status(201).json({
      status: 'ok',
      sale: { id: saleId, invoice_no: invoiceNo, customer_id: customerId, total_amount: totalAmount, discount, net_total: netTotal, items: allocations },
    });
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* already rolled back */ }
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  } finally {
    conn.release();
  }
});

// GET /api/sales — newest first
router.get('/', authRequired, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT s.id, s.invoice_no, s.sale_date, s.total_amount, s.discount, s.net_total,
              c.name AS customer_name
       FROM sales s
       LEFT JOIN customers c ON c.id = s.customer_id
       WHERE s.branch_id = ? AND s.is_deleted = 0
       ORDER BY s.sale_date DESC, s.created_at DESC`,
      [req.user.branch_id]
    );
    return res.json({ status: 'ok', sales: rows });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

// GET /api/sales/:id — one sale with its items
router.get('/:id', authRequired, async (req, res) => {
  try {
    const [head] = await pool.query(
      `SELECT s.id, s.invoice_no, s.sale_date, s.total_amount, s.discount, s.net_total,
              c.name AS customer_name
       FROM sales s
       LEFT JOIN customers c ON c.id = s.customer_id
       WHERE s.id = ? AND s.branch_id = ? AND s.is_deleted = 0 LIMIT 1`,
      [req.params.id, req.user.branch_id]
    );
    if (!head[0]) {
      return res.status(404).json({ status: 'error', message: 'Sale not found' });
    }
    const [items] = await pool.query(
      `SELECT si.medicine_id, m.name AS medicine_name, si.batch_id, b.batch_no, b.expiry_date,
              si.quantity, si.unit_price, si.cost_price
       FROM sale_items si
       JOIN medicines m ON m.id = si.medicine_id
       JOIN medicine_batches b ON b.id = si.batch_id
       WHERE si.sale_id = ?`,
      [req.params.id]
    );
    return res.json({ status: 'ok', sale: { ...head[0], items } });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

module.exports = router;
