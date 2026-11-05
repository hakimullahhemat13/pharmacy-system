// Reset the password of an existing user — run from the server folder:
//   node scripts/reset-admin-password.js
// Values come from environment variables, never from code or git:
//   ADMIN_USERNAME (optional, default "admin"), ADMIN_PASSWORD (required)
// The PowerShell wrapper sets ADMIN_PASSWORD from a hidden prompt (typed
// twice and checked equal first), so the password never appears on screen,
// in shell history, or in any file.
const bcrypt = require('bcryptjs');

const pool = require('../src/db');

async function main() {
  const username = (process.env.ADMIN_USERNAME || 'admin').trim();
  const password = process.env.ADMIN_PASSWORD || '';

  if (!password) {
    console.error('Missing value: ADMIN_PASSWORD must be set.');
    process.exit(1);
  }
  if (password.length < 6) {
    console.error('Password is too short (minimum 6 characters). A longer one is strongly recommended.');
    process.exit(1);
  }

  const [rows] = await pool.query(
    'SELECT id, username, LENGTH(password_hash) AS hash_len FROM users WHERE username = ? AND is_deleted = 0 LIMIT 1',
    [username]
  );
  if (rows.length === 0) {
    console.error(`User "${username}" not found — nothing changed.`);
    process.exit(1);
  }
  console.log(`Found user: ${rows[0].username} (current hash length: ${rows[0].hash_len})`);

  const passwordHash = await bcrypt.hash(password, 12);
  const [result] = await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [
    passwordHash,
    rows[0].id,
  ]);
  console.log(`Password updated for user: ${username} (rows changed: ${result.affectedRows})`);
}

main()
  .catch((err) => {
    console.error('Failed:', err.code || err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
