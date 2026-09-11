const fs = require('fs');
const path = require('path');
const { hashPassword, verifyPassword } = require('../util/passwords');

// Login credentials (password hashes) are ALWAYS kept only on the backend's
// local disk, in their own file, never in Firestore - even when the rest of
// the app data (staff directory, borrow records) syncs to the cloud. Firestore
// in this project accepts writes from any anonymous client (that's how the
// original app worked), so it is not a safe place to store secrets.
const CREDENTIALS_FILE = process.env.CREDENTIALS_FILE || path.join(__dirname, '..', 'data', 'credentials.json');

function readCredentials() {
  if (!fs.existsSync(CREDENTIALS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));
  } catch (err) {
    console.warn('[credentials] credentials.json is corrupt, starting empty:', err.message);
    return {};
  }
}

function writeCredentials(obj) {
  const dir = path.dirname(CREDENTIALS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmpFile = `${CREDENTIALS_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(obj, null, 2), 'utf8');
  fs.renameSync(tmpFile, CREDENTIALS_FILE);
}

// Seeds passwords for staff that don't have credentials yet. Safe to call on
// every server start - existing credentials are never overwritten.
function ensureSeeded(seedDefinitions) {
  const creds = readCredentials();
  let changed = false;

  for (const def of seedDefinitions) {
    if (!creds[def.username]) {
      creds[def.username] = { password: hashPassword(def.password) };
      if (def.secondary) {
        creds[def.username].secondary = hashPassword(def.secondary);
      }
      changed = true;
    }
  }

  if (changed) writeCredentials(creds);
}

function hasCredentials(username) {
  const creds = readCredentials();
  return Boolean(creds[username]);
}

function setPassword(username, newPassword) {
  const creds = readCredentials();
  if (!creds[username]) creds[username] = {};
  creds[username].password = hashPassword(newPassword);
  writeCredentials(creds);
}

function setSecondaryPassword(username, newPassword) {
  const creds = readCredentials();
  if (!creds[username]) creds[username] = {};
  creds[username].secondary = hashPassword(newPassword);
  writeCredentials(creds);
}

function verify(username, password) {
  const creds = readCredentials();
  const entry = creds[username];
  if (!entry || !entry.password) return false;
  return verifyPassword(password, entry.password);
}

function verifySecondary(username, password) {
  const creds = readCredentials();
  const entry = creds[username];
  if (!entry || !entry.secondary) return false;
  return verifyPassword(password, entry.secondary);
}

function removeCredentials(username) {
  const creds = readCredentials();
  delete creds[username];
  writeCredentials(creds);
}

module.exports = {
  ensureSeeded,
  hasCredentials,
  setPassword,
  setSecondaryPassword,
  verify,
  verifySecondary,
  removeCredentials,
};
