const fs = require('fs');
const path = require('path');
const { hashPassword, verifyPassword } = require('../util/passwords');
const { createCloudStore } = require('./cloudStore');

// Login credentials (password hashes, never plaintext) are kept in a local
// JSON file as a fast, always-available cache/fallback. When Firestore is
// configured, it becomes the source of truth instead - see configureCloud()
// below. This is a deliberate change from the very first version of this
// backend, which kept credentials local-only forever: that meant every
// custom password anyone set was silently wiped the moment the hosting
// provider (e.g. Render's free tier) redeployed the service, because that
// kind of host does not give you a persistent disk by default. Firestore
// already holds the rest of the app's shared data and survives redeploys, so
// storing the *hashes* there (still hashed with scrypt, still never the
// plaintext password) fixes that without needing a paid persistent disk.
const CREDENTIALS_FILE = process.env.CREDENTIALS_FILE || path.join(__dirname, '..', 'data', 'credentials.json');

let cloud = null;
let cloudMode = false;

function configureCloud(config) {
  if (config && config.apiKey && config.projectId) {
    cloud = createCloudStore(config);
    cloudMode = true;
  } else {
    cloud = null;
    cloudMode = false;
  }
}

function getStatus() {
  return { cloudMode, cloudConfigured: Boolean(cloud) };
}

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

// Same cloud-first-with-automatic-local-fallback pattern used by store.js:
// try Firestore if it's configured and currently reachable; on any failure,
// drop into local-file mode for the rest of the process (until a later call
// succeeds again) so the app keeps working through a brief Firestore outage.
async function withFallback(cloudFn, localFn) {
  if (cloudMode && cloud) {
    try {
      return await cloudFn(cloud);
    } catch (err) {
      console.warn('[credentials] Cloud operation failed, switching to the local file:', err.message);
      cloudMode = false;
      return localFn();
    }
  }
  return localFn();
}

// Call this after configureCloud() to check whether Firestore has become
// reachable again after an earlier failure.
async function retryCloudIfConfigured() {
  if (!cloud || cloudMode) return;
  try {
    await cloud.getCredential('__healthcheck__');
    cloudMode = true;
    console.log('[credentials] Firestore connection is back up - switched back to cloud mode.');
  } catch (err) {
    // stays in local-file mode
  }
}

async function getCredentialEntry(username) {
  return withFallback(
    async (c) => {
      const doc = await c.getCredential(username);
      return doc ? { password: doc.password || null, secondary: doc.secondary || null } : null;
    },
    () => readCredentials()[username] || null
  );
}

async function hasCredentials(username) {
  const entry = await getCredentialEntry(username);
  return Boolean(entry && entry.password);
}

async function setPassword(username, newPassword) {
  const hash = hashPassword(newPassword);
  await withFallback(
    (c) => c.setCredential(username, { password: hash }),
    () => {
      const creds = readCredentials();
      if (!creds[username]) creds[username] = {};
      creds[username].password = hash;
      writeCredentials(creds);
    }
  );
}

async function setSecondaryPassword(username, newPassword) {
  const hash = hashPassword(newPassword);
  await withFallback(
    (c) => c.setCredential(username, { secondary: hash }),
    () => {
      const creds = readCredentials();
      if (!creds[username]) creds[username] = {};
      creds[username].secondary = hash;
      writeCredentials(creds);
    }
  );
}

async function verify(username, password) {
  const entry = await getCredentialEntry(username);
  if (!entry || !entry.password) return false;
  return verifyPassword(password, entry.password);
}

async function verifySecondary(username, password) {
  const entry = await getCredentialEntry(username);
  if (!entry || !entry.secondary) return false;
  return verifyPassword(password, entry.secondary);
}

async function removeCredentials(username) {
  await withFallback(
    (c) => c.deleteCredential(username),
    () => {
      const creds = readCredentials();
      delete creds[username];
      writeCredentials(creds);
    }
  );
}

// Seeds passwords for staff that don't have credentials yet (checked against
// whichever store - cloud or local - is currently active). Safe to call on
// every server start: existing credentials are never overwritten.
async function ensureSeeded(seedDefinitions) {
  for (const def of seedDefinitions) {
    const already = await hasCredentials(def.username);
    if (!already) {
      await setPassword(def.username, def.password);
      if (def.secondary) {
        await setSecondaryPassword(def.username, def.secondary);
      }
    }
  }
}

module.exports = {
  configureCloud,
  retryCloudIfConfigured,
  getStatus,
  ensureSeeded,
  hasCredentials,
  setPassword,
  setSecondaryPassword,
  verify,
  verifySecondary,
  removeCredentials,
};
