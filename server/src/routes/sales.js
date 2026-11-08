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

  // Credit (por) sales: paid_amount is what the customer pays at the till.
  // Missing means "paid in full"; less than the total means the rest is owed.
  let paidAmount = null;
  if (body.paid_amount !== undefined && body.paid_amount !== null && body.paid_amount !== '') {
    paidAmount = Number(body.paid_amount);
    if (!Number.isFinite(paidAmount) || paidAmount < 0) {
      return res.status(400).json({ status: 'error', message: 'paid_amount must be a number, 0 or more' });
    }
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

    if (paidAmount === null) paidAmount = netTotal;
    if (paidAmount > netTotal) {
      await conn.rollback();
      return res.status(400).json({ status: 'error', message: 'Paid amount cannot be more than the bill total' });
    }
    if (paidAmount < netTotal && !customerId) {
      await conn.rollback();
      return res.status(400).json({ status: 'error', message: 'A credit sale needs a named customer (not walk-in)' });
    }

    // Per-branch invoice sequence: SALE-0001, SALE-0002, ...
    const [cntRows] = await conn.query('SELECT COUNT(*) AS c FROM sales WHERE branch_id = ?', [branchId]);
    const invoiceNo = `SALE-${String(Number(cntRows[0].c) + 1).padStart(4, '0')}`;

    const saleId = uuidv4();
    await conn.query(
      'INSERT INTO sales (id, branch_id, invoice_no, customer_id, total_amount, discount, net_total, paid_amount, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [saleId, branchId, invoiceNo, customerId, totalAmount, discount, netTotal, paidAmount, userId]
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
      sale: { id: saleId, invoice_no: invoiceNo, customer_id: customerId, total_amount: totalAmount, discount, net_total: netTotal, paid_amount: paidAmount, due_amount: Math.round((netTotal - paidAmount) * 100) / 100, items: allocations },
    });
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* already rolled back */ }
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  } finally {
    conn.release();
  }
});

// Money state of one sale: what was refunded (returns at sale prices),
// what has been paid (at the till plus later payments), and what is still
// owed. A NULL paid_amount (sales recorded before credit tracking existed)
// counts as paid in full at the till.
async function saleMoney(db, sale) {
  const [rt] = await db.query(
    `SELECT COALESCE(SUM(st.quantity_change * i.unit_price), 0) AS refunded
     FROM stock_transactions st
     JOIN sale_items i ON i.sale_id = st.reference_id AND i.batch_id = st.batch_id
     WHERE st.type = 'sale_return' AND st.reference_id = ?`,
    [sale.id]
  );
  const [pay] = await db.query(
    'SELECT COALESCE(SUM(amount), 0) AS paid FROM sale_payments WHERE sale_id = ? AND is_deleted = 0',
    [sale.id]
  );
  const net = Number(sale.net_total);
  const refunded = Math.round(Number(rt[0].refunded) * 100) / 100;
  const paidAtSale = sale.paid_amount === null || sale.paid_amount === undefined ? net : Number(sale.paid_amount);
  const paidTotal = Math.round((paidAtSale + Number(pay[0].paid)) * 100) / 100;
  const due = Math.max(0, Math.round((net - refunded - paidTotal) * 100) / 100);
  return { refunded_total: refunded, paid_total: paidTotal, due_amount: due };
}

// GET /api/sales — newest first. Optional filters: ?q= (invoice no or
// customer name), ?from=YYYY-MM-DD, ?to=YYYY-MM-DD. Each row also carries
// its returns state (items sold vs returned, refunded amount at sale
// prices) and its money state (paid_total, due_amount, voided), so the
// bills list can mark returned / credited / voided bills truthfully.
router.get('/', authRequired, async (req, res) => {
  try {
    const where = ['s.branch_id = ?', 's.is_deleted = 0'];
    const params = [req.user.branch_id];
    const q = String(req.query.q || '').trim();
    if (q) {
      where.push('(s.invoice_no LIKE ? OR c.name LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    }
    const from = String(req.query.from || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(from)) {
      where.push('s.sale_date >= ?');
      params.push(`${from} 00:00:00`);
    }
    const to = String(req.query.to || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      where.push('s.sale_date < DATE_ADD(?, INTERVAL 1 DAY)');
      params.push(to);
    }
    const [rows] = await pool.query(
      `SELECT s.id, s.invoice_no, s.sale_date, s.total_amount, s.discount, s.net_total,
              s.paid_amount, s.voided_at,
              c.name AS customer_name,
              COALESCE(si.items_sold, 0) AS items_sold,
              COALESCE(rt.items_returned, 0) AS items_returned,
              COALESCE(rt.refunded_total, 0) AS refunded_total,
              COALESCE(pay.paid_sum, 0) AS payments_sum
       FROM sales s
       LEFT JOIN customers c ON c.id = s.customer_id
       LEFT JOIN (
         SELECT sale_id, SUM(quantity) AS items_sold
         FROM sale_items GROUP BY sale_id
       ) si ON si.sale_id = s.id
       LEFT JOIN (
         SELECT st.reference_id AS sale_id,
                SUM(st.quantity_change) AS items_returned,
                SUM(st.quantity_change * i.unit_price) AS refunded_total
         FROM stock_transactions st
         JOIN sale_items i ON i.sale_id = st.reference_id AND i.batch_id = st.batch_id
         WHERE st.type = 'sale_return'
         GROUP BY st.reference_id
       ) rt ON rt.sale_id = s.id
       LEFT JOIN (
         SELECT sale_id, SUM(amount) AS paid_sum
         FROM sale_payments WHERE is_deleted = 0 GROUP BY sale_id
       ) pay ON pay.sale_id = s.id
       WHERE ${where.join(' AND ')}
       ORDER BY s.sale_date DESC, s.created_at DESC`,
      params
    );
    const sales = rows.map((r) => {
      const net = Number(r.net_total);
      const refunded = Math.round(Number(r.refunded_total) * 100) / 100;
      const paidAtSale = r.paid_amount === null ? net : Number(r.paid_amount);
      const paidTotal = Math.round((paidAtSale + Number(r.payments_sum)) * 100) / 100;
      return {
        ...r,
        items_sold: Number(r.items_sold),
        items_returned: Number(r.items_returned),
        refunded_total: refunded,
        paid_total: paidTotal,
        due_amount: Math.max(0, Math.round((net - refunded - paidTotal) * 100) / 100),
        voided: r.voided_at ? 1 : 0,
      };
    });
    return res.json({ status: 'ok', sales });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

// GET /api/sales/:id — one sale with its items
router.get('/:id', authRequired, async (req, res) => {
  try {
    const [head] = await pool.query(
      `SELECT s.id, s.invoice_no, s.sale_date, s.total_amount, s.discount, s.net_total,
              s.paid_amount, s.voided_at,
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
      `SELECT si.id AS item_id, si.medicine_id, m.name AS medicine_name, si.batch_id, b.batch_no,
              b.expiry_date, si.quantity, si.unit_price, si.cost_price,
              COALESCE(rt.returned, 0) AS returned_quantity
       FROM sale_items si
       JOIN medicines m ON m.id = si.medicine_id
       JOIN medicine_batches b ON b.id = si.batch_id
       LEFT JOIN (
         SELECT batch_id, SUM(quantity_change) AS returned
         FROM stock_transactions
         WHERE type = 'sale_return' AND reference_id = ?
         GROUP BY batch_id
       ) rt ON rt.batch_id = si.batch_id
       WHERE si.sale_id = ?`,
      [req.params.id, req.params.id]
    );
    const itemsWithReturns = items.map((it) => ({
      ...it,
      returned_quantity: Number(it.returned_quantity),
    }));
    const [payments] = await pool.query(
      'SELECT id, amount, created_at FROM sale_payments WHERE sale_id = ? AND is_deleted = 0 ORDER BY created_at',
      [req.params.id]
    );
    const money = await saleMoney(pool, head[0]);
    return res.json({
      status: 'ok',
      sale: {
        ...head[0],
        items: itemsWithReturns,
        payments: payments.map((p) => ({ ...p, amount: Number(p.amount) })),
        ...money,
      },
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
});

// POST /api/sales/:id/return — return items from a sale back into stock.
// Body: { items: [ { item_id, quantity } ] }  (item_id = a sale_items row id)
// One transaction: the returned quantity goes back into the SAME batch it was
// sold from, a 'sale_return' ledger row is written, and reports net the
// refund against revenue/cost on the day the return happens. A return can
// never exceed what was sold minus what was already returned.
router.post('/:id/return', authRequired, async (req, res) => {
  const body = req.body || {};
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) {
    return res.status(400).json({ status: 'error', message: 'A return needs at least one item' });
  }
  for (const [i, it] of items.entries()) {
    if (!it || !it.item_id) {
      return res.status(400).json({ status: 'error', message: `Item ${i + 1}: item_id is required` });
    }
    const qty = Number(it.quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
      return res.status(400).json({ status: 'error', message: `Item ${i + 1}: quantity must be a whole number above 0` });
    }
  }

  const branchId = req.user.branch_id;
  const userId = req.user.sub;
  const saleId = req.params.id;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [sale] = await conn.query(
      'SELECT id, invoice_no FROM sales WHERE id = ? AND branch_id = ? AND is_deleted = 0 LIMIT 1 FOR UPDATE',
      [saleId, branchId]
    );
    if (sale.length === 0) {
      await conn.rollback();
      return res.status(404).json({ status: 'error', message: 'Sale not found' });
    }

    const [soldItems] = await conn.query(
      `SELECT si.id, si.medicine_id, m.name AS medicine_name, si.batch_id, si.quantity,
              si.unit_price, si.cost_price
       FROM sale_items si
       JOIN medicines m ON m.id = si.medicine_id
       WHERE si.sale_id = ? FOR UPDATE`,
      [saleId]
    );
    const byId = new Map(soldItems.map((si) => [si.id, si]));

    const returned = [];
    let refundTotal = 0;
    for (const it of items) {
      const sold = byId.get(String(it.item_id));
      if (!sold) {
        await conn.rollback();
        return res.status(400).json({ status: 'error', message: 'An item does not belong to this sale' });
      }
      const qty = Number(it.quantity);
      const [rt] = await conn.query(
        `SELECT COALESCE(SUM(quantity_change), 0) AS returned
         FROM stock_transactions
         WHERE type = 'sale_return' AND reference_id = ? AND batch_id = ?`,
        [saleId, sold.batch_id]
      );
      const alreadyReturned = Number(rt[0].returned);
      const returnable = Number(sold.quantity) - alreadyReturned;
      if (qty > returnable) {
        await conn.rollback();
        return res.status(400).json({
          status: 'error',
          message: `Cannot return ${qty} of ${sold.medicine_name}: sold ${sold.quantity}, already returned ${alreadyReturned}`,
        });
      }
      await conn.query(
        'UPDATE medicine_batches SET quantity_on_hand = quantity_on_hand + ? WHERE id = ?',
        [qty, sold.batch_id]
      );
      await conn.query(
        "INSERT INTO stock_transactions (id, branch_id, medicine_id, batch_id, type, quantity_change, reference_id, created_by) VALUES (?, ?, ?, ?, 'sale_return', ?, ?, ?)",
        [uuidv4(), branchId, sold.medicine_id, sold.batch_id, qty, saleId, userId]
      );
      refundTotal += qty * Number(sold.unit_price);
      returned.push({
        item_id: sold.id,
        medicine_id: sold.medicine_id,
        medicine_name: sold.medicine_name,
        batch_id: sold.batch_id,
        quantity: qty,
        unit_price: Number(sold.unit_price),
      });
    }

    await conn.commit();
    return res.json({
      status: 'ok',
      invoice_no: sale[0].invoice_no,
      refund_total: refundTotal,
      returned,
    });
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* already rolled back */ }
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  } finally {
    conn.release();
  }
});

// POST /api/sales/:id/payment — record a later payment against a credit
// (por) bill. Body: { amount }. One transaction; a payment can never
// exceed what is still owed on the bill.
router.post('/:id/payment', authRequired, async (req, res) => {
  const amount = Number((req.body || {}).amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ status: 'error', message: 'amount must be a number above 0' });
  }
  const branchId = req.user.branch_id;
  const userId = req.user.sub;
  const saleId = req.params.id;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [sale] = await conn.query(
      'SELECT id, net_total, paid_amount FROM sales WHERE id = ? AND branch_id = ? AND is_deleted = 0 LIMIT 1 FOR UPDATE',
      [saleId, branchId]
    );
    if (sale.length === 0) {
      await conn.rollback();
      return res.status(404).json({ status: 'error', message: 'Sale not found' });
    }
    const money = await saleMoney(conn, sale[0]);
    if (amount > money.due_amount + 0.001) {
      await conn.rollback();
      return res.status(400).json({
        status: 'error',
        message: `Payment ${amount} is more than the amount still due (${money.due_amount})`,
      });
    }
    await conn.query(
      'INSERT INTO sale_payments (id, branch_id, sale_id, amount, created_by) VALUES (?, ?, ?, ?, ?)',
      [uuidv4(), branchId, saleId, amount, userId]
    );
    await conn.commit();
    return res.json({
      status: 'ok',
      paid_total: Math.round((money.paid_total + amount) * 100) / 100,
      due_amount: Math.max(0, Math.round((money.due_amount - amount) * 100) / 100),
    });
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* already rolled back */ }
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  } finally {
    conn.release();
  }
});

// POST /api/sales/:id/void — cancel a whole bill in one step: every item
// still out goes back into the batch it was sold from (the same ledger
// rows a normal return writes), and the bill is stamped voided_at. The
// bill itself stays in the records — reports already net the returns.
router.post('/:id/void', authRequired, async (req, res) => {
  const branchId = req.user.branch_id;
  const userId = req.user.sub;
  const saleId = req.params.id;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [sale] = await conn.query(
      'SELECT id, invoice_no, voided_at FROM sales WHERE id = ? AND branch_id = ? AND is_deleted = 0 LIMIT 1 FOR UPDATE',
      [saleId, branchId]
    );
    if (sale.length === 0) {
      await conn.rollback();
      return res.status(404).json({ status: 'error', message: 'Sale not found' });
    }
    if (sale[0].voided_at) {
      await conn.rollback();
      return res.status(400).json({ status: 'error', message: 'This bill is already voided' });
    }

    const [soldItems] = await conn.query(
      `SELECT si.id, si.medicine_id, si.batch_id, si.quantity, si.unit_price
       FROM sale_items si
       WHERE si.sale_id = ? FOR UPDATE`,
      [saleId]
    );

    let refundTotal = 0;
    for (const sold of soldItems) {
      const [rt] = await conn.query(
        `SELECT COALESCE(SUM(quantity_change), 0) AS returned
         FROM stock_transactions
         WHERE type = 'sale_return' AND reference_id = ? AND batch_id = ?`,
        [saleId, sold.batch_id]
      );
      const remaining = Number(sold.quantity) - Number(rt[0].returned);
      if (remaining <= 0) continue;
      await conn.query(
        'UPDATE medicine_batches SET quantity_on_hand = quantity_on_hand + ? WHERE id = ?',
        [remaining, sold.batch_id]
      );
      await conn.query(
        "INSERT INTO stock_transactions (id, branch_id, medicine_id, batch_id, type, quantity_change, reference_id, created_by) VALUES (?, ?, ?, ?, 'sale_return', ?, ?, ?)",
        [uuidv4(), branchId, sold.medicine_id, sold.batch_id, remaining, saleId, userId]
      );
      refundTotal += remaining * Number(sold.unit_price);
    }

    await conn.query('UPDATE sales SET voided_at = NOW() WHERE id = ?', [saleId]);
    await conn.commit();
    return res.json({ status: 'ok', invoice_no: sale[0].invoice_no, refund_total: refundTotal });
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* already rolled back */ }
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  } finally {
    conn.release();
  }
});

module.exports = router;
