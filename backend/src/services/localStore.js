const { readDb, writeDb, genId } = require('./db');
const defaultClasses = require('../data/classes.json');

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

// --- Classes ---
// Stored inside the same JSON file. Older files have no "classes" list yet, so
// it is created from the built-in list the first time it is needed.
function readDbWithClasses() {
  const dbObject = readDb();
  if (!Array.isArray(dbObject.classes) || dbObject.classes.length === 0) {
    dbObject.classes = defaultClasses.map((name, i) => ({ id: genId(), name, order: i + 1 }));
    writeDb(dbObject);
  }
  return dbObject;
}

function listClasses() {
  return readDbWithClasses().classes;
}

function addClass(data) {
  const dbObject = readDbWithClasses();
  const created = { id: genId(), ...data };
  dbObject.classes.push(created);
  writeDb(dbObject);
  return created;
}

function updateClass(id, patch) {
  const dbObject = readDbWithClasses();
  const target = dbObject.classes.find((c) => c.id === id);
  if (!target) return null;
  Object.assign(target, patch);
  writeDb(dbObject);
  return target;
}

function removeClass(id) {
  const dbObject = readDbWithClasses();
  const before = dbObject.classes.length;
  dbObject.classes = dbObject.classes.filter((c) => c.id !== id);
  writeDb(dbObject);
  return dbObject.classes.length < before;
}

module.exports = {
  listClasses,
  addClass,
  updateClass,
  removeClass,
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
