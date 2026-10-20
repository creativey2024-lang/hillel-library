// Thin fetch wrapper around the backend REST API. No Firebase, no passwords,
// and no secrets live here - everything sensitive stays on the server; this
// file only ever talks to our own backend at /api/*.

const API_BASE = '/api';

async function apiRequest(path, { method = 'GET', body } = {}) {
    const res = await fetch(`${API_BASE}${path}`, {
        method,
        credentials: 'include', // send/receive the httpOnly session cookie
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    let data = null;
    try {
        data = await res.json();
    } catch (err) {
        // some responses (e.g. 204) may have no body
    }

    if (!res.ok) {
        const error = new Error((data && data.error) || `שגיאת שרת (${res.status})`);
        error.status = res.status;
        error.payload = data;
        throw error;
    }

    return data;
}

window.api = {
    // Auth
    login: (username, password) => apiRequest('/auth/login', { method: 'POST', body: { username, password } }),
    verifySuper: (password) => apiRequest('/auth/verify-super', { method: 'POST', body: { password } }),
    logout: () => apiRequest('/auth/logout', { method: 'POST' }),
    me: () => apiRequest('/auth/me'),

    // Meta
    getClasses: () => apiRequest('/meta/classes'),
    getStatus: () => apiRequest('/meta/status'),

    // Staff
    getStaff: () => apiRequest('/staff'),
    addOrUpdateStaff: (username, role) => apiRequest('/staff', { method: 'POST', body: { username, role } }),
    changeStaffRole: (id, role) => apiRequest(`/staff/${encodeURIComponent(id)}/role`, { method: 'PATCH', body: { role } }),
    removeStaff: (id) => apiRequest(`/staff/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    resetPassword: (id, newPassword) =>
        apiRequest(`/staff/${encodeURIComponent(id)}/reset-password`, { method: 'POST', body: { newPassword } }),

    // Records
    getRecords: () => apiRequest('/records'),
    addRecord: (data) => apiRequest('/records', { method: 'POST', body: data }),
    setRecordStatus: (id, status) => apiRequest(`/records/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: { status } }),
    setRecordNote: (id, note) => apiRequest(`/records/${encodeURIComponent(id)}/note`, { method: 'PATCH', body: { note } }),
    deleteRecord: (id) => apiRequest(`/records/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
