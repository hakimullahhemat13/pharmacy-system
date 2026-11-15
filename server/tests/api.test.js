// Automated API tests for the pharmacy backend.
//
// Run from the server folder:
//
//   npm test
//
// The suite starts the REAL server on port 5011 against a SEPARATE
// database (pharmacy_db_test) and drives it over HTTP, so it checks the
// same code the shop uses: FEFO selling, returns, reports, day close,
// roles and the audit log. It NEVER touches the real pharmacy_db.
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
const S = { token: null, cashierToken: null, medicineId: null, saleId: null, earlyItemId: null };

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
