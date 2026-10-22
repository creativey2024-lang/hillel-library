const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Point the app at a throwaway data directory before requiring anything that
// reads it, so this test never touches the real seeded data files.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hillel-test-'));
process.env.LOCAL_DB_FILE = path.join(tmpDir, 'local-db.json');
process.env.CREDENTIALS_FILE = path.join(tmpDir, 'credentials.json');
process.env.JWT_SECRET = 'integration-test-secret';
process.env.SUPER_ADMIN_USERNAME = 'מארק';
process.env.DEFAULT_STAFF_PASSWORD = 'chop';
process.env.SUPER_ADMIN_SECRET_PASSWORD = 'Mark2013';
// No FIREBASE_* env vars set -> store stays in local-only mode, which is what
// we want for a deterministic, offline test run.

const { createApp } = require('../src/http/miniHttp');
const { attachUser } = require('../src/middleware/auth');
const store = require('../src/services/store');
const credentials = require('../src/services/credentialsStore');
const { loadSeed } = require('../src/services/db');
const createAuthRouter = require('../src/routes/auth');
const createStaffRouter = require('../src/routes/staff');
const createRecordsRouter = require('../src/routes/records');
const createMetaRouter = require('../src/routes/meta');
const createClassesRouter = require('../src/routes/classes');

const JWT_SECRET = process.env.JWT_SECRET;
const SUPER_ADMIN_USERNAME = process.env.SUPER_ADMIN_USERNAME;

const seed = loadSeed();
store.configureCloud({}); // no cloud config -> local-only mode
credentials.configureCloud({}); // no cloud config -> local-only mode

const app = createApp();
app.use(attachUser(JWT_SECRET));
app.use('/api/auth', createAuthRouter({
  jwtSecret: JWT_SECRET,
  sessionTtlSeconds: 3600,
  pendingTtlSeconds: 300,
  superAdminUsername: SUPER_ADMIN_USERNAME,
  isProd: false,
}));
app.use('/api/staff', createStaffRouter({
  superAdminUsername: SUPER_ADMIN_USERNAME,
  defaultPassword: process.env.DEFAULT_STAFF_PASSWORD,
}));
app.use('/api/records', createRecordsRouter());
app.use('/api/meta', createMetaRouter());
app.use('/api/classes', createClassesRouter());

let server;
let baseUrl;

test.before(async () => {
  await credentials.ensureSeeded(
    seed.staff.map((member) => ({
      username: member.username,
      password: process.env.DEFAULT_STAFF_PASSWORD,
      secondary: member.username === SUPER_ADMIN_USERNAME ? process.env.SUPER_ADMIN_SECRET_PASSWORD : undefined,
    }))
  );

  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.after(() => {
  server.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Tiny cookie jar so we can carry the session cookie across requests like a browser would.
function makeClient() {
  let cookieMap = {};

  function applySetCookie(res) {
    const raw = res.headers.raw ? res.headers.raw()['set-cookie'] : res.headers.getSetCookie?.();
    if (!raw) return;
    for (const line of raw) {
      const [pair] = line.split(';');
      const idx = pair.indexOf('=');
      const key = pair.slice(0, idx);
      const value = pair.slice(idx + 1);
      cookieMap[key] = value;
    }
  }

  async function request(method, urlPath, body) {
    const headers = { Cookie: Object.entries(cookieMap).map(([k, v]) => `${k}=${v}`).join('; ') };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const res = await fetch(`${baseUrl}${urlPath}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    applySetCookie(res);

    let data = null;
    try {
      data = await res.json();
    } catch (err) {
      // no JSON body
    }
    return { status: res.status, data };
  }

  return {
    get: (p) => request('GET', p),
    post: (p, b) => request('POST', p, b ?? {}),
    patch: (p, b) => request('PATCH', p, b ?? {}),
    del: (p) => request('DELETE', p),
  };
}

test('rejects records access without logging in', async () => {
  const client = makeClient();
  const res = await client.get('/api/records');
  assert.equal(res.status, 401);
});

test('rejects login with a wrong password', async () => {
  const client = makeClient();
  const res = await client.post('/api/auth/login', { username: 'הלל', password: 'wrong-password' });
  assert.equal(res.status, 401);
});

test('a regular staff member can log in directly (single step)', async () => {
  const client = makeClient();
  const res = await client.post('/api/auth/login', { username: 'הלל', password: 'chop' });
  assert.equal(res.status, 200);
  assert.equal(res.data.username, 'הלל');
  assert.equal(res.data.role, 'admin');

  const me = await client.get('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.data.username, 'הלל');
});

test('the super-admin (מארק) needs a second password before getting a session', async () => {
  const client = makeClient();

  const step1 = await client.post('/api/auth/login', { username: 'מארק', password: 'chop' });
  assert.equal(step1.status, 200);
  assert.equal(step1.data.requiresSuperVerification, true);

  // Not yet logged in - session-protected routes must still reject.
  const meBeforeVerify = await client.get('/api/auth/me');
  assert.equal(meBeforeVerify.status, 401);

  const wrongSecond = await client.post('/api/auth/verify-super', { password: 'wrong' });
  assert.equal(wrongSecond.status, 401);

  const step2 = await client.post('/api/auth/verify-super', { password: 'Mark2013' });
  assert.equal(step2.status, 200);
  assert.equal(step2.data.isSuperAdmin, true);

  const me = await client.get('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.data.username, 'מארק');
  assert.equal(me.data.isSuperAdmin, true);
});

test('logged-in user can list the seeded records (existing data was preserved)', async () => {
  const client = makeClient();
  await client.post('/api/auth/login', { username: 'הלל', password: 'chop' });

  const res = await client.get('/api/records');
  assert.equal(res.status, 200);
  assert.equal(res.data.length, 5);
  assert.ok(res.data.some((r) => r.studentName === 'אדם אהרון בזן'));
  // Every migrated record should already have a (currently empty) note field.
  assert.ok(res.data.every((r) => typeof r.note === 'string'));
});

test('can add a record, set a note on it, and delete it', async () => {
  const client = makeClient();
  await client.post('/api/auth/login', { username: 'הלל', password: 'chop' });

  const created = await client.post('/api/records', {
    studentName: 'תלמיד בדיקה',
    studentClass: "ז'1",
    bookName: 'ספר בדיקה',
    borrowDate: '2026-09-11',
    returnDate: '2026-09-25',
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.addedBy, 'הלל');
  assert.equal(created.data.note, '');

  const noteRes = await client.patch(`/api/records/${created.data.id}/note`, { note: 'הספר קצת קרוע בכריכה' });
  assert.equal(noteRes.status, 200);
  assert.equal(noteRes.data.note, 'הספר קצת קרוע בכריכה');

  const statusRes = await client.patch(`/api/records/${created.data.id}/status`, { status: 'returned' });
  assert.equal(statusRes.status, 200);
  assert.equal(statusRes.data.isReturned, true);

  const delRes = await client.del(`/api/records/${created.data.id}`);
  assert.equal(delRes.status, 200);

  const listRes = await client.get('/api/records');
  assert.equal(listRes.data.some((r) => r.id === created.data.id), false);
});

test('rejects a record with missing fields', async () => {
  const client = makeClient();
  await client.post('/api/auth/login', { username: 'הלל', password: 'chop' });

  const res = await client.post('/api/records', { studentName: '', bookName: '' });
  assert.equal(res.status, 400);
});

test('a plain librarian cannot open the staff admin routes', async () => {
  const client = makeClient();
  await client.post('/api/auth/login', { username: 'יאשה', password: 'chop' });

  const res = await client.post('/api/staff', { username: 'חדש', role: 'librarian' });
  assert.equal(res.status, 403);
});

test('only מארק may grant the admin role to someone else', async () => {
  const adminClient = makeClient();
  await adminClient.post('/api/auth/login', { username: 'הלל', password: 'chop' });

  const attempt = await adminClient.post('/api/staff', { username: 'דנה', role: 'admin' });
  assert.equal(attempt.status, 403);

  const superClient = makeClient();
  await superClient.post('/api/auth/login', { username: 'מארק', password: 'chop' });
  await superClient.post('/api/auth/verify-super', { password: 'Mark2013' });

  const created = await superClient.post('/api/staff', { username: 'דנה', role: 'admin' });
  assert.equal(created.status, 201);
  assert.equal(created.data.staff.role, 'admin');
});

test('a staff member can reset their own password and then log in with it', async () => {
  const client = makeClient();
  await client.post('/api/auth/login', { username: 'יאשה', password: 'chop' });

  const staffList = await client.get('/api/staff');
  const me = staffList.data.find((s) => s.username === 'יאשה');

  const resetRes = await client.post(`/api/staff/${me.id}/reset-password`, { newPassword: 'newSecret123' });
  assert.equal(resetRes.status, 200);

  const freshClient = makeClient();
  const oldPasswordLogin = await freshClient.post('/api/auth/login', { username: 'יאשה', password: 'chop' });
  assert.equal(oldPasswordLogin.status, 401);

  const newPasswordLogin = await freshClient.post('/api/auth/login', { username: 'יאשה', password: 'newSecret123' });
  assert.equal(newPasswordLogin.status, 200);
});

test('meta endpoints expose classes and store status without requiring login', async () => {
  const client = makeClient();
  const classesRes = await client.get('/api/meta/classes');
  assert.equal(classesRes.status, 200);
  assert.ok(classesRes.data.includes("ז'1"));

  const statusRes = await client.get('/api/meta/status');
  assert.equal(statusRes.status, 200);
  assert.equal(statusRes.data.cloudMode, false);
});

// Regression test: the real Firestore data (written by the old, pre-backend
// app) never had an "isSuperAdmin" field on its staff documents - only
// {username, role}. The API must still recognize Mark as super-admin by
// username, never by trusting a stored field that may not exist.
test('reports isSuperAdmin correctly even when the stored record has no such field (real Firestore shape)', async () => {
  const dbModule = require('../src/services/db');
  const dbObject = dbModule.readDb();
  const markRecord = dbObject.staff.find((s) => s.username === 'מארק');
  assert.ok(markRecord, 'seed data must include מארק');
  delete markRecord.isSuperAdmin; // simulate the old app's document shape
  dbModule.writeDb(dbObject);

  const client = makeClient();
  await client.post('/api/auth/login', { username: 'הלל', password: 'chop' });

  const staffList = await client.get('/api/staff');
  const mark = staffList.data.find((s) => s.username === 'מארק');
  assert.ok(mark, 'מארק must still appear in the staff list');
  assert.equal(mark.isSuperAdmin, true);
});

// ---- Editable classes (admin panel) ----

async function loginAsAdmin() {
  const client = makeClient();
  const res = await client.post('/api/auth/login', { username: 'הלל', password: 'chop' });
  assert.equal(res.status, 200);
  assert.equal(res.data.role, 'admin');
  return client;
}

test('classes: login is required to read the editable list, admin to change it', async () => {
  const anon = makeClient();
  assert.equal((await anon.get('/api/classes')).status, 401);
  assert.equal((await anon.post('/api/classes', { name: 'כיתה חדשה' })).status, 401);

  // A plain librarian may read, but not change.
  const admin = await loginAsAdmin();
  await admin.post('/api/staff', { username: 'ספרנית', role: 'librarian' });
  const librarian = makeClient();
  const login = await librarian.post('/api/auth/login', { username: 'ספרנית', password: 'chop' });
  assert.equal(login.status, 200);
  assert.equal(login.data.role, 'librarian');

  const list = await librarian.get('/api/classes');
  assert.equal(list.status, 200);
  assert.equal(list.data.length, 26);
  assert.ok(list.data.every((c) => c.id && c.name));

  assert.equal((await librarian.post('/api/classes', { name: 'ט\'1' })).status, 403);
  assert.equal((await librarian.patch(`/api/classes/${list.data[0].id}`, { name: 'x' })).status, 403);
  assert.equal((await librarian.del(`/api/classes/${list.data[0].id}`)).status, 403);
});

test('classes: admin can add, rename (records follow) and remove (records stay)', async () => {
  const admin = await loginAsAdmin();

  // add
  const added = await admin.post('/api/classes', { name: "  ט'1  " });
  assert.equal(added.status, 201);
  assert.equal(added.data.name, "ט'1");

  const dup = await admin.post('/api/classes', { name: "ט'1" });
  assert.equal(dup.status, 409);
  assert.equal((await admin.post('/api/classes', { name: '   ' })).status, 400);

  // it really shows up in the public class list used by the dropdown
  let names = (await admin.get('/api/meta/classes')).data;
  assert.ok(names.includes("ט'1"));
  assert.equal(names[names.length - 1], "ט'1");

  // a record in that class
  const rec = await admin.post('/api/records', {
    studentName: 'תלמיד כיתות', studentClass: "ט'1", bookName: 'ספר', borrowDate: '2026-10-20', returnDate: '2026-11-20',
  });
  assert.equal(rec.status, 201);

  // rename -> the record moves to the new name
  const renamed = await admin.patch(`/api/classes/${added.data.id}`, { name: "ט'2" });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.data.class.name, "ט'2");
  assert.equal(renamed.data.recordsUpdated, 1);
  names = (await admin.get('/api/meta/classes')).data;
  assert.ok(names.includes("ט'2") && !names.includes("ט'1"));
  const afterRename = (await admin.get('/api/records')).data.find((r) => r.id === rec.data.id);
  assert.equal(afterRename.studentClass, "ט'2");

  // rename onto an existing class is refused
  const clash = await admin.patch(`/api/classes/${added.data.id}`, { name: "ז'1" });
  assert.equal(clash.status, 409);
  assert.equal((await admin.patch('/api/classes/nope', { name: 'א' })).status, 404);

  // remove -> class gone, record NOT deleted
  const removed = await admin.del(`/api/classes/${added.data.id}`);
  assert.equal(removed.status, 200);
  assert.equal(removed.data.recordsKept, 1);
  names = (await admin.get('/api/meta/classes')).data;
  assert.ok(!names.includes("ט'2"));
  const stillThere = (await admin.get('/api/records')).data.find((r) => r.id === rec.data.id);
  assert.ok(stillThere);
  assert.equal(stillThere.studentClass, "ט'2");
  assert.equal((await admin.del(`/api/classes/${added.data.id}`)).status, 404);

  await admin.del(`/api/records/${rec.data.id}`);
});

test('classes: the last remaining class cannot be removed', async () => {
  const admin = await loginAsAdmin();
  const all = (await admin.get('/api/classes')).data;
  // remove everything except the last one, then try the last one
  for (const c of all.slice(0, -1)) {
    assert.equal((await admin.del(`/api/classes/${c.id}`)).status, 200);
  }
  const last = all[all.length - 1];
  assert.equal((await admin.del(`/api/classes/${last.id}`)).status, 400);

  // put the original list back so test order never matters
  for (const c of all.slice(0, -1)) {
    assert.equal((await admin.post('/api/classes', { name: c.name })).status, 201);
  }
  const names = (await admin.get('/api/meta/classes')).data;
  assert.equal(names.length, 26);
  assert.ok(names.includes("ז'1"));
});
