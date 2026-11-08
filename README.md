# Pharmacy Management System

A complete management system for a pharmacy — medicines and stock, purchases, customers, a fast point-of-sale with returns, and daily profit reports — built to run on the pharmacy's own computer, in **Pashto, Dari and English**.

![Dashboard](docs/screenshots/dashboard.png)

## The problem

Many small pharmacies still track stock, expiry dates and daily profit in paper notebooks. Expired medicines get sold by mistake, stock counts drift away from reality, and the owner cannot answer a simple question at the end of the day: *what did we sell today, and what profit did we make?*

## The solution

A full-stack web application that runs locally (no internet needed) and handles the whole workflow:

- **Medicines & stock** — every medicine with its batches and expiry dates; entry by **barcode scanner or keyboard**
- **Purchases** — stock enters only through purchases from suppliers, recorded batch by batch
- **Point of sale** — scan a barcode and the medicine lands on the bill; selling follows **FEFO** (first-expiry, first-out), and **expired batches can never be sold**
- **Customers** — a customer register with search by name or phone, a full purchase history for each customer, and edit / soft-delete
- **Sales returns** — a bill can be corrected after the fact: returned items go back into the exact batch they were sold from, the refund is calculated per item, a return can never exceed what was actually sold, and reports net returns against revenue and profit
- **Expiry warnings** — the dashboard flags batches that are expired or critical (≤ 30 days); the warning period is set **per medicine** (in months, default 3), because a slow-moving medicine and a fast-moving one should not warn at the same time
- **Reports** — daily, monthly and yearly reports with revenue, cost of goods and **real profit** (each sale keeps a snapshot of its batch cost, so reports stay correct even when prices change)
- **Settings & user management** — every user can change their own password and interface language; admins manage the pharmacy's branch details and user accounts (roles: admin / pharmacist / cashier, with activate / deactivate)
- **Backup & restore** — admins can download a full database backup and restore from one, right inside the app
- **Three languages** — Pashto (default, RTL), Dari (RTL) and English (LTR), switchable at any time

## Screenshots

| Login (Pashto) | Medicines |
| --- | --- |
| ![Login](docs/screenshots/login.png) | ![Medicines](docs/screenshots/medicines.png) |

| Point of sale | Reports |
| --- | --- |
| ![Sales](docs/screenshots/sales.png) | ![Reports](docs/screenshots/reports.png) |

## Tech stack

| Layer | Technology |
| --- | --- |
| Frontend | React 18, TypeScript, Vite |
| Backend | Node.js, Express |
| Database | MySQL 8 (InnoDB, 12 tables) |
| Auth | JWT + bcrypt password hashing, role-based access (admin / pharmacist / cashier) |

## Design decisions

- **Stock is a ledger, not a number.** Every stock movement is an append-only row in `stock_transactions`; batch quantities are a cache that can always be reconciled against the ledger.
- **Sales and purchases are single database transactions** — a bill is recorded completely or not at all, so a crash can never corrupt stock.
- **FEFO allocation with row locks** — the earliest-expiring sellable batch is always sold first, and expired stock is excluded in the query itself, not just hidden in the UI.
- **Branch-scoped data** — every record carries a `branch_id` taken from the user's login token (never from the request), so the same system serves one pharmacy or many branches without mixing data.
- **Backup that is actually tested** — a daily `mysqldump` backup, with a restore into a separate test database verified end-to-end.

## Run it locally

**Prerequisites:** Node.js 20+ and MySQL 8.

```bash
git clone https://github.com/hakimullahhemat13/pharmacy-system.git
cd pharmacy-system
```

**1. Database** — create the database and load the schema:

```sql
CREATE DATABASE pharmacy_db CHARACTER SET utf8mb4;
```

```bash
mysql -u root -p pharmacy_db < database/schema.sql
```

Create a dedicated app user (do not use root) and grant it access to `pharmacy_db`.

**2. Backend:**

```bash
cd server
copy .env.example .env   # then fill in DB_PASSWORD and a long JWT_SECRET
npm install
npm run dev              # http://localhost:5000  — check /api/health
```

**3. First admin user** (run once, from the `server` folder, with the
`ADMIN_USERNAME`, `ADMIN_FULL_NAME` and `ADMIN_PASSWORD` environment
variables set):

```bash
node scripts/create-admin.js
```

**4. Frontend:**

```bash
cd ../client
npm install
npm run dev              # http://localhost:5173
```

Log in with the admin user and the system is ready.

## API overview

| Area | Endpoints |
| --- | --- |
| Auth | `POST /api/auth/login`, `GET /api/auth/me` |
| Medicines | `GET/POST /api/medicines` (search + exact barcode lookup) |
| Stock | `GET /api/stock`, `GET /api/stock/expiring` |
| Purchases | `GET/POST /api/purchases`, `GET/POST /api/suppliers` |
| Sales | `GET/POST /api/sales`, `POST /api/sales/:id/return` |
| Customers | `GET/POST /api/customers`, `GET /api/customers/:id/history`, `PUT/DELETE /api/customers/:id` |
| Reports | `GET /api/reports/daily`, `/monthly`, `/yearly` |
| Settings | `POST /api/settings/password`, `PUT /api/settings/language`, `GET/PUT /api/settings/branch`, `GET/POST /api/settings/users` |
| Backup | `GET /api/backup/download`, `POST /api/backup/restore` (admin only) |

## Status & roadmap

Phase 1 (local, single computer) is complete and in daily-test use —
including customers, sales returns, settings with user management, and
in-app backup & restore.
Planned next: printed receipts, supplier account balances, and an online
multi-branch version with synchronisation, followed by a mobile app.

---

Built by **Hakimullah Hemat** — full-stack web developer (React · Node.js · MySQL), available for freelance projects: management systems for pharmacies, shops and small businesses.
