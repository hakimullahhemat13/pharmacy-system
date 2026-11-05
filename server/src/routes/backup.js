// Backup & restore — ADMIN ONLY.
// Download: streams a mysqldump of the whole database to the browser.
// Restore: accepts a .sql dump as the request body and replays it,
// replacing ALL current data — the interface asks for confirmation first.
// The DB password reaches mysqldump through the MYSQL_PWD environment
// variable, so it never appears in the process arguments or any log.
const express = require('express');
const { spawn } = require('child_process');
const mysql = require('mysql2/promise');

const { authRequired, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired, requireRole('admin'));

function dbConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  };
}

router.get('/download', (req, res) => {
  const cfg = dbConfig();
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const filename =
    `pharmacy_db-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `_${pad(now.getHours())}${pad(now.getMinutes())}.sql`;

  const child = spawn(
    'mysqldump',
    [
      `--host=${cfg.host}`,
      `--port=${cfg.port}`,
      `--user=${cfg.user}`,
      '--single-transaction',
      '--default-character-set=utf8mb4',
      cfg.database,
    ],
    { env: { ...process.env, MYSQL_PWD: cfg.password } }
  );

  let headersSent = false;
  let stderr = '';
  child.stderr.on('data', (d) => {
    stderr += d.toString();
  });
  child.on('error', (err) => {
    if (!headersSent) {
      res
        .status(500)
        .json({ status: 'error', message: `mysqldump could not start: ${err.code || err.message}` });
    }
  });
  child.stdout.on('data', (chunk) => {
    if (!headersSent) {
      res.setHeader('Content-Type', 'application/sql; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      headersSent = true;
    }
    res.write(chunk);
  });
  child.on('close', (code) => {
    if (code !== 0 && !headersSent) {
      return res.status(500).json({
        status: 'error',
        message: `Backup failed: ${stderr.trim() || `mysqldump exited with code ${code}`}`,
      });
    }
    return res.end();
  });
});

router.post('/restore', express.text({ type: '*/*', limit: '100mb' }), async (req, res) => {
  const sql = typeof req.body === 'string' ? req.body : '';
  if (!sql.trim()) {
    return res.status(400).json({ status: 'error', message: 'No backup file content received' });
  }
  if (!sql.includes('CREATE TABLE')) {
    return res.status(400).json({
      status: 'error',
      message: 'This file does not look like a database backup (no CREATE TABLE found)',
    });
  }
  let conn;
  try {
    conn = await mysql.createConnection({ ...dbConfig(), multipleStatements: true, charset: 'utf8mb4' });
    await conn.query(sql);
    return res.json({ status: 'ok', message: 'Database restored from backup' });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  } finally {
    if (conn) await conn.end().catch(() => undefined);
  }
});

module.exports = router;
