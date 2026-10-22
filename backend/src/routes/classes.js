const { Router } = require('../http/miniHttp');
const store = require('../services/store');
const { validateClassName } = require('../services/validation');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// Admin-editable list of school classes. Reading needs a login; changing it
// needs the admin role (the super-admin is an admin too). The check is done
// here on the server, so hiding the button in the browser is only cosmetic.
function createClassesRouter() {
  const router = new Router();

  const publicClass = (c) => ({ id: c.id, name: c.name, order: c.order || 0 });

  router.get('/', requireAuth, async (req, res) => {
    const classes = await store.listClasses();
    res.json(classes.map(publicClass));
  });

  router.post('/', requireAdmin, async (req, res) => {
    const check = validateClassName((req.body || {}).name);
    if (!check.valid) return res.status(400).json({ error: check.error });

    const classes = await store.listClasses();
    if (classes.some((c) => c.name === check.name)) {
      return res.status(409).json({ error: 'כיתה בשם הזה כבר קיימת' });
    }
    const nextOrder = classes.reduce((max, c) => Math.max(max, c.order || 0), 0) + 1;
    const created = await store.addClass({ name: check.name, order: nextOrder });
    res.status(201).json(publicClass(created));
  });

  // Rename. Existing borrow records of the old class are moved to the new name
  // so nothing gets orphaned.
  router.patch('/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const check = validateClassName((req.body || {}).name);
    if (!check.valid) return res.status(400).json({ error: check.error });

    const classes = await store.listClasses();
    const target = classes.find((c) => c.id === id);
    if (!target) return res.status(404).json({ error: 'הכיתה לא נמצאה' });
    if (classes.some((c) => c.id !== id && c.name === check.name)) {
      return res.status(409).json({ error: 'כיתה בשם הזה כבר קיימת' });
    }
    if (target.name === check.name) return res.json({ class: publicClass(target), recordsUpdated: 0 });

    const updated = await store.updateClass(id, { name: check.name });

    const records = await store.listRecords();
    const affected = records.filter((r) => r.studentClass === target.name);
    for (const record of affected) {
      await store.updateRecord(record.id, { studentClass: check.name });
    }

    res.json({ class: publicClass(updated || { ...target, name: check.name }), recordsUpdated: affected.length });
  });

  // Remove. Borrow records are never deleted - they keep their class text and
  // stay visible under "כל התלמידים".
  router.delete('/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const classes = await store.listClasses();
    const target = classes.find((c) => c.id === id);
    if (!target) return res.status(404).json({ error: 'הכיתה לא נמצאה' });
    if (classes.length <= 1) {
      return res.status(400).json({ error: 'אי אפשר להסיר את הכיתה האחרונה' });
    }

    await store.removeClass(id);
    const records = await store.listRecords();
    const recordsKept = records.filter((r) => r.studentClass === target.name).length;
    res.json({ ok: true, recordsKept });
  });

  return router;
}

module.exports = createClassesRouter;
