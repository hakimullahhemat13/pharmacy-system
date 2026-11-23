// Auth middleware — verifies the JWT sent as: Authorization: Bearer <token>,
// then re-checks the user row: a deactivated or deleted user loses access
// at once, even though the token itself has no expiry (owner's choice —
// the session stays valid until logout). Role and branch are re-read
// from the database on every request, so a role/branch change applies
// at once instead of waiting for the next login. A password change
// (or admin reset) bumps token_version, which invalidates every
// existing session; deactivation/deletion is the other kill switch.
const jwt = require('jsonwebtoken');

const pool = require('../db');
const { getMainBranchId } = require('../mainBranch');

async function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ status: 'error', message: 'Login required' });
  }
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ status: 'error', message: 'Session expired or invalid token' });
  }
  try {
    const [rows] = await pool.query(
      'SELECT id, role, branch_id, token_version, is_active, is_deleted FROM users WHERE id = ? LIMIT 1',
      [decoded.sub]
    );
    const user = rows[0];
    if (!user || !user.is_active || user.is_deleted) {
      return res.status(401).json({ status: 'error', message: 'Session expired or invalid token' });
    }
    // The token's role/branch are stale the moment an admin changes
    // them, so the database row wins on every request.
    if ((decoded.token_version ?? 0) !== (user.token_version ?? 0)) {
      return res.status(401).json({ status: 'error', message: 'Session expired or invalid token' });
    }
    decoded.role = user.role;
    decoded.branch_id = user.branch_id;
    decoded.token_version = user.token_version ?? 0;
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
  req.user = decoded;
  return next();
}

// Use after authRequired, e.g. requireRole('admin')
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ status: 'error', message: 'You do not have permission for this' });
    }
    return next();
  };
}

// Use after authRequired: only an admin of the Main Branch (the oldest
// branch) passes. A child-branch admin is refused, even with role
// admin — branches are created and managed from the head office only.
async function requireMainAdmin(req, res, next) {
  try {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ status: 'error', message: 'You do not have permission for this' });
    }
    const mainId = await getMainBranchId(pool);
    if (req.user.branch_id !== mainId) {
      return res.status(403).json({ status: 'error', message: 'Only the Main Branch admin can do this' });
    }
    return next();
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.code || err.message });
  }
}

module.exports = { authRequired, requireRole, requireMainAdmin };
