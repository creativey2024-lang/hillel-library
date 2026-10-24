const test = require('node:test');
const assert = require('node:assert/strict');
const { FirestoreRestClient } = require('../src/services/firestoreRest');

// Firestore returns 20 documents per page by default. This guards the fix that
// asks for big pages and follows nextPageToken, so long lists (records, classes)
// are never silently cut off.
test('listDocuments follows nextPageToken until every document is read', async () => {
  const client = new FirestoreRestClient({ apiKey: 'k', projectId: 'p' });
  client._authHeaders = async () => ({});

  const calls = [];
  const realFetch = global.fetch;
  global.fetch = async (url) => {
    calls.push(String(url));
    const second = String(url).includes('pageToken=T2');
    const docs = (from, n) => Array.from({ length: n }, (_, i) => ({
      name: `projects/p/databases/(default)/documents/c/d${from + i}`,
      fields: { name: { stringValue: `n${from + i}` } },
    }));
    return {
      ok: true,
      status: 200,
      json: async () => (second ? { documents: docs(300, 26) } : { documents: docs(0, 300), nextPageToken: 'T2' }),
    };
  };

  try {
    const list = await client.listDocuments('c');
    assert.equal(list.length, 326);
    assert.equal(calls.length, 2);
    assert.ok(calls[0].includes('pageSize=300'));
    assert.ok(calls[1].includes('pageToken=T2'));
  } finally {
    global.fetch = realFetch;
  }
});
