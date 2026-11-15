// Audit log — records who did what, and when.
//
// The audit_log table is append-only: nothing in the app ever updates or
// deletes its rows, so the history can be trusted. Every money or stock
// movement, every user-administration action and every backup action is
// recorded here with the logged-in user, the branch, and a short summary.
//
// Writes are fire-and-forget: a failed audit insert must NEVER break the
// action it records, so failures are only written to the server console.
// Callers use it without await, right after their own work commits.
const crypto = require('crypto');
const pool = require('./db');

async function auditLog(req, action, tableName, recordId, details) {
  try {
    const user = req && req.user ? req.user : null;
    await pool.query(
      'INSERT INTO audit_log (id, branch_id, user_id, action, table_name, record_id, details) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        crypto.randomUUID(),
        user ? user.branch_id || null : null,
        user ? user.sub || null : null,
        action,
        tableName,
        recordId || null,
        details ? JSON.stringify(details) : null,
      ]
    );
  } catch (err) {
    console.error('audit log failed:', err.message);
  }
}

module.exports = { auditLog };
