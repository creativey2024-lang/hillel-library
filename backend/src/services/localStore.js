const { readDb, writeDb, genId } = require('./db');

// Local JSON-file storage, used automatically whenever the Firestore cloud
// database is not configured or not reachable (mirrors the old app's "local
// mode" fallback, but now lives on the server instead of the browser).

// --- Staff ---
function listStaff() {
  return readDb().staff;
}

function findStaffByUsername(username) {
  return readDb().staff.find((s) => s.username === username) || null;
}

function addStaff(data) {
  const dbObject = readDb();
  const created = { id: genId(), ...data };
  dbObject.staff.push(created);
  writeDb(dbObject);
  return created;
}

function updateStaffRole(id, role) {
  const dbObject = readDb();
  const target = dbObject.staff.find((s) => s.id === id);
  if (!target) return null;
  target.role = role;
  writeDb(dbObject);
  return target;
}

function removeStaff(id) {
  const dbObject = readDb();
  const before = dbObject.staff.length;
  dbObject.staff = dbObject.staff.filter((s) => s.id !== id);
  writeDb(dbObject);
  return dbObject.staff.length < before;
}

// --- Records ---
function listRecords() {
  const records = readDb().records;
  return [...records].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function addRecord(record) {
  const dbObject = readDb();
  const created = { id: genId(), ...record };
  dbObject.records.unshift(created);
  writeDb(dbObject);
  return created;
}

function findRecordById(id) {
  return readDb().records.find((r) => r.id === id) || null;
}

function updateRecord(id, patch) {
  const dbObject = readDb();
  const target = dbObject.records.find((r) => r.id === id);
  if (!target) return null;
  Object.assign(target, patch);
  writeDb(dbObject);
  return target;
}

function deleteRecord(id) {
  const dbObject = readDb();
  const before = dbObject.records.length;
  dbObject.records = dbObject.records.filter((r) => r.id !== id);
  writeDb(dbObject);
  return dbObject.records.length < before;
}

module.exports = {
  listStaff,
  findStaffByUsername,
  addStaff,
  updateStaffRole,
  removeStaff,
  listRecords,
  addRecord,
  findRecordById,
  updateRecord,
  deleteRecord,
};
