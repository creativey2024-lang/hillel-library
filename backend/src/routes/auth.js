const { Router } = require('../http/miniHttp');
const credentials = require('../services/credentialsStore');
const store = require('../services/store');
const tokens = require('../util/tokens');
const { serializeCookie } = require('../util/cookies');

// All authentication now happens here on the backend: the frontend never sees
// password hashes, the shared password, or the super-admin's second password -
// it only ever POSTs a username/password and gets back a signed session cookie.
function createAuthRouter({ jwtSecret, sessionTtlSeconds, pendingTtlSeconds, superAdminUsername, isProd }) {
  const router = new Router();

  function setSessionCookie(res, payload) {
    const token = tokens.sign(payload, jwtSecret, sessionTtlSeconds);
    res.setHeader('Set-Cookie', [
      serializeCookie('hillel_session', token, { maxAge: sessionTtlSeconds, secure: isProd }),
      serializeCookie('hillel_pending_super', '', { maxAge: 0, secure: isProd }),
    ]);
  }

  function setPendingCookie(res, username) {
    const token = tokens.sign({ username, pending: true }, jwtSecret, pendingTtlSeconds);
    res.setHeader(
      'Set-Cookie',
      serializeCookie('hillel_pending_super', token, { maxAge: pendingTtlSeconds, secure: isProd })
    );
  }

  function clearCookies(res) {
    res.setHeader('Set-Cookie', [
      serializeCookie('hillel_session', '', { maxAge: 0, secure: isProd }),
      serializeCookie('hillel_pending_super', '', { maxAge: 0, secure: isProd }),
    ]);
  }

  router.post('/login', async (req, res) => {
    try {
      const { username, password } = req.body || {};
      if (!username || !password) {
        return res.status(400).json({ error: 'נא למלא שם משתמש וסיסמה' });
      }

      const staffMember = await store.findStaffByUsername(username);
      const validCredentials = credentials.verify(username, password);

      if (!staffMember || !validCredentials) {
        return res
          .status(401)
          .json({ error: 'שם משתמש או סיסמה שגויים, או שאינך מורשה כניסה.' });
      }

      if (username === superAdminUsername) {
        setPendingCookie(res, username);
        return res.json({ requiresSuperVerification: true });
      }

      setSessionCookie(res, { username: staffMember.username, role: staffMember.role, isSuperAdmin: false });
      return res.json({ username: staffMember.username, role: staffMember.role, isSuperAdmin: false });
    } catch (err) {
      console.error('[auth] Login error:', err);
      res.status(500).json({ error: 'שגיאה זמנית בכניסה, אנא נסה שנית' });
    }
  });

  router.post('/verify-super', async (req, res) => {
    try {
      const pendingToken = req.cookies['hillel_pending_super'];
      const pending = pendingToken ? tokens.verify(pendingToken, jwtSecret) : null;

      if (!pending || pending.username !== superAdminUsername) {
        return res.status(401).json({ error: 'יש להתחיל מחדש בתהליך ההתחברות' });
      }

      const { password } = req.body || {};
      const ok = credentials.verifySecondary(superAdminUsername, password || '');
      if (!ok) {
        return res.status(401).json({ error: 'סיסמת מנהל על שגויה!' });
      }

      setSessionCookie(res, { username: superAdminUsername, role: 'admin', isSuperAdmin: true });
      return res.json({ username: superAdminUsername, role: 'admin', isSuperAdmin: true });
    } catch (err) {
      console.error('[auth] Super verification error:', err);
      res.status(500).json({ error: 'שגיאה זמנית, אנא נסה שנית' });
    }
  });

  router.post('/logout', (req, res) => {
    clearCookies(res);
    res.json({ ok: true });
  });

  router.get('/me', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'לא מחובר' });
    res.json(req.user);
  });

  return router;
}

module.exports = createAuthRouter;
