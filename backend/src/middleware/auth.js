const { verify } = require('../util/tokens');

// Reads the signed session cookie (if any) on every request and attaches the
// logged-in user to req.user. Does not block the request - use requireAuth /
// requireAdmin below on routes that need to enforce it.
function attachUser(jwtSecret) {
  return (req, res, next) => {
    const token = req.cookies['hillel_session'];
    const payload = token ? verify(token, jwtSecret) : null;
    req.user = payload
      ? {
          username: payload.username,
          role: payload.role,
          isSuperAdmin: Boolean(payload.isSuperAdmin),
        }
      : null;
    next();
  };
}

function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'נדרשת התחברות למערכת' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'נדרשת התחברות למערכת' });
  }
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'הפעולה מורשית למנהלים בלבד' });
  }
  next();
}

module.exports = { attachUser, requireAuth, requireAdmin };
