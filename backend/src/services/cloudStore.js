const { FirestoreRestClient } = require('./firestoreRest');
const defaultClasses = require('../data/classes.json');

// Same Firestore project/collection layout the original app already used, so
// connecting this backend to Firebase picks up the school's existing live data.
const APP_ID = 'c_cf3d6ec4bbaf8b0d_index.html-892';
const STAFF_PATH = `artifacts/${APP_ID}/public/data/library_staff`;
const RECORDS_PATH = `artifacts/${APP_ID}/public/data/library_records`;
// Password hashes (never plaintext) - stored in their own collection so that,
// unlike a Render/Railway/etc. server's local disk, they survive a redeploy.
// The document id is the username itself, so a write is a simple upsert.
const CLASSES_PATH = `artifacts/${APP_ID}/public/data/library_classes`;
// One document per staff member (document id = username): coin wallet,
// owned / equipped game skins.
const GAME_PROFILES_PATH = `artifacts/${APP_ID}/public/data/library_game_profiles`;
const CREDENTIALS_PATH = `artifacts/${APP_ID}/public/data/library_credentials`;

function createCloudStore(config) {
  const client = new FirestoreRestClient(config);
  let seeding = null;

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

    // Classes: one document per class ({ name, order }). The very first time
    // the collection is found empty it is filled from the built-in list so the
    // school keeps its existing classes; after that the admins own the list.
    // (The last class can never be removed, so "empty" only means "never seeded".)
    async listClasses() {
      let docs = await client.listDocuments(CLASSES_PATH);
      if (docs.length === 0) {
        if (!seeding) {
          seeding = (async () => {
            for (let i = 0; i < defaultClasses.length; i += 1) {
              await client.createDocument(CLASSES_PATH, { name: defaultClasses[i], order: i + 1 });
            }
          })().finally(() => { seeding = null; });
        }
        await seeding;
        docs = await client.listDocuments(CLASSES_PATH);
      }
      return docs;
    },
    async addClass(data) {
      return client.createDocument(CLASSES_PATH, data);
    },
    async updateClass(id, patch) {
      return client.updateDocument(CLASSES_PATH, id, patch);
    },
    async removeClass(id) {
      return client.deleteDocument(CLASSES_PATH, id);
    },

    async getGameProfile(username) {
      return client.getDocument(GAME_PROFILES_PATH, username);
    },
    async saveGameProfile(username, fields) {
      return client.updateDocument(GAME_PROFILES_PATH, username, fields);
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

module.exports = { createCloudStore, APP_ID, STAFF_PATH, RECORDS_PATH, CLASSES_PATH, GAME_PROFILES_PATH, CREDENTIALS_PATH };
