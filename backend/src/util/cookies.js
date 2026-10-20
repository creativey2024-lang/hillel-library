// Minimal cookie parsing/serialization helpers (avoids the "cookie-parser" dependency).

function parseCookies(header) {
  const out = {};
  if (!header) return out;

  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const rawValue = pair.slice(idx + 1).trim();
    if (!key) return;
    try {
      out[key] = decodeURIComponent(rawValue);
    } catch (err) {
      out[key] = rawValue;
    }
  });

  return out;
}

function serializeCookie(name, value, options = {}) {
  let str = `${name}=${encodeURIComponent(value)}`;

  if (options.maxAge != null) {
    str += `; Max-Age=${Math.max(0, Math.floor(options.maxAge))}`;
  }
  str += `; Path=${options.path || '/'}`;
  if (options.httpOnly !== false) str += '; HttpOnly';
  str += `; SameSite=${options.sameSite || 'Lax'}`;
  if (options.secure) str += '; Secure';

  return str;
}

module.exports = { parseCookies, serializeCookie };
