const fs = require('fs');
const path = require('path');

// Tiny zero-dependency ".env" loader (equivalent to the common "dotenv" package).
// Reads KEY=VALUE lines from backend/.env into process.env without overriding
// variables that are already set (e.g. by the hosting platform).
module.exports = function loadEnv(envPath = path.join(__dirname, '..', '..', '.env')) {
  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;

    const idx = trimmed.indexOf('=');
    if (idx === -1) return;

    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();

    const isQuoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (isQuoted) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  });
};
