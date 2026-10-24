const test = require('node:test');
const assert = require('node:assert/strict');

const { hashPassword, verifyPassword } = require('../src/util/passwords');
const tokens = require('../src/util/tokens');
const { parseCookies, serializeCookie } = require('../src/util/cookies');
const permissions = require('../src/services/permissions');
const validation = require('../src/services/validation');

test('passwords: hashes and verifies correctly, rejects wrong password', () => {
  const stored = hashPassword('chop');
  assert.equal(verifyPassword('chop', stored), true);
  assert.equal(verifyPassword('wrong', stored), false);
  // Two hashes of the same password should differ (random salt).
  const stored2 = hashPassword('chop');
  assert.notEqual(stored, stored2);
});

test('tokens: signs and verifies, rejects tampered/expired tokens', () => {
  const secret = 'test-secret';
  const token = tokens.sign({ username: 'מארק', role: 'admin' }, secret, 60);
  const payload = tokens.verify(token, secret);
  assert.equal(payload.username, 'מארק');
  assert.equal(payload.role, 'admin');

  // Wrong secret must fail.
  assert.equal(tokens.verify(token, 'other-secret'), null);

  // Tampered payload must fail.
  const [h, b, s] = token.split('.');
  const tampered = `${h}.${b}x.${s}`;
  assert.equal(tokens.verify(tampered, secret), null);

  // Expired token must fail.
  const expired = tokens.sign({ username: 'x' }, secret, -10);
  assert.equal(tokens.verify(expired, secret), null);
});

test('cookies: parse and serialize round-trip', () => {
  const header = 'hillel_session=abc123; other=xyz';
  const parsed = parseCookies(header);
  assert.equal(parsed.hillel_session, 'abc123');
  assert.equal(parsed.other, 'xyz');

  const serialized = serializeCookie('hillel_session', 'abc 123', { maxAge: 100 });
  assert.match(serialized, /hillel_session=abc%20123/);
  assert.match(serialized, /HttpOnly/);
  assert.match(serialized, /Max-Age=100/);
});

test('permissions: only super-admin can assign the admin role', () => {
  const superAdminUsername = 'מארק';
  const admin = { username: 'הלל', role: 'admin' };
  const superAdmin = { username: 'מארק', role: 'admin' };

  assert.equal(permissions.canAssignRole(admin, 'admin', superAdminUsername), false);
  assert.equal(permissions.canAssignRole(superAdmin, 'admin', superAdminUsername), true);
  assert.equal(permissions.canAssignRole(admin, 'librarian', superAdminUsername), true);
});

test('permissions: super-admin role/identity can never be changed or removed', () => {
  const superAdminUsername = 'מארק';
  const superAdmin = { username: 'מארק', role: 'admin' };

  assert.equal(permissions.canChangeRole(superAdmin, 'מארק', superAdminUsername), false);
  assert.equal(
    permissions.canRemoveUser(superAdmin, { username: 'מארק', role: 'admin' }, superAdminUsername),
    false
  );
});

test('permissions: a regular admin may remove a librarian but not another admin', () => {
  const superAdminUsername = 'מארק';
  const admin = { username: 'הלל', role: 'admin' };

  assert.equal(permissions.canRemoveUser(admin, { username: 'יאשה', role: 'librarian' }, superAdminUsername), true);
  assert.equal(permissions.canRemoveUser(admin, { username: 'לאון', role: 'admin' }, superAdminUsername), false);
});

test('permissions: password reset allowed for self or super-admin only', () => {
  const superAdminUsername = 'מארק';
  const librarian = { username: 'יאשה', role: 'librarian' };
  const superAdmin = { username: 'מארק', role: 'admin' };

  assert.equal(permissions.canResetPassword(librarian, 'יאשה', superAdminUsername), true);
  assert.equal(permissions.canResetPassword(librarian, 'הלל', superAdminUsername), false);
  assert.equal(permissions.canResetPassword(superAdmin, 'הלל', superAdminUsername), true);
});

test('validation: new record requires all fields', () => {
  const result = validation.validateNewRecord({ studentName: '', bookName: 'ספר' });
  assert.equal(result.valid, false);
  assert.ok(result.errors.length > 0);

  const ok = validation.validateNewRecord({
    studentName: 'רועי כהן',
    studentClass: "ז'1",
    bookName: 'הארי פוטר',
    borrowDate: '2026-09-11',
    returnDate: '2026-09-25',
    note: '  יש לו לחץ להחזיר בזמן  ',
  });
  assert.equal(ok.valid, true);
  assert.equal(ok.data.note, 'יש לו לחץ להחזיר בזמן');
});

test('validation: note length is capped', () => {
  const longNote = 'א'.repeat(600);
  const result = validation.validateNote(longNote);
  assert.equal(result.valid, false);
});

test('validation: username must be Hebrew letters only', () => {
  assert.equal(validation.validateUsername('דני').valid, true);
  assert.equal(validation.validateUsername('Danny').valid, false);
  assert.equal(validation.validateUsername('דני 1').valid, false);
  assert.equal(validation.validateUsername('').valid, false);
});

test('validation: status must be one of the known values', () => {
  assert.equal(validation.validateStatus('returned'), true);
  assert.equal(validation.validateStatus('lost'), false);
});
