// Auth middleware — verifies the JWT sent as: Authorization: Bearer <token>
const jwt = require('jsonwebtoken');

const pool = require('../db');
const { getMainBranchId } = require('../mainBranch');

function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ status: 'error', message: 'Login required' });
  }
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    return next();
  } catch (err) {
    return res.status(401).json({ status: 'error', message: 'Session expired or invalid token' });
  }
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
