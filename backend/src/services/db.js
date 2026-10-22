const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
// Allow tests (or a custom deployment) to point local storage somewhere else
// without touching the real data files.
const DB_FILE = process.env.LOCAL_DB_FILE || path.join(DATA_DIR, 'local-db.json');
const SEED_FILE = path.join(DATA_DIR, 'seed.json');

let seedCache = null;
function loadSeed() {
  if (!seedCache) {
    seedCache = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
  }
  return seedCache;
}

function ensureDbFile() {
  if (!fs.existsSync(DB_FILE)) {
    const seed = loadSeed();
    writeDb({ staff: seed.staff, records: seed.records });
  }
}

function readDb() {
  ensureDbFile();
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.staff) || !Array.isArray(parsed.records)) {
      throw new Error('Malformed local-db.json');
    }
    return parsed;
  } catch (err) {
    console.warn('[db] local-db.json missing/corrupt, re-seeding from seed.json:', err.message);
    const seed = loadSeed();
    const fresh = { staff: seed.staff, records: seed.records };
    writeDb(fresh);
    return fresh;
  }
}

function writeDb(dbObject) {
  const dir = path.dirname(DB_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpFile = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(dbObject, null, 2), 'utf8');
  fs.renameSync(tmpFile, DB_FILE);
}

function genId() {
  return crypto.randomBytes(10).toString('hex');
}

module.exports = { readDb, writeDb, genId, loadSeed, DATA_DIR, DB_FILE };
