// Create the first Admin user — run ONCE from the server folder:
//   node scripts/create-admin.js
// Values come from environment variables, never from code or git:
//   ADMIN_USERNAME, ADMIN_FULL_NAME, ADMIN_PASSWORD, BRANCH_NAME (optional)
// The PowerShell wrapper sets ADMIN_PASSWORD from a hidden prompt, so the
// password never appears on screen, in shell history, or in any file.
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const pool = require('../src/db');

async function main() {
  const username = (process.env.ADMIN_USERNAME || '').trim();
  const fullName = (process.env.ADMIN_FULL_NAME || '').trim();
  const password = process.env.ADMIN_PASSWORD || '';
  const branchName = (process.env.BRANCH_NAME || 'Main Branch').trim();

  if (!username || !fullName || !password) {
    console.error('Missing values: ADMIN_USERNAME, ADMIN_FULL_NAME and ADMIN_PASSWORD must all be set.');
    process.exit(1);
  }
  if (username.length < 3) {
    console.error('Username is too short (minimum 3 characters).');
    process.exit(1);
  }
  if (password.length < 6) {
    console.error('Password is too short (minimum 6 characters). A longer one is strongly recommended.');
    process.exit(1);
  }

  const [existing] = await pool.query('SELECT id FROM users WHERE username = ? LIMIT 1', [username]);
  if (existing.length > 0) {
    console.log(`User "${username}" already exists — nothing changed.`);
    return;
  }

  let [branches] = await pool.query(
    'SELECT id, name FROM branches WHERE is_deleted = 0 ORDER BY created_at LIMIT 1'
  );
  let branch = branches[0];
  if (!branch) {
    branch = { id: uuidv4(), name: branchName };
    await pool.query('INSERT INTO branches (id, name) VALUES (?, ?)', [branch.id, branch.name]);
    console.log(`Branch created: ${branch.name}`);
  } else {
    console.log(`Using existing branch: ${branch.name}`);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const userId = uuidv4();
  await pool.query(
    'INSERT INTO users (id, branch_id, full_name, username, password_hash, role, language, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)',
    [userId, branch.id, fullName, username, passwordHash, 'admin', 'ps']
  );
  console.log(`Admin user created: ${username} (role: admin)`);
}

main()
  .catch((err) => {
    console.error('Failed:', err.code || err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
