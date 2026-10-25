// Thin fetch wrapper around the backend REST API. No Firebase, no passwords,
// and no secrets live here - everything sensitive stays on the server; this
// file only ever talks to our own backend at /api/*.

const API_BASE = '/api';

// Each browser tab keeps its own login (sessionStorage is per tab, and the
// game inside the tab shares it). So logging in as someone else in another
// tab no longer swaps the user here. Without a tab session, the cookie is used.
const TAB_SESSION_KEY = 'hillel_tab_session';
const tabSession = {
    get() {
        try { return sessionStorage.getItem(TAB_SESSION_KEY) || ''; } catch (err) { return ''; }
    },
    set(token) {
        try {
            if (token) sessionStorage.setItem(TAB_SESSION_KEY, token);
            else sessionStorage.removeItem(TAB_SESSION_KEY);
        } catch (err) {
            // storage blocked: the cookie still works
        }
    },
};
window.hillelTabSession = tabSession;

async function apiRequest(path, { method = 'GET', body } = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const token = tabSession.get();
    if (token) headers['X-Hillel-Session'] = token;
    const res = await fetch(`${API_BASE}${path}`, {
        method,
        credentials: 'include', // send/receive the httpOnly session cookie
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    let data = null;
    try {
        data = await res.json();
    } catch (err) {
        // some responses (e.g. 204) may have no body
    }
    // a new login (or a new role) for this tab
    if (res.ok && data && typeof data.sessionToken === 'string') {
        tabSession.set(data.sessionToken);
        delete data.sessionToken;
    }
    // this tab's login ran out: start over at the login screen
    if (res.status === 401 && token && path === '/auth/me') tabSession.set('');

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
    logout: () => apiRequest('/auth/logout', { method: 'POST' }).finally(() => tabSession.set('')),
    me: () => apiRequest('/auth/me'),

    // Meta
    getClasses: () => apiRequest('/meta/classes'),
    getStatus: () => apiRequest('/meta/status'),

    // Classes (admin-editable list)
    getClassList: () => apiRequest('/classes'),
    addClass: (name) => apiRequest('/classes', { method: 'POST', body: { name } }),
    renameClass: (id, name) => apiRequest(`/classes/${encodeURIComponent(id)}`, { method: 'PATCH', body: { name } }),
    removeClass: (id) => apiRequest(`/classes/${encodeURIComponent(id)}`, { method: 'DELETE' }),

    // Games: coin wallet, runs and the shop
    getGameProfile: () => apiRequest('/games/profile'),
    startGameRun: (game) => apiRequest('/games/runs', { method: 'POST', body: { game } }),
    finishGameRun: (runId, coins, extra = {}) => apiRequest(`/games/runs/${encodeURIComponent(runId)}/finish`, { method: 'POST', body: { coins, ...extra } }),
    buyShopItem: (itemId) => apiRequest(`/games/shop/${encodeURIComponent(itemId)}/buy`, { method: 'POST', body: {} }),
    equipSkin: (skin) => apiRequest('/games/equip', { method: 'POST', body: { skin } }),

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
