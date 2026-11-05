// Auth middleware — verifies the JWT sent as: Authorization: Bearer <token>
const jwt = require('jsonwebtoken');

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

module.exports = { authRequired, requireRole };
