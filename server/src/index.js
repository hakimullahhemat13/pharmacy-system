// Pharmacy Management System — Backend entry point
// The pharmacy is in Afghanistan: force the server's timezone to
// Asia/Kabul (UTC+4:30, no DST) so every date/time the server produces
// — sale times, "today", Day Close dates, backups — matches the
// pharmacy's clock, even if the computer's own timezone is set wrong.
process.env.TZ = 'Asia/Kabul';
const express = require('express');
const cors = require('cors');
require('dotenv').config();

// Without a JWT secret, signing a token throws and every login 500s
// while /api/health still passes — fail loudly at startup instead of
// running a server nobody can log into.
if (!process.env.JWT_SECRET) {
  console.error(
    'JWT_SECRET is not set. Set JWT_SECRET in server/.env (a long random string) and restart the server.'
  );
  process.exit(1);
}

const pool = require('./db');
const authRoutes = require('./routes/auth');
const medicinesRoutes = require('./routes/medicines');
const suppliersRoutes = require('./routes/suppliers');
const purchasesRoutes = require('./routes/purchases');
const stockRoutes = require('./routes/stock');
const customersRoutes = require('./routes/customers');
const salesRoutes = require('./routes/sales');
const reportsRoutes = require('./routes/reports');
const backupRoutes = require('./routes/backup');
const settingsRoutes = require('./routes/settings');
const branchesRoutes = require('./routes/branches');
const approvalsRoutes = require('./routes/approvals');

const app = express();
// CORS is NOT open to every origin: only the local frontend, the phone
// over the same Wi-Fi (private LAN IPs) and over Tailscale (*.ts.net)
// may call this API. Requests with no Origin (curl, mobile apps) are
// allowed; anything else is rejected.
function isAllowedOrigin(origin) {
  if (!origin) return true;
  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  const host = url.hostname;
  // localhost:5173 is the web frontend; https://localhost with no port
  // is the Android app (Capacitor loads at https://localhost).
  if (host === 'localhost' || host === '127.0.0.1') return url.port === '5173' || url.port === '';
  if (host.endsWith('.ts.net')) return true;
  if (/^192\.168\.\d+\.\d+$/.test(host)) return true;
  if (/^10\.\d+\.\d+\.\d+$/.test(host)) return true;
  const m = /^172\.(\d+)\.\d+\.\d+$/.exec(host);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  return false;
}
app.use(
  cors({
    origin(origin, cb) {
      if (isAllowedOrigin(origin)) return cb(null, true);
      return cb(new Error('Not allowed by CORS'));
    },
  })
);
app.use(express.json());

// Health check: confirms server is up AND database answers
app.get('/api/health', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT 1 AS ok');
    res.json({ status: 'ok', database: rows[0].ok === 1 ? 'connected' : 'unknown' });
  } catch (err) {
    res.status(500).json({ status: 'error', database: 'not connected', message: err.code || err.message });
  }
});

// Auth: login + current user
app.use('/api/auth', authRoutes);

// Medicines: add, list, search, barcode lookup
app.use('/api/medicines', medicinesRoutes);

// Suppliers, purchases (stock in) and stock views
app.use('/api/suppliers', suppliersRoutes);
app.use('/api/purchases', purchasesRoutes);
app.use('/api/stock', stockRoutes);

// Customers and sales (point of sale, FEFO)
app.use('/api/customers', customersRoutes);
app.use('/api/sales', salesRoutes);

// Reports: daily, monthly, yearly (sales + profit)
app.use('/api/reports', reportsRoutes);

// Backup & restore (download: every user; restore + automatic backup: admin)
app.use('/api/backup', backupRoutes);
backupRoutes.startAutoBackup();

// Settings: own password/language; admin: branch info + users
app.use('/api/settings', settingsRoutes);

// Branches: admin-only branch management (multi-branch use)
app.use('/api/branches', branchesRoutes);

// Approvals: the Main Branch admin's review queue for child branches
app.use('/api/approvals', approvalsRoutes);

const PORT = Number(process.env.PORT) || 5000;
app.listen(PORT, () => {
  console.log(`Pharmacy server running on http://localhost:${PORT}`);
});
