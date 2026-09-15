const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// This file simulates a real Firestore backend with a fake `fetch`, so it can
// verify the actual bug this fix addresses without needing real network
// access (blocked in this sandbox) or a real Firebase project:
//
//   Before this fix, staff passwords were kept ONLY in a local JSON file on
//   the server's own disk. Free/typical hosts (e.g. Render's free tier)
//   don't give a plain web service a persistent disk, so every redeploy wiped
//   that file and silently reset everyone back to the shared default
//   password. This fix stores the password *hashes* (never plaintext) in
//   Firestore instead, which already holds the rest of the app's data and
//   does survive redeploys, while keeping the local file as an automatic
//   fallback for a brief Firestore outage.

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hillel-cred-cloud-'));
process.env.CREDENTIALS_FILE = path.join(tmpDir, 'credentials.json');

const credentials = require('../src/services/credentialsStore');

// A tiny in-memory stand-in for Firestore + the anonymous-auth endpoints,
// driven purely through `fetch` so it exercises the real client code
// (firestoreRest.js -> cloudStore.js -> credentialsStore.js) end to end.
function buildFakeFirestore() {
  const docs = new Map(); // decoded document path -> plain field object
  let failMode = false;

  function jsonResponse(status, body) {
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  }

  function toFields(obj) {
    const fields = {};
    for (const [k, v] of Object.entries(obj)) {
      fields[k] = typeof v === 'boolean' ? { booleanValue: v } : { stringValue: String(v) };
    }
    return fields;
  }

  function fromFields(fields) {
    const out = {};
    for (const [k, v] of Object.entries(fields || {})) {
      if ('stringValue' in v) out[k] = v.stringValue;
      else if ('booleanValue' in v) out[k] = v.booleanValue;
    }
    return out;
  }

  async function fakeFetch(url, opts = {}) {
    const u = new URL(url);
    const method = (opts.method || 'GET').toUpperCase();

    if (u.hostname === 'identitytoolkit.googleapis.com') {
      return jsonResponse(200, { idToken: 'fake-token', refreshToken: 'fake-refresh', expiresIn: '3600' });
    }
    if (u.hostname === 'securetoken.googleapis.com') {
      return jsonResponse(200, { id_token: 'fake-token', refresh_token: 'fake-refresh', expires_in: '3600' });
    }

    if (failMode) throw new Error('simulated Firestore outage');

    if (u.hostname === 'firestore.googleapis.com') {
      const docPath = decodeURIComponent(u.pathname.split('/documents/')[1].split('?')[0]);

      if (method === 'PATCH') {
        const body = JSON.parse(opts.body);
        const merged = { ...(docs.get(docPath) || {}), ...fromFields(body.fields) };
        docs.set(docPath, merged);
        return jsonResponse(200, { name: `.../documents/${docPath}`, fields: toFields(merged) });
      }
      if (method === 'GET') {
        const existing = docs.get(docPath);
        if (!existing) return jsonResponse(404, { error: { message: 'not found' } });
        return jsonResponse(200, { name: `.../documents/${docPath}`, fields: toFields(existing) });
      }
      if (method === 'DELETE') {
        docs.delete(docPath);
        return jsonResponse(200, {});
      }
    }
    throw new Error(`fake fetch: unexpected request ${method} ${url}`);
  }

  return { fetch: fakeFetch, setFailMode: (v) => { failMode = v; } };
}

test('a password set via Firestore survives even if the local credentials file is wiped (simulates a Render redeploy)', async (t) => {
  const fake = buildFakeFirestore();
  const originalFetch = global.fetch;
  global.fetch = fake.fetch;
  t.after(() => { global.fetch = originalFetch; });

  credentials.configureCloud({ apiKey: 'fake-key', projectId: 'fake-project' });

  await credentials.setPassword('דנה', 'my-new-secret');
  assert.equal(await credentials.verify('דנה', 'my-new-secret'), true);

  // This is the exact failure mode being fixed: on the old design the local
  // file WAS the only copy, so wiping it (as a redeploy would) lost the
  // password forever. Now Firestore is the source of truth, so wiping the
  // local cache file must not lose anything.
  if (fs.existsSync(process.env.CREDENTIALS_FILE)) {
    fs.unlinkSync(process.env.CREDENTIALS_FILE);
  }

  const stillWorks = await credentials.verify('דנה', 'my-new-secret');
  assert.equal(stillWorks, true, 'password must still verify from Firestore even though the local cache file is gone');
});

test('if Firestore is briefly unreachable, credentials still work via the local fallback file', async (t) => {
  const fake = buildFakeFirestore();
  const originalFetch = global.fetch;
  global.fetch = fake.fetch;
  t.after(() => { global.fetch = originalFetch; });

  credentials.configureCloud({ apiKey: 'fake-key', projectId: 'fake-project' });
  fake.setFailMode(true);

  await credentials.setPassword('רועי', 'offline-pass');
  assert.equal(await credentials.verify('רועי', 'offline-pass'), true);
});
