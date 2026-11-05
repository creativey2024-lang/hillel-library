const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hillel-recovery-'));
process.env.LOCAL_DB_FILE = path.join(tmpDir, 'local-db.json');
process.env.CREDENTIALS_FILE = path.join(tmpDir, 'credentials.json');

const store = require('../src/services/store');
const credentials = require('../src/services/credentialsStore');
const { loadSeed } = require('../src/services/db');
const { isOn, recoverAccess } = require('../src/services/recovery');

const SUPER = 'מארק';
const base = { store, credentials, seedStaff: loadSeed().staff, superAdminUsername: SUPER, defaultPassword: 'chop', secretPassword: 'Mark2013', log: () => {} };

test('isOn understands the usual "on" values', () => {
  assert.equal(isOn('1'), true);
  assert.equal(isOn('true'), true);
  assert.equal(isOn(' YES '), true);
  assert.equal(isOn(''), false);
  assert.equal(isOn(undefined), false);
  assert.equal(isOn('0'), false);
});

test('recovery brings back a locked-out super admin and the removed staff', async () => {
  await credentials.ensureSeeded(loadSeed().staff.map((m) => ({ username: m.username, password: 'chop', secondary: m.username === SUPER ? 'Mark2013' : undefined })));

  // the accident: everybody else removed, and the super admin set a password he forgot
  for (const member of await store.listStaff()) {
    if (member.username !== SUPER) {
      await store.removeStaff(member.id);
      await credentials.removeCredentials(member.username);
    }
  }
  await credentials.setPassword(SUPER, 'something-forgotten');
  assert.equal(await credentials.verify(SUPER, 'chop'), false);

  const result = await recoverAccess(base);
  assert.equal(result.superAdminAdded, false);
  assert.deepEqual(result.restored.sort(), loadSeed().staff.map((m) => m.username).filter((n) => n !== SUPER).sort());

  assert.equal(await credentials.verify(SUPER, 'chop'), true);
  assert.equal(await credentials.verifySecondary(SUPER, 'Mark2013'), true);
  const names = (await store.listStaff()).map((s) => s.username).sort();
  assert.deepEqual(names, loadSeed().staff.map((m) => m.username).sort());
  for (const m of loadSeed().staff) assert.equal(await credentials.verify(m.username, 'chop'), true);
});

test('recovery also works when the super admin himself is gone from the staff list, and leaves other passwords alone', async () => {
  const staff = await store.listStaff();
  await store.removeStaff(staff.find((s) => s.username === SUPER).id);
  const other = staff.find((s) => s.username !== SUPER);
  await credentials.setPassword(other.username, 'my-own-password');

  const result = await recoverAccess(base);
  assert.equal(result.superAdminAdded, true);
  const me = (await store.listStaff()).find((s) => s.username === SUPER);
  assert.equal(me.role, 'admin');
  assert.equal(await credentials.verify(other.username, 'my-own-password'), true);
});

test('recovery is safe to run twice (no duplicate staff)', async () => {
  await recoverAccess(base);
  await recoverAccess(base);
  const names = (await store.listStaff()).map((s) => s.username);
  assert.equal(new Set(names).size, names.length);
});
