// Pharmacy Management System — Backend entry point
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const pool = require('./db');

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

const PORT = Number(process.env.PORT) || 5000;
app.listen(PORT, () => {
  console.log(`Pharmacy server running on http://localhost:${PORT}`);
});
