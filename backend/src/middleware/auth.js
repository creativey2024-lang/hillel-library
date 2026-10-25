const { verify } = require('../util/tokens');

// Every browser tab keeps its own session (so two people - or two accounts -
// can use two tabs on the same computer without swapping users). A tab sends
// its token in this header; without it we fall back to the shared cookie.
const TAB_SESSION_HEADER = 'x-hillel-session';

function sessionTokenFrom(req, cookies) {
  const fromTab = req.headers && req.headers[TAB_SESSION_HEADER];
  if (typeof fromTab === 'string' && fromTab.length > 10 && fromTab.length < 4096) return fromTab;
  return (cookies || req.cookies || {})['hillel_session'];
}

// Reads the signed session cookie (if any) on every request and attaches the
// logged-in user to req.user. Does not block the request - use requireAuth /
// requireAdmin below on routes that need to enforce it.
function attachUser(jwtSecret, { lookupStaff } = {}) {
  return async (req, res, next) => {
    const token = sessionTokenFrom(req);
    const payload = token ? verify(token, jwtSecret) : null;
    req.user = payload
      ? {
          username: payload.username,
          role: payload.role,
          isSuperAdmin: Boolean(payload.isSuperAdmin),
        }
      : null;
    // A login lasts a while, but someone removed from the staff loses access
    // right away, and a changed role counts right away (not at the next login).
    if (req.user && lookupStaff && !payload.pending) {
      try {
        const member = await lookupStaff(req.user.username);
        if (!member) req.user = null;
        else if (!req.user.isSuperAdmin) req.user.role = member.role === 'admin' ? 'admin' : 'librarian';
      } catch (err) {
        // the staff list couldn't be read: keep what the login says
      }
    }
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

module.exports = { attachUser, requireAuth, requireAdmin, sessionTokenFrom, TAB_SESSION_HEADER };
