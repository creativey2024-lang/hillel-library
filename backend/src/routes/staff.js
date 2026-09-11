const { Router } = require('../http/miniHttp');
const store = require('../services/store');
const credentials = require('../services/credentialsStore');
const permissions = require('../services/permissions');
const { validateUsername } = require('../services/validation');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// Whether someone is the super-admin is always decided by comparing their
// username to SUPER_ADMIN_USERNAME - never by trusting a stored field. This
// matters because the real Firestore data (created by the old app, before
// this backend existed) never had an "isSuperAdmin" field on its documents,
// so trusting a stored value would make Mark look like a regular admin the
// moment the server connects to the live cloud database.
function publicStaff(member, superAdminUsername) {
  return {
    id: member.id,
    username: member.username,
    role: member.role,
    isSuperAdmin: member.username === superAdminUsername,
  };
}

function createStaffRouter({ superAdminUsername, defaultPassword }) {
  const router = new Router();

  router.get('/', requireAuth, async (req, res) => {
    const staff = await store.listStaff();
    res.json(staff.map((member) => publicStaff(member, superAdminUsername)));
  });

  // Add a brand-new staff member, or update the role of an existing one
  // (mirrors the original single "add / update" form).
  router.post('/', requireAdmin, async (req, res) => {
    const usernameCheck = validateUsername((req.body || {}).username);
    if (!usernameCheck.valid) return res.status(400).json({ error: usernameCheck.error });

    const username = usernameCheck.username;
    const role = (req.body || {}).role === 'admin' ? 'admin' : 'librarian';

    if (!permissions.canAssignRole(req.user, role, superAdminUsername)) {
      return res.status(403).json({ error: 'רק מארק רשאי להוסיף מנהלים חדשים למערכת!' });
    }

    const existing = await store.findStaffByUsername(username);
    if (existing) {
      if (existing.role !== role && !permissions.canChangeRole(req.user, existing.username, superAdminUsername)) {
        return res.status(403).json({ error: 'רק מארק רשאי לשנות תפקידים של אנשי צוות!' });
      }
      const updated = await store.updateStaffRole(existing.id, role);
      return res.json({ updated: true, staff: publicStaff(updated || { ...existing, role }, superAdminUsername) });
    }

    const created = await store.addStaff({
      username,
      role,
      isSuperAdmin: false,
      createdAt: new Date().toISOString(),
    });

    if (!credentials.hasCredentials(username)) {
      credentials.setPassword(username, defaultPassword);
    }

    res.status(201).json({ created: true, staff: publicStaff(created, superAdminUsername), defaultPassword });
  });

  router.patch('/:id/role', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const role = (req.body || {}).role === 'admin' ? 'admin' : 'librarian';

    const staffList = await store.listStaff();
    const target = staffList.find((s) => s.id === id);
    if (!target) return res.status(404).json({ error: 'משתמש לא נמצא' });

    if (!permissions.canChangeRole(req.user, target.username, superAdminUsername)) {
      return res.status(403).json({ error: 'רק מארק רשאי להעניק או להסיר הרשאות מנהל!' });
    }

    const updated = await store.updateStaffRole(id, role);
    res.json({ staff: publicStaff(updated || { ...target, role }, superAdminUsername) });
  });

  router.delete('/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const staffList = await store.listStaff();
    const target = staffList.find((s) => s.id === id);
    if (!target) return res.status(404).json({ error: 'משתמש לא נמצא' });

    if (!permissions.canRemoveUser(req.user, target, superAdminUsername)) {
      return res.status(403).json({ error: 'אין הרשאה להסיר משתמש זה' });
    }

    await store.removeStaff(id);
    credentials.removeCredentials(target.username);
    res.json({ ok: true });
  });

  // New: lets an admin (or the user themself) set a real password, instead of
  // everyone being stuck on the old shared default password forever.
  router.post('/:id/reset-password', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { newPassword } = req.body || {};

    if (!newPassword || String(newPassword).length < 3) {
      return res.status(400).json({ error: 'סיסמה חייבת להכיל לפחות 3 תווים' });
    }

    const staffList = await store.listStaff();
    const target = staffList.find((s) => s.id === id);
    if (!target) return res.status(404).json({ error: 'משתמש לא נמצא' });

    if (!permissions.canResetPassword(req.user, target.username, superAdminUsername)) {
      return res.status(403).json({ error: 'אין הרשאה לאפס סיסמה זו' });
    }

    credentials.setPassword(target.username, newPassword);
    res.json({ ok: true });
  });

  return router;
}

module.exports = createStaffRouter;
