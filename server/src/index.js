// Pharmacy Management System — Backend entry point
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const pool = require('./db');
const authRoutes = require('./routes/auth');
const medicinesRoutes = require('./routes/medicines');
const suppliersRoutes = require('./routes/suppliers');
const purchasesRoutes = require('./routes/purchases');
const stockRoutes = require('./routes/stock');
const customersRoutes = require('./routes/customers');
const salesRoutes = require('./routes/sales');

const app = express();
app.use(cors());
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

const PORT = Number(process.env.PORT) || 5000;
app.listen(PORT, () => {
  console.log(`Pharmacy server running on http://localhost:${PORT}`);
});
