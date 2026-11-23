// Database connection pool (mysql2/promise)
// The app connects with its OWN user (pharmacy_app), never root.
const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
  // Dates come back as 'YYYY-MM-DD HH:mm:ss' strings in the COMPUTER's
  // (server's) local time, not as Date objects. Without this, Express
  // serialises Date objects to UTC ISO strings, so a sale made at 14:30
  // Afghanistan time showed as 10:00 on the bill (UTC, 4.5h behind).
  // With this, the bill time — and every other displayed time — matches
  // the computer's clock.
  dateStrings: true,
  // MySQL session timezone: Afghanistan (UTC+4:30, no DST). This makes
  // NOW()/CURRENT_TIMESTAMP — the default for sale_date, created_at, etc.
  // — return Afghanistan time even if the computer's timezone is set
  // wrong. The fixed offset needs no timezone tables in MySQL.
  timezone: '+04:30',
});

module.exports = pool;
