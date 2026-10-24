// Server-side re-implementation of the access rules that used to live only in
// client-side JavaScript (and could previously be bypassed by anyone who
// opened devtools). Same rules as before, just enforced where they can't be
// tampered with.

function isSuperAdminUser(user, superAdminUsername) {
  return Boolean(user && user.username === superAdminUsername);
}

// Only the super-admin (מארק) may grant the 'admin' role. Any admin may add a
// plain librarian.
function canAssignRole(actor, role, superAdminUsername) {
  if (role === 'admin') {
    return isSuperAdminUser(actor, superAdminUsername);
  }
  return Boolean(actor && actor.role === 'admin');
}

// Nobody may change the super-admin's own role, and only the super-admin may
// change anyone else's role.
function canChangeRole(actor, targetUsername, superAdminUsername) {
  if (targetUsername === superAdminUsername) return false;
  return isSuperAdminUser(actor, superAdminUsername);
}

// The super-admin can never be removed. Only the super-admin may remove an
// admin; any admin may remove a plain librarian.
function canRemoveUser(actor, target, superAdminUsername) {
  if (target.username === superAdminUsername) return false;
  if (target.role === 'admin') {
    return isSuperAdminUser(actor, superAdminUsername);
  }
  return Boolean(actor && actor.role === 'admin');
}

// Anyone may reset their own password; the super-admin may reset anyone's.
function canResetPassword(actor, targetUsername, superAdminUsername) {
  if (actor && actor.username === targetUsername) return true;
  return isSuperAdminUser(actor, superAdminUsername);
}

module.exports = {
  isSuperAdminUser,
  canAssignRole,
  canChangeRole,
  canRemoveUser,
  canResetPassword,
};
