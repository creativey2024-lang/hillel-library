const { Router } = require('../http/miniHttp');
const store = require('../services/store');

function createMetaRouter() {
  const router = new Router();

  // Plain list of class names (the live, admin-editable list).
  router.get('/classes', async (req, res) => {
    const classes = await store.listClasses();
    res.json(classes.map((c) => c.name));
  });

  router.get('/status', (req, res) => {
    res.json(store.getStatus());
  });

  return router;
}

module.exports = createMetaRouter;
