const localStore = require('./localStore');
const { createCloudStore } = require('./cloudStore');

// Single data-access surface used by the route handlers. Tries the Firestore
// cloud store first (if configured); if a call fails for any reason, it falls
// back to the local JSON store automatically and remembers to keep using
// local storage until a later cloud call succeeds again - mirroring the
// "local mode" behaviour the original frontend had, just server-side now.

let cloud = null;
let cloudMode = false;
let lastCloudError = null;

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
  return {
    cloudMode,
    cloudConfigured: Boolean(cloud),
    lastCloudError: lastCloudError ? String(lastCloudError.message || lastCloudError) : null,
  };
}

async function withFallback(cloudFn, localFn) {
  if (cloudMode && cloud) {
    try {
      const result = await cloudFn(cloud);
      lastCloudError = null;
      return result;
    } catch (err) {
      lastCloudError = err;
      console.warn('[store] Cloud operation failed, switching to local storage:', err.message);
      cloudMode = false;
    }
  }
  return localFn();
}

// Call this after configureCloud() (and optionally on a timer) to check
// whether the cloud database has become reachable again.
async function retryCloudIfConfigured() {
  if (!cloud) return;
  if (cloudMode) return;
  try {
    await cloud.listStaff();
    cloudMode = true;
    lastCloudError = null;
    console.log('[store] Firestore connection is back up - switched back to cloud mode.');
  } catch (err) {
    lastCloudError = err;
  }
}

const store = {
  configureCloud,
  getStatus,
  retryCloudIfConfigured,

  listStaff: () => withFallback((c) => c.listStaff(), () => localStore.listStaff()),

  findStaffByUsername: async (username) => {
    const staff = await store.listStaff();
    return staff.find((s) => s.username === username) || null;
  },

  addStaff: (data) => withFallback((c) => c.addStaff(data), () => localStore.addStaff(data)),
  updateStaffRole: (id, role) =>
    withFallback((c) => c.updateStaffRole(id, role), () => localStore.updateStaffRole(id, role)),
  removeStaff: (id) => withFallback((c) => c.removeStaff(id), () => localStore.removeStaff(id)),

  listRecords: () => withFallback((c) => c.listRecords(), () => localStore.listRecords()),
  addRecord: (data) => withFallback((c) => c.addRecord(data), () => localStore.addRecord(data)),
  updateRecord: (id, patch) =>
    withFallback((c) => c.updateRecord(id, patch), () => localStore.updateRecord(id, patch)),
  deleteRecord: (id) => withFallback((c) => c.deleteRecord(id), () => localStore.deleteRecord(id)),
};

module.exports = store;
