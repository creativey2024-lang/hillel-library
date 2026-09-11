const crypto = require('crypto');

// A minimal, dependency-free JWT-like signed token (HMAC-SHA256), used for
// login sessions instead of pulling in the "jsonwebtoken" package.

function base64url(buffer) {
  return Buffer.from(buffer)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64urlDecode(str) {
  let normalized = str.replace(/-/g, '+').replace(/_/g, '/');
  while (normalized.length % 4) normalized += '=';
  return Buffer.from(normalized, 'base64');
}

function sign(payload, secret, ttlSeconds) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const nowSeconds = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: nowSeconds, exp: nowSeconds + ttlSeconds };

  const headerPart = base64url(JSON.stringify(header));
  const bodyPart = base64url(JSON.stringify(body));
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${headerPart}.${bodyPart}`)
    .digest();
  const signaturePart = base64url(signature);

  return `${headerPart}.${bodyPart}.${signaturePart}`;
}

function verify(token, secret) {
  if (!token || typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerPart, bodyPart, signaturePart] = parts;

  const expectedSignature = base64url(
    crypto.createHmac('sha256', secret).update(`${headerPart}.${bodyPart}`).digest()
  );

  const expectedBuf = Buffer.from(expectedSignature);
  const actualBuf = Buffer.from(signaturePart);
  if (expectedBuf.length !== actualBuf.length) return null;
  if (!crypto.timingSafeEqual(expectedBuf, actualBuf)) return null;

  let payload;
  try {
    payload = JSON.parse(base64urlDecode(bodyPart).toString('utf8'));
  } catch (err) {
    return null;
  }

  if (typeof payload.exp === 'number' && Math.floor(Date.now() / 1000) > payload.exp) {
    return null; // expired
  }

  return payload;
}

module.exports = { sign, verify };
