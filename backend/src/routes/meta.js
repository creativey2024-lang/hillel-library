const { Router } = require('../http/miniHttp');
const store = require('../services/store');
const classes = require('../data/classes.json');

function createMetaRouter() {
  const router = new Router();

  router.get('/classes', (req, res) => {
    res.json(classes);
  });

  router.get('/status', (req, res) => {
    res.json(store.getStatus());
  });

  return router;
}

module.exports = createMetaRouter;
