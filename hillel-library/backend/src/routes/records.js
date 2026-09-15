const { Router } = require('../http/miniHttp');
const store = require('../services/store');
const { validateNewRecord, validateNote, validateStatus } = require('../services/validation');
const { requireAuth } = require('../middleware/auth');

function createRecordsRouter() {
  const router = new Router();

  router.get('/', requireAuth, async (req, res) => {
    const records = await store.listRecords();
    res.json(records);
  });

  router.post('/', requireAuth, async (req, res) => {
    const check = validateNewRecord(req.body || {});
    if (!check.valid) return res.status(400).json({ error: check.errors[0], errors: check.errors });

    const record = {
      ...check.data,
      status: 'borrowed',
      isReturned: false,
      actualReturnDate: null,
      createdAt: new Date().toISOString(),
      addedBy: req.user.username,
    };

    const created = await store.addRecord(record);
    res.status(201).json(created);
  });

  router.patch('/:id/status', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { status } = req.body || {};
    if (!validateStatus(status)) return res.status(400).json({ error: 'סטטוס לא תקין' });

    const patch = {
      status,
      isReturned: status === 'returned',
      actualReturnDate: status === 'returned' ? new Date().toISOString().split('T')[0] : null,
    };

    const updated = await store.updateRecord(id, patch);
    if (!updated) return res.status(404).json({ error: 'רשומה לא נמצאה' });
    res.json(updated);
  });

  // New: add/update a free-text note on a single borrow record ("per book").
  router.patch('/:id/note', requireAuth, async (req, res) => {
    const { id } = req.params;
    const check = validateNote((req.body || {}).note);
    if (!check.valid) return res.status(400).json({ error: check.error });

    const updated = await store.updateRecord(id, { note: check.note });
    if (!updated) return res.status(404).json({ error: 'רשומה לא נמצאה' });
    res.json(updated);
  });

  router.delete('/:id', requireAuth, async (req, res) => {
    const { id } = req.params;
    const ok = await store.deleteRecord(id);
    if (!ok) return res.status(404).json({ error: 'רשומה לא נמצאה' });
    res.json({ ok: true });
  });

  return router;
}

module.exports = createRecordsRouter;
