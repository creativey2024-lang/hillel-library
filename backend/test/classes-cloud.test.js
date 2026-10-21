const test = require('node:test');
const assert = require('node:assert/strict');
const { createCloudStore } = require('../src/services/cloudStore');

// A tiny in-memory fake of the Firestore REST API (plus anonymous sign-in),
// to check the cloud path of the class list: first-run seeding, add, rename, remove.
function installFakeFirestore() {
  const collections = {};
  let nextId = 1;
  const realFetch = global.fetch;
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
    if (u.includes('accounts:signUp')) {
      return json({ idToken: 't', refreshToken: 'r', expiresIn: '3600' });
    }
    const m = u.match(/documents\/(.+?)(?:\?|$)/);
    const rest = decodeURIComponent(m[1]);
    const method = opts.method || 'GET';
    const parts = rest.split('/');
    const isDoc = parts.length % 2 === 0;
    const colPath = isDoc ? parts.slice(0, -1).join('/') : rest;
    const col = (collections[colPath] = collections[colPath] || {});
    const toDoc = (id) => ({ name: `x/${colPath}/${id}`, fields: col[id] });
    if (method === 'GET' && !isDoc) {
      return json({ documents: Object.keys(col).map(toDoc) });
    }
    if (method === 'POST' && !isDoc) {
      const id = `doc${nextId++}`;
      col[id] = JSON.parse(opts.body).fields;
      return json(toDoc(id));
    }
    const id = parts[parts.length - 1];
    if (method === 'PATCH') {
      col[id] = { ...(col[id] || {}), ...JSON.parse(opts.body).fields };
      return json(toDoc(id));
    }
    if (method === 'DELETE') {
      delete col[id];
      return json({});
    }
    return json({}, 404);
  };
  return () => { global.fetch = realFetch; };
}

test('cloud classes: seeded once from the built-in list, then add / rename / remove persist', async () => {
  const restore = installFakeFirestore();
  try {
    const cloud = createCloudStore({ apiKey: 'k', projectId: 'p' });

    // two simultaneous first reads must not seed twice
    const [a, b] = await Promise.all([cloud.listClasses(), cloud.listClasses()]);
    assert.equal(a.length, 26);
    assert.equal(b.length, 26);
    assert.equal((await cloud.listClasses()).length, 26);

    const created = await cloud.addClass({ name: "ט'1", order: 27 });
    assert.equal(created.name, "ט'1");
    assert.equal(created.order, 27);

    await cloud.updateClass(created.id, { name: "ט'2" });
    let list = await cloud.listClasses();
    assert.equal(list.length, 27);
    assert.ok(list.some((c) => c.name === "ט'2" && c.order === 27));

    await cloud.removeClass(created.id);
    list = await cloud.listClasses();
    assert.equal(list.length, 26);
    assert.ok(!list.some((c) => c.name === "ט'2"));
  } finally {
    restore();
  }
});
