// Emergency "I locked myself out" recovery. It only runs when the person who
// controls the SERVER turns it on (RECOVER_ACCESS=1 in the server settings and
// a restart) - there is no web page or API for it, so nobody can use it from
// the outside.
//
// What it does:
//   1. makes sure the super admin is on the staff list (as an admin)
//   2. sets the super admin's two passwords back to the ones in the server
//      settings (DEFAULT_STAFF_PASSWORD, SUPER_ADMIN_SECRET_PASSWORD)
//   3. puts back the built-in staff (seed.json) that were removed, with the
//      default password
// It never touches anybody else's password, records, classes or game coins.

function isOn(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

async function recoverAccess({ store, credentials, seedStaff, superAdminUsername, defaultPassword, secretPassword, log = console.log }) {
  const result = { superAdminAdded: false, restored: [] };

  const staff = await store.listStaff();
  const has = (name) => staff.some((s) => s.username === name);

  // 1. the super admin must exist and be an admin
  const existing = staff.find((s) => s.username === superAdminUsername);
  if (!existing) {
    await store.addStaff({ username: superAdminUsername, role: 'admin', isSuperAdmin: false, createdAt: new Date().toISOString() });
    result.superAdminAdded = true;
  } else if (existing.role !== 'admin') {
    await store.updateStaffRole(existing.id, 'admin');
  }

  // 2. both passwords of the super admin
  await credentials.setPassword(superAdminUsername, defaultPassword);
  await credentials.setSecondaryPassword(superAdminUsername, secretPassword);

  // 3. the built-in staff that are gone
  for (const member of seedStaff) {
    if (member.username === superAdminUsername || has(member.username)) continue;
    await store.addStaff({
      username: member.username,
      role: member.role === 'admin' ? 'admin' : 'librarian',
      isSuperAdmin: false,
      createdAt: new Date().toISOString(),
    });
    // (their password was removed together with them)
    if (!(await credentials.hasCredentials(member.username))) {
      await credentials.setPassword(member.username, defaultPassword);
    }
    result.restored.push(member.username);
  }

  log(
    `[recovery] RECOVER_ACCESS is on: "${superAdminUsername}" can log in again with the default password ` +
      '(DEFAULT_STAFF_PASSWORD) and the super-admin password (SUPER_ADMIN_SECRET_PASSWORD).' +
      (result.restored.length ? ` Restored staff: ${result.restored.join(', ')}.` : '')
  );
  log('[recovery] IMPORTANT: now turn RECOVER_ACCESS off - while it is on, every restart resets these passwords again.');
  return result;
}

module.exports = { isOn, recoverAccess };
