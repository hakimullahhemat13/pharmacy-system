// Automated API tests for the pharmacy backend.
//
// Run from the server folder:
//
//   npm test
//
// The suite starts the REAL server on port 5011 against a SEPARATE
// database (pharmacy_db_test) and drives it over HTTP, so it checks the
// same code the shop uses: FEFO selling, returns, reports, day close,
// roles, branches, the central dashboard, the approval workflow and
// the audit log. It NEVER touches the real pharmacy_db.
//
// One-time setup (run once, as root) — see tests/setup-test-db.sql:
// it creates pharmacy_db_test and gives the pharmacy_app user access.
// Every run wipes the test database and rebuilds it from
// database/schema.sql, then seeds one branch and one admin user.
//
// No extra packages are needed: node:test + fetch are built into Node,
// and mysql2 / bcryptjs / dotenv are already server dependencies.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const SERVER_ROOT = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(SERVER_ROOT, '.env') });

const TEST_PORT = 5011;
const TEST_DB = 'pharmacy_db_test';
const BASE = `http://127.0.0.1:${TEST_PORT}/api`;

// Safety guard: the suite drops every table in its database, so it must
// never run against anything but a database whose name ends in _test.
if (!TEST_DB.endsWith('_test')) {
  throw new Error(`Refusing to run tests against database "${TEST_DB}"`);
}

const BRANCH_ID = uuidv4();
const ADMIN_ID = uuidv4();
const ADMIN_USER = 'testadmin';
const ADMIN_PASS = 'test1234';

let serverProc = null;
let serverOutput = '';
let db = null;

// Shared state between the tests below (node:test runs them in order).
const S = { token: null, cashierToken: null, medicineId: null, saleId: null, earlyItemId: null, branchTwo: null, b2Token: null, b2MedA: null };

function dayStr(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function api(method, url, body, token) {
  const res = await fetch(BASE + url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    // Non-JSON error page — the status assertion below will report it.
  }
  return { status: res.status, data };
}

async function batchQty(batchNo) {
  const [rows] = await db.query(
    'SELECT quantity_on_hand FROM medicine_batches WHERE batch_no = ? AND branch_id = ?',
    [batchNo, BRANCH_ID]
  );
  return rows.length ? Number(rows[0].quantity_on_hand) : null;
}

async function batchQtyIn(branchId, batchNo) {
  const [rows] = await db.query(
    'SELECT quantity_on_hand FROM medicine_batches WHERE batch_no = ? AND branch_id = ?',
    [batchNo, branchId]
  );
  return rows.length ? Number(rows[0].quantity_on_hand) : null;
}

// Every main medicine field is mandatory (the server rejects a record
// with no company, barcode, unit, category or price), so test payloads
// carry the full set. Barcodes must be unique within a branch.
function medPayload(name, barcode, salePrice) {
  return {
    name,
    generic_name: `${name} Generic`,
    company: 'Test Pharma',
    barcode,
    unit: 'tablet',
    category: 'Test',
    sale_price: salePrice,
    min_stock: 1,
  };
}

before(async () => {
  // 1. Rebuild the test database from the shipped schema.
  db = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: TEST_DB,
    multipleStatements: true,
  });
  const [tables] = await db.query(
    'SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?',
    [TEST_DB]
  );
  await db.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const row of tables) {
    await db.query(`DROP TABLE IF EXISTS \`${row.t}\``);
  }
  await db.query('SET FOREIGN_KEY_CHECKS = 1');

  const schemaPath = path.join(SERVER_ROOT, '..', 'database', 'schema.sql');
  let schema = fs.readFileSync(schemaPath, 'utf8');
  // Rewrite ONLY the real USE statement (anchored to its own line): the
  // file header comment mentions the same text, and a plain replace
  // would rewrite the comment and leave the statement pointing at the
  // real database.
  schema = schema.replace(/^USE pharmacy_db;$/m, `USE ${TEST_DB};`);
  assert.ok(schema.includes(`USE ${TEST_DB};`), 'schema USE line was not rewritten to the test database');
  assert.ok(!/^USE pharmacy_db;$/m.test(schema), 'schema still points at the real database — refusing to run');
  await db.query(schema);

  // 2. Seed one branch and one admin user.
  await db.query('INSERT INTO branches (id, name, phone) VALUES (?, ?, ?)', [
    BRANCH_ID,
    'Test Branch',
    '0700000000',
  ]);
  await db.query(
    'INSERT INTO users (id, branch_id, full_name, username, password_hash, role, language, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)',
    [ADMIN_ID, BRANCH_ID, 'Test Admin', ADMIN_USER, bcrypt.hashSync(ADMIN_PASS, 10), 'admin', 'en']
  );

  // 3. Start the real server against the test database. The automatic
  // backup scheduler stays off so no test run writes a real backup.
  serverProc = spawn(process.execPath, ['src/index.js'], {
    cwd: SERVER_ROOT,
    env: {
      ...process.env,
      PORT: String(TEST_PORT),
      DB_NAME: TEST_DB,
      DISABLE_AUTO_BACKUP: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProc.stdout.on('data', (d) => { serverOutput += d.toString(); });
  serverProc.stderr.on('data', (d) => { serverOutput += d.toString(); });

  const deadline = Date.now() + 20000;
  for (;;) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) break;
    } catch (_) {
      // Server not up yet.
    }
    if (Date.now() > deadline) {
      throw new Error(`Test server did not answer on port ${TEST_PORT}.\n${serverOutput}`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
});

after(async () => {
  if (serverProc) {
    serverProc.kill();
    serverProc = null;
  }
  if (db) {
    await db.end();
    db = null;
  }
});

test('health check answers and the database is connected', async () => {
  const { status, data } = await api('GET', '/health');
  assert.equal(status, 200);
  assert.equal(data.status, 'ok');
  assert.equal(data.database, 'connected');
});

test('login rejects a wrong password', async () => {
  const { status, data } = await api('POST', '/auth/login', { username: ADMIN_USER, password: 'wrongpass' });
  assert.equal(status, 401);
  assert.equal(data.status, 'error');
});

test('login succeeds and returns a token', async () => {
  const { status, data } = await api('POST', '/auth/login', { username: ADMIN_USER, password: ADMIN_PASS });
  assert.equal(status, 200);
  assert.equal(data.user.role, 'admin');
  assert.ok(data.token, 'login must return a token');
  S.token = data.token;
});

test('requests without a token are rejected', async () => {
  const { status } = await api('GET', '/medicines');
  assert.equal(status, 401);
});

test('a medicine can be created, and a duplicate barcode is rejected', async () => {
  const medicine = {
    name: 'Test Paracetamol',
    generic_name: 'Paracetamol',
    company: 'Test Pharma',
    barcode: 'TEST1234567890',
    unit: 'tablet',
    category: 'Painkiller',
    sale_price: 50,
    min_stock: 5,
  };
  const created = await api('POST', '/medicines', medicine, S.token);
  assert.equal(created.status, 201);
  assert.ok(created.data.medicine.id);
  S.medicineId = created.data.medicine.id;

  const duplicate = await api('POST', '/medicines', { ...medicine, name: 'Other Name' }, S.token);
  assert.equal(duplicate.status, 409);
});

test('a purchase with a past expiry date is blocked', async () => {
  const { status } = await api(
    'POST',
    '/purchases',
    {
      invoice_no: 'TEST-PAST',
      items: [
        { medicine_id: S.medicineId, batch_no: 'T-PAST', expiry_date: dayStr(-1), quantity: 5, purchase_price: 30 },
      ],
    },
    S.token
  );
  assert.equal(status, 400);
});

test('purchases create stock in two batches', async () => {
  const { status, data } = await api(
    'POST',
    '/purchases',
    {
      invoice_no: 'TEST-001',
      items: [
        { medicine_id: S.medicineId, batch_no: 'T-EARLY', expiry_date: dayStr(60), quantity: 10, purchase_price: 30 },
        { medicine_id: S.medicineId, batch_no: 'T-LATE', expiry_date: dayStr(300), quantity: 10, purchase_price: 30 },
      ],
    },
    S.token
  );
  assert.equal(status, 201);
  assert.equal(Number(data.purchase.total_amount), 600);

  assert.equal(await batchQty('T-EARLY'), 10);
  assert.equal(await batchQty('T-LATE'), 10);

  // The ledger (stock_transactions) is the truth: its sums must equal
  // the cached quantity_on_hand on every batch.
  const [rows] = await db.query(
    `SELECT b.batch_no, b.quantity_on_hand,
            COALESCE(SUM(st.quantity_change), 0) AS ledger_qty
     FROM medicine_batches b
     LEFT JOIN stock_transactions st ON st.batch_id = b.id
     WHERE b.branch_id = ? GROUP BY b.id`,
    [BRANCH_ID]
  );
  for (const row of rows) {
    assert.equal(Number(row.quantity_on_hand), Number(row.ledger_qty), `ledger mismatch on ${row.batch_no}`);
  }
});

test('a sale sells the earliest-expiring batch first (FEFO)', async () => {
  const { status, data } = await api(
    'POST',
    '/sales',
    { items: [{ medicine_id: S.medicineId, quantity: 12, unit_price: 50 }] },
    S.token
  );
  assert.equal(status, 201);
  assert.equal(Number(data.sale.net_total), 600);
  S.saleId = data.sale.id;

  const alloc = data.sale.items;
  assert.equal(alloc.length, 2);
  assert.equal(alloc[0].batch_no, 'T-EARLY');
  assert.equal(alloc[0].quantity, 10);
  assert.equal(alloc[1].batch_no, 'T-LATE');
  assert.equal(alloc[1].quantity, 2);

  assert.equal(await batchQty('T-EARLY'), 0);
  assert.equal(await batchQty('T-LATE'), 8);
});

test('selling more than the stock is rejected and changes nothing', async () => {
  const { status } = await api(
    'POST',
    '/sales',
    { items: [{ medicine_id: S.medicineId, quantity: 100, unit_price: 50 }] },
    S.token
  );
  assert.equal(status, 400);
  assert.equal(await batchQty('T-EARLY'), 0);
  assert.equal(await batchQty('T-LATE'), 8);
});

test('a return restocks the same batch', async () => {
  const [items] = await db.query(
    `SELECT si.id FROM sale_items si
     JOIN medicine_batches b ON b.id = si.batch_id
     WHERE si.sale_id = ? AND b.batch_no = 'T-EARLY'`,
    [S.saleId]
  );
  assert.equal(items.length, 1);
  S.earlyItemId = items[0].id;

  const { status, data } = await api(
    'POST',
    `/sales/${S.saleId}/return`,
    { items: [{ item_id: S.earlyItemId, quantity: 2 }] },
    S.token
  );
  assert.equal(status, 200);
  assert.equal(Number(data.refund_total), 100);
  assert.equal(await batchQty('T-EARLY'), 2);
});

test('returning more than was sold is rejected', async () => {
  const { status, data } = await api(
    'POST',
    `/sales/${S.saleId}/return`,
    { items: [{ item_id: S.earlyItemId, quantity: 11 }] },
    S.token
  );
  assert.equal(status, 400);
  assert.match(data.message, /Cannot return/);
  assert.equal(await batchQty('T-EARLY'), 2);
});

test('the daily report nets returns off revenue and profit', async () => {
  const { status, data } = await api('GET', '/reports/daily', undefined, S.token);
  assert.equal(status, 200);
  const s = data.summary;
  // Sold 12 @ 50 = 600, returned 2 @ 50 = 100 -> revenue 500.
  // Cost 12 @ 30 = 360, returned cost 2 @ 30 = 60 -> cost 300, profit 200.
  assert.equal(Number(s.revenue), 500);
  assert.equal(Number(s.cost_total), 300);
  assert.equal(Number(s.profit), 200);
  assert.equal(Number(s.sales_count), 1);
  assert.equal(Number(s.items_sold), 10);
  assert.equal(Number(s.returns_total), 100);
  assert.equal(Number(s.returned_items), 2);
});

test('expiry levels: expired, warning and ok', async () => {
  // Purchases block past expiry dates, so the expired batch is placed
  // directly — with its matching ledger row, as a real purchase would.
  const batchId = uuidv4();
  await db.query(
    'INSERT INTO medicine_batches (id, branch_id, medicine_id, batch_no, expiry_date, purchase_price, quantity_on_hand) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [batchId, BRANCH_ID, S.medicineId, 'T-OLD', dayStr(-1), 25, 5]
  );
  await db.query(
    'INSERT INTO stock_transactions (id, branch_id, medicine_id, batch_id, type, quantity_change, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [uuidv4(), BRANCH_ID, S.medicineId, batchId, 'purchase', 5, ADMIN_ID]
  );

  const { status, data } = await api('GET', '/stock/all-batches', undefined, S.token);
  assert.equal(status, 200);
  const byNo = Object.fromEntries(data.batches.map((b) => [b.batch_no, b]));
  assert.equal(byNo['T-OLD'].level, 'expired');
  assert.equal(byNo['T-EARLY'].level, 'warning'); // 60 days left, warns at 3 months
  assert.equal(byNo['T-LATE'].level, 'ok');
});

test('FEFO never sells an expired batch', async () => {
  const { status, data } = await api(
    'POST',
    '/sales',
    { items: [{ medicine_id: S.medicineId, quantity: 10, unit_price: 50 }] },
    S.token
  );
  assert.equal(status, 201);
  const total = data.sale.items.reduce((sum, it) => sum + it.quantity, 0);
  assert.equal(total, 10);
  assert.ok(!data.sale.items.some((it) => it.batch_no === 'T-OLD'), 'expired batch must never be sold');
  assert.equal(await batchQty('T-OLD'), 5);
  assert.equal(await batchQty('T-EARLY'), 0);
  assert.equal(await batchQty('T-LATE'), 0);
});

test('day close reconciles cash, blocks sales, and reopen allows them', async () => {
  const today = dayStr(0);
  const before = await api('GET', `/reports/day-close?date=${today}`, undefined, S.token);
  assert.equal(before.status, 200);
  assert.equal(before.data.closed, false);
  // Till 600 + 500 = 1100, refunds 100, paid to suppliers 600 -> expected 400.
  assert.equal(Number(before.data.cash.till), 1100);
  assert.equal(Number(before.data.cash.refunds), 100);
  assert.equal(Number(before.data.cash.supplierPaid), 600);
  assert.equal(Number(before.data.cash.expected), 400);
  assert.equal(before.data.stock.sales.ok, true);
  assert.equal(before.data.stock.ledger.ok, true);

  const closed = await api('POST', '/reports/day-close', { date: today, counted_cash: 400 }, S.token);
  assert.equal(closed.status, 201);
  assert.equal(Number(closed.data.difference), 0);

  const blocked = await api(
    'POST',
    '/sales',
    { items: [{ medicine_id: S.medicineId, quantity: 1, unit_price: 50 }] },
    S.token
  );
  assert.equal(blocked.status, 400);
  assert.match(blocked.data.message, /closed/);

  const reopened = await api('POST', '/reports/day-close/reopen', { date: today }, S.token);
  assert.equal(reopened.status, 200);

  // Trading works again after reopening.
  const restocked = await api(
    'POST',
    '/purchases',
    {
      invoice_no: 'TEST-002',
      items: [
        { medicine_id: S.medicineId, batch_no: 'T-NEW', expiry_date: dayStr(200), quantity: 5, purchase_price: 30 },
      ],
    },
    S.token
  );
  assert.equal(restocked.status, 201);
  const sale = await api(
    'POST',
    '/sales',
    { items: [{ medicine_id: S.medicineId, quantity: 1, unit_price: 50 }] },
    S.token
  );
  assert.equal(sale.status, 201);
});

test('roles: a cashier cannot open manager reports or return bills', async () => {
  const created = await api(
    'POST',
    '/settings/users',
    { full_name: 'Test Cashier', username: 'testcashier', password: 'cashier1', role: 'cashier' },
    S.token
  );
  assert.equal(created.status, 201);

  const login = await api('POST', '/auth/login', { username: 'testcashier', password: 'cashier1' });
  assert.equal(login.status, 200);
  S.cashierToken = login.data.token;

  const monthly = await api('GET', '/reports/monthly', undefined, S.cashierToken);
  assert.equal(monthly.status, 403);

  const ret = await api(
    'POST',
    `/sales/${S.saleId}/return`,
    { items: [{ item_id: S.earlyItemId, quantity: 1 }] },
    S.cashierToken
  );
  assert.equal(ret.status, 403);

  // The cashier's own view still works — scoped to bills they sold (none).
  const own = await api('GET', '/sales', undefined, S.cashierToken);
  assert.equal(own.status, 200);
  assert.equal(own.data.sales.length, 0);

  const daily = await api('GET', '/reports/daily', undefined, S.cashierToken);
  assert.equal(daily.status, 200);
  assert.equal(Number(daily.data.summary.revenue), 0);
});

test('the audit log recorded the day actions', async () => {
  const [rows] = await db.query('SELECT DISTINCT action FROM audit_log');
  const actions = rows.map((r) => r.action);
  for (const expected of ['user.login', 'sale.created', 'sale.returned', 'day.closed', 'day.reopened']) {
    assert.ok(actions.includes(expected), `audit log is missing ${expected}`);
  }
});

test('branches: admin creates a branch, guards hold, and users can be placed in it', async () => {
  // Validation: name is required, and the 10-digit phone rule applies.
  const noName = await api('POST', '/branches', { address: 'x' }, S.token);
  assert.equal(noName.status, 400);
  const badPhone = await api('POST', '/branches', { name: 'Branch Two', phone: '123' }, S.token);
  assert.equal(badPhone.status, 400);

  const created = await api(
    'POST',
    '/branches',
    { name: 'Branch Two', address: 'Second street', phone: '0700000002' },
    S.token
  );
  assert.equal(created.status, 201);
  S.branchTwo = created.data.branch.id;

  // The list shows both branches with user counts.
  const list = await api('GET', '/branches', undefined, S.token);
  assert.equal(list.status, 200);
  assert.equal(list.data.branches.length, 2);
  const main = list.data.branches.find((b) => b.id === BRANCH_ID);
  assert.equal(Number(main.user_count), 2); // testadmin + testcashier

  // A branch can be updated, with the same phone rule.
  const badUpdate = await api('PUT', `/branches/${S.branchTwo}`, { name: 'Branch Two', phone: '1' }, S.token);
  assert.equal(badUpdate.status, 400);
  const updated = await api(
    'PUT',
    `/branches/${S.branchTwo}`,
    { name: 'Branch Two', address: 'Moved street', phone: '0700000003' },
    S.token
  );
  assert.equal(updated.status, 200);

  // A user can be created directly in the new branch…
  const userInTwo = await api(
    'POST',
    '/settings/users',
    { full_name: 'Branch Two Cashier', username: 'b2cashier', password: 'cashier1', role: 'cashier', branch_id: S.branchTwo },
    S.token
  );
  assert.equal(userInTwo.status, 201);
  assert.equal(userInTwo.data.user.branch_id, S.branchTwo);

  // …and shows up in the users list with the branch name.
  const users = await api('GET', '/settings/users', undefined, S.token);
  assert.equal(users.status, 200);
  const placed = users.data.users.find((u) => u.username === 'b2cashier');
  assert.equal(placed.branch_name, 'Branch Two');

  // A bogus branch is rejected.
  const bogus = await api(
    'POST',
    '/settings/users',
    { full_name: 'Nope', username: 'nobranch', password: 'cashier1', role: 'cashier', branch_id: uuidv4() },
    S.token
  );
  assert.equal(bogus.status, 400);

  // Guards: the admin's own branch and a branch with users cannot go.
  const ownDel = await api('DELETE', `/branches/${BRANCH_ID}`, undefined, S.token);
  assert.equal(ownDel.status, 400);
  const busyDel = await api('DELETE', `/branches/${S.branchTwo}`, undefined, S.token);
  assert.equal(busyDel.status, 400);

  // An empty branch can be deleted; it disappears from the list.
  const empty = await api('POST', '/branches', { name: 'Temp Branch' }, S.token);
  assert.equal(empty.status, 201);
  const del = await api('DELETE', `/branches/${empty.data.branch.id}`, undefined, S.token);
  assert.equal(del.status, 200);
  const list2 = await api('GET', '/branches', undefined, S.token);
  assert.equal(list2.data.branches.length, 2);

  // A cashier may not touch branches at all.
  const forbidden = await api('GET', '/branches', undefined, S.cashierToken);
  assert.equal(forbidden.status, 403);
});

test('the central dashboard aggregates every branch and stays admin-only', async () => {
  const central = await api('GET', '/reports/central', undefined, S.token);
  assert.equal(central.status, 200);
  assert.equal(central.data.branches.length, 2);
  const main = central.data.branches.find((b) => b.id === BRANCH_ID);
  const two = central.data.branches.find((b) => b.id === S.branchTwo);
  assert.ok(Number(main.summary.sales_count) >= 1);
  assert.ok(Number(main.summary.revenue) > 0);
  assert.equal(Number(two.summary.sales_count), 0);
  assert.equal(Number(two.summary.revenue), 0);
  assert.equal(typeof main.closed, 'boolean');
  assert.equal(
    central.data.totals.sales_count,
    Number(main.summary.sales_count) + Number(two.summary.sales_count)
  );
  assert.equal(
    Number(central.data.totals.revenue),
    Number(main.summary.revenue) + Number(two.summary.revenue)
  );

  const forbidden = await api('GET', '/reports/central', undefined, S.cashierToken);
  assert.equal(forbidden.status, 403);
});

test('approvals: a child-branch medicine waits, and the Main admin accepts or sends it back', async () => {
  // A pharmacist who works in Branch Two.
  const created = await api(
    'POST',
    '/settings/users',
    { full_name: 'Branch Two Pharmacist', username: 'b2pharm', password: 'pharm123', role: 'pharmacist', branch_id: S.branchTwo },
    S.token
  );
  assert.equal(created.status, 201);
  const login = await api('POST', '/auth/login', { username: 'b2pharm', password: 'pharm123' });
  assert.equal(login.status, 200);
  S.b2Token = login.data.token;

  // A medicine entered in Branch Two waits for approval…
  const medA = await api('POST', '/medicines', medPayload('B2 Med A', 'B2MEDA001', 10), S.b2Token);
  assert.equal(medA.status, 201);
  assert.equal(medA.data.medicine.approval_status, 'pending');
  S.b2MedA = medA.data.medicine.id;
  // …and cannot be sold while it waits.
  const saleBlocked = await api(
    'POST',
    '/sales',
    { items: [{ medicine_id: S.b2MedA, quantity: 1, unit_price: 10 }] },
    S.b2Token
  );
  assert.equal(saleBlocked.status, 400);

  // The boss sees it in the queue; the branch user may not open the queue.
  const queue = await api('GET', '/approvals/pending', undefined, S.token);
  assert.equal(queue.status, 200);
  assert.ok(queue.data.medicines.some((m) => m.id === S.b2MedA));
  const forbidden = await api('GET', '/approvals/pending', undefined, S.b2Token);
  assert.equal(forbidden.status, 403);

  // Rejecting without a reason is refused.
  const noNote = await api('POST', `/approvals/medicines/${S.b2MedA}/reject`, {}, S.token);
  assert.equal(noNote.status, 400);

  // Accepting makes it an ordinary medicine.
  const accept = await api('POST', `/approvals/medicines/${S.b2MedA}/accept`, {}, S.token);
  assert.equal(accept.status, 200);
  const after = await api('GET', `/medicines/${S.b2MedA}`, undefined, S.b2Token);
  assert.equal(after.data.medicine.approval_status, 'approved');

  // A second medicine is rejected with the boss's reason…
  const medB = await api('POST', '/medicines', medPayload('B2 Med B', 'B2MEDB001', 20), S.b2Token);
  assert.equal(medB.status, 201);
  const reject = await api('POST', `/approvals/medicines/${medB.data.medicine.id}/reject`, { note: 'Fix the price' }, S.token);
  assert.equal(reject.status, 200);
  // …shows in the branch's own review list with the note…
  const mine = await api('GET', '/approvals/my-branch', undefined, S.b2Token);
  assert.equal(mine.status, 200);
  const rejected = mine.data.medicines.find((m) => m.id === medB.data.medicine.id);
  assert.ok(rejected);
  assert.equal(rejected.rejection_note, 'Fix the price');
  // …and editing it sends it back for approval.
  const fixed = await api(
    'PUT',
    `/medicines/${medB.data.medicine.id}`,
    { ...medPayload('B2 Med B', 'B2MEDB001', 25), warn_months: 3 },
    S.b2Token
  );
  assert.equal(fixed.status, 200);
  assert.equal(fixed.data.medicine.approval_status, 'pending');
  assert.equal(fixed.data.medicine.rejection_note, null);
  const accept2 = await api('POST', `/approvals/medicines/${medB.data.medicine.id}/accept`, {}, S.token);
  assert.equal(accept2.status, 200);
});

test('approvals: a child-branch purchase holds its stock until the Main admin accepts it', async () => {
  // A purchase in Branch Two stays pending…
  const pur = await api(
    'POST',
    '/purchases',
    {
      invoice_no: 'B2-INV-1',
      items: [{ medicine_id: S.b2MedA, batch_no: 'B2-B1', expiry_date: dayStr(365), quantity: 10, purchase_price: 8 }],
    },
    S.b2Token
  );
  assert.equal(pur.status, 201);
  assert.equal(pur.data.purchase.approval_status, 'pending');
  // …its batch exists but holds nothing, and no ledger row was written.
  assert.equal(await batchQtyIn(S.branchTwo, 'B2-B1'), 0);
  const [led] = await db.query(
    'SELECT COUNT(*) AS c FROM stock_transactions WHERE branch_id = ? AND reference_id = ?',
    [S.branchTwo, pur.data.purchase.id]
  );
  assert.equal(Number(led[0].c), 0);

  // Accepting lands the stock and writes the ledger row.
  const accept = await api('POST', `/approvals/purchases/${pur.data.purchase.id}/accept`, {}, S.token);
  assert.equal(accept.status, 200);
  assert.equal(await batchQtyIn(S.branchTwo, 'B2-B1'), 10);
  const [led2] = await db.query(
    'SELECT COUNT(*) AS c, COALESCE(SUM(quantity_change), 0) AS q FROM stock_transactions WHERE branch_id = ? AND reference_id = ?',
    [S.branchTwo, pur.data.purchase.id]
  );
  assert.equal(Number(led2[0].c), 1);
  assert.equal(Number(led2[0].q), 10);

  // A purchase naming a waiting medicine is refused outright.
  const waiting = await api('POST', '/medicines', medPayload('B2 Waiting', 'B2WAIT001', 5), S.b2Token);
  assert.equal(waiting.data.medicine.approval_status, 'pending');
  const blocked = await api(
    'POST',
    '/purchases',
    {
      invoice_no: 'B2-INV-2',
      items: [{ medicine_id: waiting.data.medicine.id, batch_no: 'B2-B2', expiry_date: dayStr(365), quantity: 4, purchase_price: 3 }],
    },
    S.b2Token
  );
  assert.equal(blocked.status, 400);

  // The opening-stock flow: the medicine and its OPEN purchase both wait…
  const opened = await api(
    'POST',
    '/medicines',
    {
      ...medPayload('B2 Opened', 'B2OPEN001', 15),
      initial_stock: { quantity: 6, purchase_price: 9, expiry_date: dayStr(365), batch_no: 'B2-OPEN' },
    },
    S.b2Token
  );
  assert.equal(opened.status, 201);
  assert.equal(opened.data.medicine.approval_status, 'pending');
  assert.equal(await batchQtyIn(S.branchTwo, 'B2-OPEN'), 0);
  const allPurchases = await api('GET', '/purchases', undefined, S.b2Token);
  const openRow = allPurchases.data.purchases.find((p) => p.invoice_no === opened.data.initial_stock.invoice_no);
  assert.ok(openRow);
  assert.equal(openRow.approval_status, 'pending');
  // …and accepting the purchase before the medicine is refused.
  const tooEarly = await api('POST', `/approvals/purchases/${openRow.id}/accept`, {}, S.token);
  assert.equal(tooEarly.status, 400);
  // Medicine first, then the purchase — the stock lands.
  assert.equal((await api('POST', `/approvals/medicines/${opened.data.medicine.id}/accept`, {}, S.token)).status, 200);
  assert.equal((await api('POST', `/approvals/purchases/${openRow.id}/accept`, {}, S.token)).status, 200);
  assert.equal(await batchQtyIn(S.branchTwo, 'B2-OPEN'), 6);
});

test('approvals: each branch day is reviewed by the Main admin, and new activity re-opens it', async () => {
  const today = dayStr(0);

  // Sell one unit in Branch Two so the day has figures.
  const sale = await api(
    'POST',
    '/sales',
    { items: [{ medicine_id: S.b2MedA, quantity: 1, unit_price: 10 }] },
    S.b2Token
  );
  assert.equal(sale.status, 201);

  // The day appears in the boss's queue, pending.
  const queue = await api('GET', '/approvals/pending', undefined, S.token);
  const day = queue.data.days.find((d) => d.branch_id === S.branchTwo && d.date === today);
  assert.ok(day);
  assert.equal(day.review_status, 'pending');
  assert.ok(Number(day.summary.items_sold) >= 1);

  // The branch itself cannot accept its own day.
  const selfAccept = await api('POST', '/approvals/days/accept', { branch_id: S.branchTwo, date: today }, S.b2Token);
  assert.equal(selfAccept.status, 403);

  // Accepting removes it from the queue…
  assert.equal((await api('POST', '/approvals/days/accept', { branch_id: S.branchTwo, date: today }, S.token)).status, 200);
  const queue2 = await api('GET', '/approvals/pending', undefined, S.token);
  assert.equal(queue2.data.days.some((d) => d.branch_id === S.branchTwo && d.date === today), false);
  // …but a new sale re-opens the day for review.
  const sale2 = await api(
    'POST',
    '/sales',
    { items: [{ medicine_id: S.b2MedA, quantity: 1, unit_price: 10 }] },
    S.b2Token
  );
  assert.equal(sale2.status, 201);
  const queue3 = await api('GET', '/approvals/pending', undefined, S.token);
  assert.ok(queue3.data.days.some((d) => d.branch_id === S.branchTwo && d.date === today));

  // Rejecting with a reason shows in the branch's own list…
  assert.equal(
    (await api('POST', '/approvals/days/reject', { branch_id: S.branchTwo, date: today, note: 'Check the cash' }, S.token)).status,
    200
  );
  const mine = await api('GET', '/approvals/my-branch', undefined, S.b2Token);
  const rejected = mine.data.days.find((d) => d.date === today);
  assert.ok(rejected);
  assert.equal(rejected.review_status, 'rejected');
  assert.equal(rejected.review_note, 'Check the cash');
  // …and the branch can send it back.
  assert.equal((await api('POST', '/approvals/days/resubmit', { branch_id: S.branchTwo, date: today }, S.b2Token)).status, 200);
  const queue4 = await api('GET', '/approvals/pending', undefined, S.token);
  assert.ok(queue4.data.days.some((d) => d.branch_id === S.branchTwo && d.date === today));

  // Accept again, then resubmitting an accepted day is refused…
  assert.equal((await api('POST', '/approvals/days/accept', { branch_id: S.branchTwo, date: today }, S.token)).status, 200);
  const lateResubmit = await api('POST', '/approvals/days/resubmit', { branch_id: S.branchTwo, date: today }, S.b2Token);
  assert.equal(lateResubmit.status, 400);
  // …and a Main Branch day can never be reviewed.
  const mainDay = await api('POST', '/approvals/days/accept', { branch_id: BRANCH_ID, date: today }, S.token);
  assert.equal(mainDay.status, 400);
});

test('approvals: Main Branch entries stay immediate — nothing waits', async () => {
  const med = await api('POST', '/medicines', medPayload('Main Med', 'MAINMED001', 12), S.token);
  assert.equal(med.status, 201);
  assert.equal(med.data.medicine.approval_status, 'approved');

  const pur = await api(
    'POST',
    '/purchases',
    {
      invoice_no: 'MAIN-INV-1',
      items: [{ medicine_id: med.data.medicine.id, batch_no: 'MAIN-B1', expiry_date: dayStr(365), quantity: 7, purchase_price: 6 }],
    },
    S.token
  );
  assert.equal(pur.status, 201);
  assert.equal(pur.data.purchase.approval_status, 'approved');
  assert.equal(await batchQty('MAIN-B1'), 7);

  // The Main admin's own review list is empty: the Main Branch is the
  // reviewer, never the reviewed.
  const mine = await api('GET', '/approvals/my-branch', undefined, S.token);
  assert.equal(mine.status, 200);
  assert.deepEqual(mine.data.medicines, []);
  assert.deepEqual(mine.data.purchases, []);
  assert.deepEqual(mine.data.days, []);

  // The notification counts count only the queue: the waiting medicine
  // from the purchase test is still pending, nothing else is.
  const counts = await api('GET', '/approvals/counts', undefined, S.token);
  assert.equal(counts.status, 200);
  assert.equal(counts.data.is_main_admin, true);
  assert.equal(Number(counts.data.counts.medicines), 1); // B2 Waiting
  assert.equal(Number(counts.data.counts.purchases), 0);
  assert.equal(Number(counts.data.counts.days), 0);
});

test('branches: only the Main Branch admin can create, edit or delete a branch', async () => {
  // An admin who works in Branch Two.
  const created = await api(
    'POST',
    '/settings/users',
    { full_name: 'Branch Two Admin', username: 'b2admin', password: 'admin123', role: 'admin', branch_id: S.branchTwo },
    S.token
  );
  assert.equal(created.status, 201);
  const login = await api('POST', '/auth/login', { username: 'b2admin', password: 'admin123' });
  assert.equal(login.status, 200);
  const b2Admin = login.data.token;

  // Reading the list still works — the user form's branch dropdown
  // needs it — but no change goes through from a child branch.
  const list = await api('GET', '/branches', undefined, b2Admin);
  assert.equal(list.status, 200);
  const create = await api('POST', '/branches', { name: 'Sneaky Branch' }, b2Admin);
  assert.equal(create.status, 403);
  const update = await api('PUT', `/branches/${S.branchTwo}`, { name: 'Renamed' }, b2Admin);
  assert.equal(update.status, 403);
  const remove = await api('DELETE', `/branches/${S.branchTwo}`, undefined, b2Admin);
  assert.equal(remove.status, 403);

  // The Main admin still can: create and delete a temporary branch.
  const temp = await api('POST', '/branches', { name: 'Temp Two' }, S.token);
  assert.equal(temp.status, 201);
  const del = await api('DELETE', `/branches/${temp.data.branch.id}`, undefined, S.token);
  assert.equal(del.status, 200);
  const list2 = await api('GET', '/branches', undefined, S.token);
  assert.equal(list2.data.branches.length, 2);
});

test('settings: a child-branch admin sees and manages only their own branch users', async () => {
  const login = await api('POST', '/auth/login', { username: 'b2admin', password: 'admin123' });
  assert.equal(login.status, 200);
  const b2Admin = login.data.token;

  // The child admin's user list holds only Branch Two users…
  const mine = await api('GET', '/settings/users', undefined, b2Admin);
  assert.equal(mine.status, 200);
  assert.ok(mine.data.users.length >= 3); // b2cashier, b2pharm, b2admin
  assert.ok(mine.data.users.every((u) => u.branch_id === S.branchTwo));
  // …while the Main admin still sees every branch.
  const all = await api('GET', '/settings/users', undefined, S.token);
  assert.ok(all.data.users.some((u) => u.branch_id === BRANCH_ID));
  assert.ok(all.data.users.some((u) => u.branch_id === S.branchTwo));
  const mainCashier = all.data.users.find((u) => u.username === 'testcashier');
  assert.ok(mainCashier);

  // Creating a user in the Main Branch is refused…
  const cross = await api(
    'POST',
    '/settings/users',
    { full_name: 'Sneaky', username: 'sneaky1', password: 'sneaky1', role: 'cashier', branch_id: BRANCH_ID },
    b2Admin
  );
  assert.equal(cross.status, 403);
  // …creating one at home works, and lands in the child branch.
  const home = await api(
    'POST',
    '/settings/users',
    { full_name: 'Branch Two Cashier 2', username: 'b2cashier2', password: 'cashier1', role: 'cashier' },
    b2Admin
  );
  assert.equal(home.status, 201);
  assert.equal(home.data.user.branch_id, S.branchTwo);

  // Touching a Main Branch user is refused in every direction.
  const deact = await api('PATCH', `/settings/users/${mainCashier.id}/active`, { is_active: false }, b2Admin);
  assert.equal(deact.status, 403);
  const reset = await api('POST', `/settings/users/${mainCashier.id}/reset-password`, { password: 'newpass1' }, b2Admin);
  assert.equal(reset.status, 403);
  const del = await api('DELETE', `/settings/users/${mainCashier.id}`, undefined, b2Admin);
  assert.equal(del.status, 403);

  // Managing an own-branch user still works (deactivate, then back).
  const b2cashier = mine.data.users.find((u) => u.username === 'b2cashier');
  assert.ok(b2cashier);
  assert.equal((await api('PATCH', `/settings/users/${b2cashier.id}/active`, { is_active: false }, b2Admin)).status, 200);
  assert.equal((await api('PATCH', `/settings/users/${b2cashier.id}/active`, { is_active: true }, b2Admin)).status, 200);
});

test('reports + audit: cross-branch views belong to the Main admin alone', async () => {
  const login = await api('POST', '/auth/login', { username: 'b2admin', password: 'admin123' });
  assert.equal(login.status, 200);
  const b2Admin = login.data.token;

  const central = await api('GET', '/reports/central', undefined, b2Admin);
  assert.equal(central.status, 403);
  const centralMain = await api('GET', '/reports/central', undefined, S.token);
  assert.equal(centralMain.status, 200);

  // The child admin's audit view holds only Branch Two entries (plus
  // system rows with no branch) — never the Main Branch's.
  const log = await api('GET', '/settings/audit-log?limit=200', undefined, b2Admin);
  assert.equal(log.status, 200);
  assert.ok(log.data.entries.length >= 1);
  assert.ok(log.data.entries.every((e) => e.branch_name === 'Branch Two' || e.branch_name === null));
  assert.ok(!log.data.entries.some((e) => e.branch_name === 'Test Branch'));

  const logMain = await api('GET', '/settings/audit-log?limit=200', undefined, S.token);
  assert.equal(logMain.status, 200);
  assert.ok(logMain.data.entries.some((e) => e.branch_name === 'Test Branch'));
});

test('reports: the Main admin reads another branch reports, a child admin cannot', async () => {
  // Branch Two sold twice today in the day-review test (1 unit at 10
  // AFN each); the Main admin reads exactly those figures by branch.
  const b2daily = await api('GET', `/reports/daily?date=${dayStr(0)}&branch_id=${S.branchTwo}`, undefined, S.token);
  assert.equal(b2daily.status, 200);
  assert.equal(Number(b2daily.data.summary.sales_count), 2);
  assert.equal(Number(b2daily.data.summary.revenue), 20);
  assert.equal(Number(b2daily.data.summary.items_sold), 2);
  assert.equal(b2daily.data.sales.length, 2);

  // The same call without the parameter reads the Main branch instead.
  const own = await api('GET', `/reports/daily?date=${dayStr(0)}`, undefined, S.token);
  assert.equal(own.status, 200);
  assert.ok(Number(own.data.summary.sales_count) > 2);

  // Monthly and stock-value honor the parameter too.
  const b2monthly = await api('GET', `/reports/monthly?branch_id=${S.branchTwo}`, undefined, S.token);
  assert.equal(b2monthly.status, 200);
  assert.equal(Number(b2monthly.data.summary.sales_count), 2);
  const b2stock = await api('GET', `/reports/stock-value?branch_id=${S.branchTwo}`, undefined, S.token);
  assert.equal(b2stock.status, 200);
  assert.ok(Array.isArray(b2stock.data.medicines));

  // An unknown branch id is a 400, not a silent fallback to own numbers.
  const bogus = await api('GET', `/reports/daily?date=${dayStr(0)}&branch_id=does-not-exist`, undefined, S.token);
  assert.equal(bogus.status, 400);

  // A child-branch admin asking for the Main branch still gets their
  // own branch's numbers — the parameter is ignored for them.
  const login = await api('POST', '/auth/login', { username: 'b2admin', password: 'admin123' });
  assert.equal(login.status, 200);
  const childView = await api(
    'GET',
    `/reports/daily?date=${dayStr(0)}&branch_id=${BRANCH_ID}`,
    undefined,
    login.data.token
  );
  assert.equal(childView.status, 200);
  assert.equal(Number(childView.data.summary.sales_count), 2);
  assert.equal(Number(childView.data.summary.revenue), 20);
});

test('approvals: editing or deleting an approved purchase re-pends its day', async () => {
  const today = dayStr(0);
  // A fresh approved purchase in Branch Two, through the normal flow:
  // created waiting, then accepted by the Main admin.
  const pur = await api(
    'POST',
    '/purchases',
    {
      invoice_no: 'B2-EDIT-1',
      items: [{ medicine_id: S.b2MedA, batch_no: 'B2-EDIT', expiry_date: dayStr(365), quantity: 5, purchase_price: 8 }],
    },
    S.b2Token
  );
  assert.equal(pur.status, 201);
  assert.equal(pur.data.purchase.approval_status, 'pending');
  const acceptPur = await api('POST', `/approvals/purchases/${pur.data.purchase.id}/accept`, undefined, S.token);
  assert.equal(acceptPur.status, 200);

  // The boss accepts the day; the branch then edits the purchase (the
  // quantity changes, so the day's purchase figures change too).
  assert.equal((await api('POST', '/approvals/days/accept', { branch_id: S.branchTwo, date: today }, S.token)).status, 200);
  const edited = await api(
    'PUT',
    `/purchases/${pur.data.purchase.id}`,
    {
      invoice_no: 'B2-EDIT-1',
      items: [{ medicine_id: S.b2MedA, batch_no: 'B2-EDIT', expiry_date: dayStr(365), quantity: 7, purchase_price: 8 }],
    },
    S.b2Token
  );
  assert.equal(edited.status, 200);
  const queue = await api('GET', '/approvals/pending', undefined, S.token);
  assert.equal(queue.status, 200);
  assert.ok(queue.data.days.some((d) => d.branch_id === S.branchTwo && d.date === today));

  // Accept again, then delete the purchase — pending once more.
  assert.equal((await api('POST', '/approvals/days/accept', { branch_id: S.branchTwo, date: today }, S.token)).status, 200);
  const deleted = await api('DELETE', `/purchases/${pur.data.purchase.id}`, undefined, S.b2Token);
  assert.equal(deleted.status, 200);
  const queue2 = await api('GET', '/approvals/pending', undefined, S.token);
  assert.equal(queue2.status, 200);
  assert.ok(queue2.data.days.some((d) => d.branch_id === S.branchTwo && d.date === today));

  // Editing a purchase that is still waiting does NOT disturb the
  // accepted day — its figures were never part of the review.
  const waiting = await api(
    'POST',
    '/purchases',
    {
      invoice_no: 'B2-EDIT-2',
      items: [{ medicine_id: S.b2MedA, batch_no: 'B2-EDIT2', expiry_date: dayStr(365), quantity: 3, purchase_price: 8 }],
    },
    S.b2Token
  );
  assert.equal(waiting.status, 201);
  assert.equal((await api('POST', '/approvals/days/accept', { branch_id: S.branchTwo, date: today }, S.token)).status, 200);
  const editedWaiting = await api(
    'PUT',
    `/purchases/${waiting.data.purchase.id}`,
    {
      invoice_no: 'B2-EDIT-2',
      items: [{ medicine_id: S.b2MedA, batch_no: 'B2-EDIT2', expiry_date: dayStr(365), quantity: 4, purchase_price: 8 }],
    },
    S.b2Token
  );
  assert.equal(editedWaiting.status, 200);
  const queue3 = await api('GET', '/approvals/pending', undefined, S.token);
  assert.equal(queue3.status, 200);
  assert.ok(!queue3.data.days.some((d) => d.branch_id === S.branchTwo && d.date === today));
});
