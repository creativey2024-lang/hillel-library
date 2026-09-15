const { FirestoreRestClient } = require('./firestoreRest');

// Same Firestore project/collection layout the original app already used, so
// connecting this backend to Firebase picks up the school's existing live data.
const APP_ID = 'c_cf3d6ec4bbaf8b0d_index.html-892';
const STAFF_PATH = `artifacts/${APP_ID}/public/data/library_staff`;
const RECORDS_PATH = `artifacts/${APP_ID}/public/data/library_records`;
// Password hashes (never plaintext) - stored in their own collection so that,
// unlike a Render/Railway/etc. server's local disk, they survive a redeploy.
// The document id is the username itself, so a write is a simple upsert.
const CREDENTIALS_PATH = `artifacts/${APP_ID}/public/data/library_credentials`;

function createCloudStore(config) {
  const client = new FirestoreRestClient(config);

  return {
    async listStaff() {
      return client.listDocuments(STAFF_PATH);
    },
    async addStaff(data) {
      return client.createDocument(STAFF_PATH, data);
    },
    async updateStaffRole(id, role) {
      return client.updateDocument(STAFF_PATH, id, { role });
    },
    async removeStaff(id) {
      return client.deleteDocument(STAFF_PATH, id);
    },

    async listRecords() {
      const records = await client.listDocuments(RECORDS_PATH);
      return records.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    },
    async addRecord(data) {
      return client.createDocument(RECORDS_PATH, data);
    },
    async updateRecord(id, patch) {
      return client.updateDocument(RECORDS_PATH, id, patch);
    },
    async deleteRecord(id) {
      return client.deleteDocument(RECORDS_PATH, id);
    },

    // Credential documents are keyed by username, so "set" is just an upsert
    // (Firestore's PATCH creates the document the first time it sees an id).
    async getCredential(username) {
      return client.getDocument(CREDENTIALS_PATH, username);
    },
    async setCredential(username, fields) {
      return client.updateDocument(CREDENTIALS_PATH, username, fields);
    },
    async deleteCredential(username) {
      return client.deleteDocument(CREDENTIALS_PATH, username);
    },
  };
}

module.exports = { createCloudStore, APP_ID, STAFF_PATH, RECORDS_PATH, CREDENTIALS_PATH };
