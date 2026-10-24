const crypto = require('crypto');

// Password hashing using Node's built-in scrypt (no external dependency needed).
// Stored format: "<saltHex>:<hashHex>"
const KEY_LENGTH = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, KEY_LENGTH).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string' || !stored.includes(':')) return false;

  const [salt, hashHex] = stored.split(':');
  if (!salt || !hashHex) return false;

  const candidateHash = crypto.scryptSync(String(password), salt, KEY_LENGTH);
  const storedHash = Buffer.from(hashHex, 'hex');

  if (storedHash.length !== candidateHash.length) return false;
  return crypto.timingSafeEqual(candidateHash, storedHash);
}

module.exports = { hashPassword, verifyPassword };
