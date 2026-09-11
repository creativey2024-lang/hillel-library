// A minimal Firestore REST client using Node's built-in fetch (Node 18+), so no
// "firebase" npm package is required. It signs in anonymously exactly the way
// the old frontend code did (auth.signInAnonymously()), which is why it can
// read/write the same Firestore project without needing a service account key.

const IDENTITY_BASE = 'https://identitytoolkit.googleapis.com/v1';
const TOKEN_REFRESH_URL = 'https://securetoken.googleapis.com/v1/token';

function toFieldValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  return { stringValue: String(value) };
}

function toFields(obj) {
  const fields = {};
  for (const [key, value] of Object.entries(obj)) {
    fields[key] = toFieldValue(value);
  }
  return fields;
}

function fromFieldValue(fieldValue) {
  if (!fieldValue) return null;
  if ('stringValue' in fieldValue) return fieldValue.stringValue;
  if ('booleanValue' in fieldValue) return fieldValue.booleanValue;
  if ('integerValue' in fieldValue) return parseInt(fieldValue.integerValue, 10);
  if ('doubleValue' in fieldValue) return fieldValue.doubleValue;
  if ('timestampValue' in fieldValue) return fieldValue.timestampValue;
  if ('nullValue' in fieldValue) return null;
  return null;
}

function documentToRecord(doc) {
  const id = doc.name ? doc.name.split('/').pop() : undefined;
  const out = { id };
  const fields = doc.fields || {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = fromFieldValue(value);
  }
  return out;
}

class FirestoreRestClient {
  constructor({ apiKey, projectId }) {
    this.apiKey = apiKey;
    this.projectId = projectId;
    this.idToken = null;
    this.refreshToken = null;
    this.expiresAt = 0;
  }

  get documentsBaseUrl() {
    return `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents`;
  }

  async ensureAuth() {
    const now = Date.now();
    if (this.idToken && now < this.expiresAt - 60_000) {
      return this.idToken;
    }
    if (this.refreshToken) {
      try {
        return await this._refresh();
      } catch (err) {
        // fall through to a fresh anonymous sign-in
      }
    }
    return this._signInAnonymously();
  }

  async _signInAnonymously() {
    const res = await fetch(`${IDENTITY_BASE}/accounts:signUp?key=${this.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnSecureToken: true }),
    });
    if (!res.ok) {
      throw new Error(`Firebase anonymous sign-in failed (${res.status})`);
    }
    const data = await res.json();
    this.idToken = data.idToken;
    this.refreshToken = data.refreshToken;
    this.expiresAt = Date.now() + Number(data.expiresIn || 3600) * 1000;
    return this.idToken;
  }

  async _refresh() {
    const res = await fetch(`${TOKEN_REFRESH_URL}?key=${this.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.refreshToken,
      }),
    });
    if (!res.ok) {
      throw new Error(`Firebase token refresh failed (${res.status})`);
    }
    const data = await res.json();
    this.idToken = data.id_token;
    this.refreshToken = data.refresh_token;
    this.expiresAt = Date.now() + Number(data.expires_in || 3600) * 1000;
    return this.idToken;
  }

  async _authHeaders() {
    const token = await this.ensureAuth();
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  }

  async listDocuments(collectionPath) {
    const headers = await this._authHeaders();
    const res = await fetch(`${this.documentsBaseUrl}/${collectionPath}`, { headers });
    if (!res.ok) {
      throw new Error(`Firestore list failed for ${collectionPath} (${res.status})`);
    }
    const data = await res.json();
    return (data.documents || []).map(documentToRecord);
  }

  async createDocument(collectionPath, data) {
    const headers = await this._authHeaders();
    const res = await fetch(`${this.documentsBaseUrl}/${collectionPath}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ fields: toFields(data) }),
    });
    if (!res.ok) {
      throw new Error(`Firestore create failed for ${collectionPath} (${res.status})`);
    }
    const doc = await res.json();
    return documentToRecord(doc);
  }

  async updateDocument(collectionPath, id, patch) {
    const headers = await this._authHeaders();
    const mask = Object.keys(patch)
      .map((key) => `updateMask.fieldPaths=${encodeURIComponent(key)}`)
      .join('&');
    const res = await fetch(`${this.documentsBaseUrl}/${collectionPath}/${id}?${mask}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ fields: toFields(patch) }),
    });
    if (!res.ok) {
      throw new Error(`Firestore update failed for ${collectionPath}/${id} (${res.status})`);
    }
    const doc = await res.json();
    return documentToRecord(doc);
  }

  async deleteDocument(collectionPath, id) {
    const headers = await this._authHeaders();
    const res = await fetch(`${this.documentsBaseUrl}/${collectionPath}/${id}`, {
      method: 'DELETE',
      headers,
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(`Firestore delete failed for ${collectionPath}/${id} (${res.status})`);
    }
    return true;
  }
}

module.exports = { FirestoreRestClient, toFields, fromFieldValue, documentToRecord };
