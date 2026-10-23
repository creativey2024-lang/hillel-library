(() => {
    'use strict';

    // --- State ---
    let currentUser = null; // { username, role, isSuperAdmin } - source of truth is the backend session
    let staffList = [];
    let records = [];
    let classes = [];
    let classItems = []; // [{ id, name, order }] - admin view of the class list
    let classToDelete = null;
    let editingClassId = null;

    let filterClass = 'All';
    let searchQuery = '';

    let recordToDeleteId = null;
    let userToDelete = null; // { id, username, roleLabel }
    let noteModalRecordId = null;
    let resetPasswordTargetId = null;

    // --- Default loan dates: borrowed today, due back one month from today ---
    function toDateInputValue(d) {
        // Local calendar date (toISOString would use UTC and can be off by a day).
        const pad = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    // Same day next month; if that day doesn't exist (e.g. 31 Jan -> Feb), use
    // the last day of next month instead of spilling into the month after.
    function addOneMonth(date) {
        const result = new Date(date.getFullYear(), date.getMonth() + 1, 1);
        const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
        result.setDate(Math.min(date.getDate(), lastDay));
        return result;
    }

    // Computed each time it is used, so a tab left open overnight still gets today's date.
    function resetLoanDates() {
        const now = new Date();
        document.getElementById('borrowDate').value = toDateInputValue(now);
        document.getElementById('returnDate').value = toDateInputValue(addOneMonth(now));
    }

    // --- Theme (purely a local display preference, not sensitive) ---
    function setTheme(theme) {
        const htmlEl = document.documentElement;
        if (theme === 'dark') {
            htmlEl.classList.remove('light');
            htmlEl.classList.add('dark');
        } else {
            htmlEl.classList.remove('dark');
            htmlEl.classList.add('light');
        }
        try {
            localStorage.setItem('library_theme', theme);
        } catch (err) {
            // localStorage may be unavailable (private mode); theme just won't persist
        }
    }

    function getSavedTheme() {
        try {
            return localStorage.getItem('library_theme') || 'light';
        } catch (err) {
            return 'light';
        }
    }

    // --- Toast ---
    let toastTimeout;
    function showToast(message, isError = false) {
        const toast = document.getElementById('toastNotification');
        const toastMsg = document.getElementById('toastMessage');
        if (toastMsg) toastMsg.textContent = message;
        if (toast) {
            toast.className = `fixed top-6 left-1/2 transform -translate-x-1/2 px-5 py-3 rounded-2xl shadow-xl text-white text-sm font-semibold z-50 transition-all duration-300 ${isError ? 'bg-red-500/90' : 'bg-green-600/90'}`;
            toast.classList.remove('opacity-0', 'pointer-events-none', 'translate-y-[-20px]');
        }
        clearTimeout(toastTimeout);
        toastTimeout = setTimeout(() => {
            if (toast) toast.classList.add('opacity-0', 'pointer-events-none', 'translate-y-[-20px]');
        }, 3000);
    }

    // --- Utils ---
    function isLate(dueDateStr) {
        if (!dueDateStr) return false;
        const dueDate = new Date(dueDateStr);
        const currentDate = new Date();
        dueDate.setHours(0, 0, 0, 0);
        currentDate.setHours(0, 0, 0, 0);
        return currentDate > dueDate;
    }

    function formatDate(dateStr) {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        return date.toLocaleDateString('he-IL');
    }

    function escapeHtml(unsafe) {
        if (!unsafe) return '';
        return String(unsafe)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function errorMessage(err, fallback) {
        return (err && err.message) || fallback;
    }

    // --- Auth / session ---
    async function checkSession() {
        try {
            const me = await window.api.me();
            currentUser = me;
            await enterApp();
        } catch (err) {
            currentUser = null;
            showLoginScreen();
        }
    }

    function showLoginScreen() {
        document.getElementById('loadingScreen').classList.add('hidden');
        document.getElementById('loginScreen').classList.remove('hidden');
        document.getElementById('markPasswordScreen').classList.add('hidden');
        document.getElementById('userMenuContainer').classList.add('hidden');
        document.getElementById('localModeBanner').classList.add('hidden');
    }

    async function performLogin() {
        const usernameInput = document.getElementById('usernameInput');
        const passwordInput = document.getElementById('passwordInput');
        const loginError = document.getElementById('loginError');

        const username = usernameInput.value.trim();
        const password = passwordInput.value;

        if (!username || !password) {
            loginError.textContent = 'נא למלא שם משתמש וסיסמה';
            loginError.classList.remove('hidden');
            return;
        }

        try {
            const result = await window.api.login(username, password);
            loginError.classList.add('hidden');

            if (result.requiresSuperVerification) {
                document.getElementById('loginScreen').classList.add('hidden');
                document.getElementById('markPasswordScreen').classList.remove('hidden');
                document.getElementById('markPasswordInput').focus();
                return;
            }

            passwordInput.value = '';
            currentUser = result;
            await enterApp();
        } catch (err) {
            loginError.textContent = errorMessage(err, 'שם משתמש או סיסמה שגויים, או שאינך מורשה כניסה.');
            loginError.classList.remove('hidden');
            passwordInput.value = '';
            passwordInput.focus();
        }
    }

    async function performMarkVerification() {
        const markPasswordInput = document.getElementById('markPasswordInput');
        const markPasswordError = document.getElementById('markPasswordError');

        try {
            const result = await window.api.verifySuper(markPasswordInput.value);
            markPasswordError.classList.add('hidden');
            markPasswordInput.value = '';
            document.getElementById('markPasswordScreen').classList.add('hidden');
            currentUser = result;
            await enterApp();
        } catch (err) {
            markPasswordError.textContent = errorMessage(err, 'סיסמת מנהל על שגויה!');
            markPasswordError.classList.remove('hidden');
            markPasswordInput.value = '';
            markPasswordInput.focus();
        }
    }

    function cancelMarkVerification() {
        document.getElementById('markPasswordInput').value = '';
        document.getElementById('markPasswordError').classList.add('hidden');
        document.getElementById('markPasswordScreen').classList.add('hidden');
        document.getElementById('loginScreen').classList.remove('hidden');
        document.getElementById('usernameInput').value = '';
        document.getElementById('passwordInput').value = '';
        document.getElementById('usernameInput').focus();
    }

    async function logout() {
        try {
            await window.api.logout();
        } catch (err) {
            // ignore - we're logging out regardless
        }
        location.reload();
    }

    function populateUserProfile() {
        if (!currentUser) return;
        document.getElementById('userAvatarLetter').textContent = currentUser.username.charAt(0);
        document.getElementById('loggedInUserName').textContent = currentUser.username;
        document.getElementById('userMenuContainer').classList.remove('hidden');
    }

    async function enterApp() {
        document.getElementById('loginScreen').classList.add('hidden');
        document.getElementById('markPasswordScreen').classList.add('hidden');
        populateUserProfile();

        const adminBtn = document.getElementById('adminPanelBtn');
        if (currentUser.role === 'admin') {
            adminBtn.classList.remove('hidden');
            adminBtn.classList.add('flex');
        } else {
            adminBtn.classList.add('hidden');
            adminBtn.classList.remove('flex');
        }

        await Promise.all([loadClasses(), loadRecords(), loadStaff().catch(() => {})]);
        await refreshStatusBanner();

        document.getElementById('loadingScreen').classList.add('hidden');
    }

    async function refreshStatusBanner() {
        const banner = document.getElementById('localModeBanner');
        try {
            const status = await window.api.getStatus();
            if (!status.cloudMode && currentUser && currentUser.role === 'admin') {
                banner.classList.remove('hidden');
            } else {
                banner.classList.add('hidden');
            }
        } catch (err) {
            banner.classList.add('hidden');
        }
    }

    // --- Classes ---
    async function loadClasses() {
        classes = await window.api.getClasses();

        const classSelect = document.getElementById('studentClass');
        classSelect.querySelectorAll('option:not([value=""])').forEach((opt) => opt.remove());
        classes.forEach((c) => {
            const option = document.createElement('option');
            option.value = c;
            option.textContent = c;
            classSelect.appendChild(option);
        });
    }

    // --- Admin: class management ---
    async function loadClassItems() {
        classItems = await window.api.getClassList();
        renderClassesList();
    }

    // Reload everything that depends on the class list: the dropdown in the
    // loan form, the filter buttons, and the records (a rename changes them).
    async function refreshAfterClassChange() {
        await Promise.all([loadClasses(), loadClassItems()]);
        if (filterClass !== 'All' && filterClass !== 'Late' && !classes.includes(filterClass)) {
            filterClass = 'All';
        }
        await loadRecords();
        renderUI();
    }

    function renderClassesList() {
        const container = document.getElementById('classesListContainer');
        if (!container) return;
        container.innerHTML = '';
        document.getElementById('classesCount').textContent = `(${classItems.length})`;

        classItems.forEach((item) => {
            const li = document.createElement('li');
            li.className = 'flex items-center justify-between gap-2 px-3 py-2 hover:bg-slate-50 dark:hover:bg-zinc-800/50 transition-colors';

            if (item.id === editingClassId) {
                li.innerHTML = `
                    <input type="text" maxlength="30" data-class-input value="${escapeHtml(item.name)}" class="flex-1 min-w-0 p-1.5 border border-blue-400 dark:border-blue-500 dark:bg-slate-600 dark:text-white rounded-lg outline-none text-sm bg-white">
                    <div class="flex items-center gap-1 shrink-0">
                        <button type="button" data-class-save class="text-white bg-green-600 hover:bg-green-700 px-2.5 py-1.5 rounded-lg text-xs font-medium" title="שמור">
                            <i class="fa-solid fa-check"></i>
                        </button>
                        <button type="button" data-class-cancel class="text-slate-600 dark:text-slate-200 bg-slate-200 dark:bg-slate-600 hover:bg-slate-300 dark:hover:bg-slate-500 px-2.5 py-1.5 rounded-lg text-xs font-medium" title="ביטול">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>
                `;
                const input = li.querySelector('[data-class-input]');
                const save = () => saveClassRename(item.id, input.value);
                li.querySelector('[data-class-save]').addEventListener('click', save);
                li.querySelector('[data-class-cancel]').addEventListener('click', () => {
                    editingClassId = null;
                    renderClassesList();
                });
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') { e.preventDefault(); save(); }
                    if (e.key === 'Escape') { editingClassId = null; renderClassesList(); }
                });
                container.appendChild(li);
                setTimeout(() => { input.focus(); input.select(); }, 0);
                return;
            }

            li.innerHTML = `
                <span class="font-medium text-slate-800 dark:text-slate-200 text-sm">${escapeHtml(item.name)}</span>
                <div class="flex items-center gap-1 shrink-0">
                    <button type="button" data-class-edit class="text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 p-1.5 rounded-lg transition-colors border border-transparent hover:border-blue-200" title="שנה שם">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    <button type="button" data-class-remove class="text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 p-1.5 rounded-lg transition-colors border border-transparent hover:border-red-200" title="הסר כיתה">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            `;
            li.querySelector('[data-class-edit]').addEventListener('click', () => {
                editingClassId = item.id;
                renderClassesList();
            });
            li.querySelector('[data-class-remove]').addEventListener('click', () => askRemoveClass(item));
            container.appendChild(li);
        });
    }

    async function handleAddClassSubmit(e) {
        e.preventDefault();
        const input = document.getElementById('newClassInput');
        try {
            const created = await window.api.addClass(input.value);
            input.value = '';
            showToast(`הכיתה ${created.name} נוספה`);
            await refreshAfterClassChange();
        } catch (err) {
            showToast(errorMessage(err, 'שגיאה בהוספת הכיתה'), true);
        }
    }

    async function saveClassRename(id, newName) {
        const current = classItems.find((c) => c.id === id);
        try {
            const result = await window.api.renameClass(id, newName);
            editingClassId = null;
            if (current && filterClass === current.name) filterClass = result.class.name;
            showToast(result.recordsUpdated
                ? `שם הכיתה עודכן (${result.recordsUpdated === 1 ? 'השאלה אחת עודכנה' : result.recordsUpdated + ' השאלות עודכנו'})`
                : 'שם הכיתה עודכן');
            await refreshAfterClassChange();
        } catch (err) {
            showToast(errorMessage(err, 'שגיאה בשינוי שם הכיתה'), true);
        }
    }

    function askRemoveClass(item) {
        classToDelete = item;
        const used = records.filter((r) => r.studentClass === item.name).length;
        document.getElementById('classDeleteModalMessage').innerHTML =
            `האם להסיר את הכיתה <strong>${escapeHtml(item.name)}</strong>?` +
            (used ? `<br>${used === 1 ? 'השאלה אחת' : used + ' השאלות'} של הכיתה לא יימחקו, ${used === 1 ? 'והיא תמשיך' : 'והן ימשיכו'} להופיע תחת "כל התלמידים".` : '');
        document.getElementById('classDeleteModal').classList.remove('hidden');
    }

    function closeClassDeleteModal() {
        classToDelete = null;
        document.getElementById('classDeleteModal').classList.add('hidden');
    }

    async function confirmClassDelete() {
        if (!classToDelete) return;
        const item = classToDelete;
        closeClassDeleteModal();
        try {
            await window.api.removeClass(item.id);
            showToast(`הכיתה ${item.name} הוסרה`);
            await refreshAfterClassChange();
        } catch (err) {
            showToast(errorMessage(err, 'שגיאה בהסרת הכיתה'), true);
        }
    }

    // --- Admin: staff management ---
    async function loadStaff() {
        staffList = await window.api.getStaff();
        renderAdminUsersList();
    }

    function openAdminModal() {
        if (!currentUser || currentUser.role !== 'admin') {
            showToast('גישה חסומה! אינך מנהל מערכת.', true);
            return;
        }

        const roleOptionAdmin = document.getElementById('roleOptionAdmin');
        const newUserRoleInput = document.getElementById('newUserRoleInput');
        if (currentUser.isSuperAdmin) {
            roleOptionAdmin.style.display = 'block';
        } else {
            roleOptionAdmin.style.display = 'none';
            newUserRoleInput.value = 'librarian';
        }

        editingClassId = null;
        loadStaff().catch((err) => showToast(errorMessage(err, 'שגיאה בטעינת רשימת הצוות'), true));
        loadClassItems().catch((err) => showToast(errorMessage(err, 'שגיאה בטעינת רשימת הכיתות'), true));
        document.getElementById('adminModal').classList.remove('hidden');
    }

    function closeAdminModal() {
        document.getElementById('adminModal').classList.add('hidden');
    }

    function renderAdminUsersList() {
        const container = document.getElementById('usersListContainer');
        if (!container) return;
        container.innerHTML = '';

        const sortedStaff = [...staffList].sort((a, b) => {
            if (a.isSuperAdmin) return -1;
            if (b.isSuperAdmin) return 1;
            if (a.role === 'admin' && b.role !== 'admin') return -1;
            if (a.role !== 'admin' && b.role === 'admin') return 1;
            return 0;
        });

        sortedStaff.forEach((member) => {
            const isMemberAdmin = member.role === 'admin';
            const li = document.createElement('li');
            li.className = 'flex flex-col sm:flex-row justify-between sm:items-center p-3.5 hover:bg-slate-50 dark:hover:bg-zinc-800/50 transition-colors gap-2';

            let roleAreaHtml = '';
            if (member.isSuperAdmin) {
                roleAreaHtml = `<span class="text-xs font-semibold text-red-600 bg-red-50 px-2.5 py-1 rounded-full border border-red-200 flex items-center gap-1">
                    <i class="fa-solid fa-crown"></i> מנהל על
                </span>`;
            } else if (currentUser.isSuperAdmin) {
                roleAreaHtml = `
                    <select data-role-select data-id="${escapeHtml(member.id)}" data-username="${escapeHtml(member.username)}" class="text-xs border border-slate-300 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white rounded-xl px-2.5 py-1.5 outline-none font-semibold text-slate-700 focus:ring-1 focus:ring-blue-500">
                        <option value="librarian" ${!isMemberAdmin ? 'selected' : ''}>ספרן רגיל</option>
                        <option value="admin" ${isMemberAdmin ? 'selected' : ''}>מנהל (אדמין)</option>
                    </select>
                `;
            } else if (isMemberAdmin) {
                roleAreaHtml = `<span class="text-xs font-semibold text-amber-600 bg-amber-50 dark:bg-amber-900/20 px-2.5 py-1 rounded-full border border-amber-200 dark:border-amber-900/50 flex items-center gap-1">
                    <i class="fa-solid fa-user-shield"></i> מנהל מערכת
                </span>`;
            } else {
                roleAreaHtml = `<span class="text-xs font-semibold text-slate-600 bg-slate-50 dark:bg-zinc-800 dark:text-slate-300 px-2.5 py-1 rounded-full border border-slate-200 dark:border-zinc-700 flex items-center gap-1">
                    <i class="fa-solid fa-user"></i> ספרן רגיל
                </span>`;
            }

            const resetPwHtml = `<button data-reset-pw data-id="${escapeHtml(member.id)}" data-username="${escapeHtml(member.username)}" class="text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 p-1.5 rounded-lg transition-colors border border-transparent hover:border-blue-200" title="אפס סיסמה">
                <i class="fa-solid fa-key"></i>
            </button>`;

            let deleteActionHtml = '';
            if (!member.isSuperAdmin) {
                const canDelete = currentUser.isSuperAdmin || !isMemberAdmin;
                if (canDelete) {
                    deleteActionHtml = `<button data-remove-user data-id="${escapeHtml(member.id)}" data-username="${escapeHtml(member.username)}" data-role="${isMemberAdmin ? 'admin' : 'librarian'}" class="text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 p-1.5 rounded-lg transition-colors border border-transparent hover:border-red-200" title="הסר גישה">
                        <i class="fa-solid fa-user-minus"></i>
                    </button>`;
                }
            }

            li.innerHTML = `
                <span class="font-medium text-slate-800 dark:text-slate-200 flex items-center gap-2 text-sm">
                    <i class="fa-solid ${member.isSuperAdmin ? 'fa-crown text-red-500' : isMemberAdmin ? 'fa-user-gear text-amber-500' : 'fa-user text-slate-400'}"></i>
                    ${escapeHtml(member.username)}
                </span>
                <div class="flex items-center gap-2 justify-end">
                    ${roleAreaHtml}
                    ${currentUser.isSuperAdmin ? resetPwHtml : ''}
                    ${deleteActionHtml}
                </div>
            `;
            container.appendChild(li);
        });

        container.querySelectorAll('[data-role-select]').forEach((select) => {
            select.addEventListener('change', (e) => {
                changeUserRole(select.dataset.id, select.dataset.username, e.target.value);
            });
        });
        container.querySelectorAll('[data-remove-user]').forEach((btn) => {
            btn.addEventListener('click', () => {
                removeUser(btn.dataset.id, btn.dataset.username, btn.dataset.role);
            });
        });
        container.querySelectorAll('[data-reset-pw]').forEach((btn) => {
            btn.addEventListener('click', () => {
                openResetPasswordModal(btn.dataset.id, `אפס סיסמה עבור ${btn.dataset.username}`);
            });
        });
    }

    async function changeUserRole(id, username, newRole) {
        try {
            await window.api.changeStaffRole(id, newRole);
            showToast('התפקיד עודכן בהצלחה!');
            await loadStaff();
        } catch (err) {
            showToast(errorMessage(err, 'שגיאה בעדכון התפקיד'), true);
            await loadStaff();
        }
    }

    async function handleAddUserSubmit(e) {
        e.preventDefault();
        const input = document.getElementById('newUsernameInput');
        const roleInput = document.getElementById('newUserRoleInput');

        try {
            const result = await window.api.addOrUpdateStaff(input.value.trim(), roleInput.value);
            if (result.created) {
                showToast(`המשתמש נוסף בהצלחה! (סיסמת ברירת מחדל: ${result.defaultPassword})`);
            } else {
                showToast('התפקיד עודכן בהצלחה!');
            }
            input.value = '';
            roleInput.value = 'librarian';
            await loadStaff();
        } catch (err) {
            showToast(errorMessage(err, 'שגיאה בהוספת המשתמש'), true);
        }
    }

    function removeUser(id, username, role) {
        userToDelete = { id, username, role };
        document.getElementById('userDeleteModalMessage').innerHTML =
            `האם אתה בטוח שברצונך להסיר את גישת ה-${role === 'admin' ? 'מנהל' : 'ספרן'} של <strong>${escapeHtml(username)}</strong>?`;
        document.getElementById('userDeleteModal').classList.remove('hidden');
    }

    function closeUserDeleteModal() {
        userToDelete = null;
        document.getElementById('userDeleteModal').classList.add('hidden');
    }

    async function confirmUserDelete() {
        if (!userToDelete) return;
        const shouldLogout = currentUser && currentUser.username === userToDelete.username;

        try {
            await window.api.removeStaff(userToDelete.id);
            showToast('המשתמש הוסר בהצלחה');
            closeUserDeleteModal();
            if (shouldLogout) {
                logout();
                return;
            }
            await loadStaff();
        } catch (err) {
            showToast(errorMessage(err, 'שגיאה בהסרת המשתמש'), true);
            closeUserDeleteModal();
        }
    }

    // --- Password reset ---
    function openResetPasswordModal(id, message) {
        resetPasswordTargetId = id;
        document.getElementById('resetPasswordModalMessage').textContent = message;
        document.getElementById('resetPasswordInput').value = '';
        document.getElementById('resetPasswordModal').classList.remove('hidden');
        document.getElementById('resetPasswordInput').focus();
    }

    function closeResetPasswordModal() {
        resetPasswordTargetId = null;
        document.getElementById('resetPasswordModal').classList.add('hidden');
    }

    async function confirmResetPassword() {
        if (!resetPasswordTargetId) return;
        const newPassword = document.getElementById('resetPasswordInput').value;
        if (!newPassword || newPassword.length < 3) {
            showToast('סיסמה חייבת להכיל לפחות 3 תווים', true);
            return;
        }
        try {
            await window.api.resetPassword(resetPasswordTargetId, newPassword);
            showToast('הסיסמה עודכנה בהצלחה!');
            closeResetPasswordModal();
        } catch (err) {
            showToast(errorMessage(err, 'שגיאה בעדכון הסיסמה'), true);
        }
    }

    async function openMyPasswordModal() {
        document.getElementById('userDropdown').classList.add('hidden');
        try {
            const staff = await window.api.getStaff();
            const me = staff.find((s) => s.username === currentUser.username);
            if (!me) {
                showToast('לא ניתן היה לאתר את המשתמש שלך', true);
                return;
            }
            openResetPasswordModal(me.id, 'בחר/י סיסמה חדשה לחשבון שלך');
        } catch (err) {
            showToast(errorMessage(err, 'שגיאה בטעינת פרטי המשתמש'), true);
        }
    }

    // --- Records: rendering ---
    function renderUI() {
        renderFilters();
        renderTable();
    }

    function renderFilters() {
        const container = document.getElementById('filterContainer');
        if (!container) return;
        container.innerHTML = '';

        const createBtn = (text, value, isSpecial = false) => {
            const isActive = filterClass === value;
            const btn = document.createElement('button');
            if (isSpecial) {
                btn.className = `px-4 py-1.5 rounded-full text-xs font-semibold transition-all border ${isActive ? 'bg-orange-500 text-white border-orange-500' : 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20 hover:bg-orange-500/20'}`;
            } else {
                btn.className = `px-4 py-1.5 rounded-full text-xs font-semibold transition-all border ${isActive ? 'bg-blue-600 text-white border-blue-600 shadow-sm' : 'bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-slate-300 border-transparent hover:bg-slate-200/50 dark:hover:bg-zinc-700/50'}`;
            }
            btn.innerHTML = text;
            btn.onclick = () => {
                filterClass = value;
                renderUI();
            };
            return btn;
        };

        container.appendChild(createBtn('כל התלמידים', 'All'));
        container.appendChild(createBtn('<i class="fa-solid fa-triangle-exclamation ml-1"></i> מאחרים בלבד', 'Late', true));
        classes.forEach((c) => container.appendChild(createBtn(c, c)));
    }

    function renderTable() {
        const tbody = document.getElementById('recordsTableBody');
        if (!tbody) return;
        const title = document.getElementById('tableTitle');
        const badge = document.getElementById('totalRecordsBadge');

        let filteredRecords = filterClass === 'All'
            ? records
            : filterClass === 'Late'
                ? records.filter((r) => r.status === 'late' || (r.status !== 'returned' && isLate(r.returnDate)))
                : records.filter((r) => r.studentClass === filterClass);

        if (searchQuery) {
            filteredRecords = filteredRecords.filter((record) =>
                (record.bookName && record.bookName.toLowerCase().includes(searchQuery)) ||
                (record.studentName && record.studentName.toLowerCase().includes(searchQuery)) ||
                (record.studentClass && record.studentClass.toLowerCase().includes(searchQuery))
            );
        }

        let titleText = 'רשימת השאלות';
        if (filterClass === 'Late') titleText += ' - מאחרים';
        else if (filterClass !== 'All') titleText += ` - ${filterClass}`;
        title.innerHTML = `<i class="fa-regular fa-calendar text-blue-500"></i> ${titleText}`;
        badge.textContent = `סה"כ: ${filteredRecords.length}`;

        if (filteredRecords.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" class="px-6 py-12 text-center text-slate-400 dark:text-slate-500">
                        <i class="fa-solid fa-book-open text-5xl mb-3 opacity-20 block"></i>
                        אין רשומות להצגה.
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = '';
        filteredRecords.forEach((record) => {
            const isLateStatus = record.status === 'late' || (record.status !== 'returned' && isLate(record.returnDate));

            let statusHtml;
            if (record.status === 'returned') {
                statusHtml = `<span class="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[10px] font-bold bg-green-500/10 text-green-700 dark:text-green-400 border border-green-500/20">
                    <i class="fa-solid fa-check-circle"></i> הוחזר ב-${formatDate(record.actualReturnDate)}
                </span>`;
            } else if (isLateStatus) {
                statusHtml = `<span class="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[10px] font-bold bg-red-500/10 text-red-700 dark:text-red-400 border border-red-500/20 shadow-sm animate-pulse">
                    <i class="fa-solid fa-triangle-exclamation"></i> באיחור!
                </span>`;
            } else {
                statusHtml = `<span class="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[10px] font-bold bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-500/20">
                    <i class="fa-regular fa-clock"></i> מושאל
                </span>`;
            }

            let actionHtml = '';
            if (record.status === 'returned') {
                actionHtml = `<button data-status-btn data-id="${escapeHtml(record.id)}" data-status="borrowed" class="flex items-center gap-1 bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-700 dark:text-slate-200 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors" title="ביטול החזרה">
                    <i class="fa-solid fa-rotate-left text-[10px]"></i> ביטול
                </button>`;
            } else {
                actionHtml = `<button data-status-btn data-id="${escapeHtml(record.id)}" data-status="returned" class="flex items-center gap-1 bg-green-600 hover:bg-green-500 text-white px-3 py-1.5 rounded-xl text-xs font-semibold transition-all shadow-sm active:scale-[0.98]" title="לחץ לסימון שהספר חזר לספרייה">
                    <i class="fa-solid fa-check text-[10px]"></i> החזר
                </button>`;
                if (record.status !== 'late') {
                    actionHtml += `<button data-status-btn data-id="${escapeHtml(record.id)}" data-status="late" class="flex items-center gap-1 bg-orange-500 hover:bg-orange-400 text-white px-3 py-1.5 rounded-xl text-xs font-semibold transition-all shadow-sm active:scale-[0.98]" title="סמן את התלמיד כמאחר ידנית">
                        <i class="fa-solid fa-triangle-exclamation text-[10px]"></i> איחור
                    </button>`;
                } else {
                    actionHtml += `<button data-status-btn data-id="${escapeHtml(record.id)}" data-status="borrowed" class="flex items-center gap-1 bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-700 dark:text-slate-200 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors" title="בטל סטטוס איחור">
                        <i class="fa-solid fa-rotate-left text-[10px]"></i> בטל איחור
                    </button>`;
                }
            }

            const hasNote = record.note && record.note.trim().length > 0;
            const notePreview = hasNote
                ? escapeHtml(record.note.length > 40 ? `${record.note.slice(0, 40)}...` : record.note)
                : '<span class="text-slate-300 dark:text-slate-600">אין הערה</span>';
            const noteCellHtml = `
                <button data-note-btn data-id="${escapeHtml(record.id)}" class="flex items-center gap-1.5 text-right max-w-[160px] group" title="${hasNote ? 'ערוך הערה' : 'הוסף הערה'}">
                    <i class="fa-solid ${hasNote ? 'fa-note-sticky text-amber-500' : 'fa-plus text-slate-300 dark:text-slate-600 group-hover:text-amber-500'} text-xs shrink-0"></i>
                    <span class="text-xs truncate ${hasNote ? 'text-slate-600 dark:text-slate-300' : ''}">${notePreview}</span>
                </button>
            `;

            const tr = document.createElement('tr');
            tr.className = 'hover:bg-slate-50/50 dark:hover:bg-zinc-800/40 transition-colors bg-white dark:bg-slate-800';
            tr.innerHTML = `
                <td class="px-6 py-3.5 font-semibold text-slate-800 dark:text-slate-100 text-sm">
                    <div>${escapeHtml(record.studentName)}</div>
                    <div class="text-[10px] text-slate-400 dark:text-slate-500 font-normal mt-0.5 flex items-center gap-1">
                        <i class="fa-solid fa-user-pen text-slate-300 dark:text-slate-700"></i>
                        <span>רשם/ה: ${escapeHtml(record.addedBy || 'מערכת')}</span>
                    </div>
                </td>
                <td class="px-6 py-3.5 text-slate-600 dark:text-slate-400 text-sm">
                    <span class="bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-slate-300 px-2 py-1 rounded-lg text-xs font-bold">${escapeHtml(record.studentClass || '-')}</span>
                </td>
                <td class="px-6 py-3.5 text-slate-700 dark:text-slate-300 text-sm font-medium">${escapeHtml(record.bookName)}</td>
                <td class="px-6 py-3.5 text-slate-500 dark:text-slate-400 text-xs">${formatDate(record.borrowDate)}</td>
                <td class="px-6 py-3.5 text-slate-500 dark:text-slate-400 text-xs">
                    ${formatDate(record.returnDate)}
                    ${isLateStatus ? '<span class="block text-[10px] text-red-500 mt-0.5 font-bold">עבר תאריך היעד</span>' : ''}
                </td>
                <td class="px-6 py-3.5">${statusHtml}</td>
                <td class="px-6 py-3.5">${noteCellHtml}</td>
                <td class="px-6 py-3.5">
                    <div class="flex justify-center items-center gap-1.5">
                        ${actionHtml}
                        <button data-delete-record data-id="${escapeHtml(record.id)}" class="text-slate-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-500/10 p-2 rounded-xl transition-all" title="מחק רשומה">
                            <i class="fa-solid fa-trash-can text-sm"></i>
                        </button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });

        tbody.querySelectorAll('[data-status-btn]').forEach((btn) => {
            btn.addEventListener('click', () => handleStatusChange(btn.dataset.id, btn.dataset.status));
        });
        tbody.querySelectorAll('[data-note-btn]').forEach((btn) => {
            btn.addEventListener('click', () => openNoteModal(btn.dataset.id));
        });
        tbody.querySelectorAll('[data-delete-record]').forEach((btn) => {
            btn.addEventListener('click', () => openDeleteModal(btn.dataset.id));
        });
    }

    async function loadRecords() {
        try {
            records = await window.api.getRecords();
            renderUI();
        } catch (err) {
            showToast(errorMessage(err, 'שגיאה בטעינת רשימת ההשאלות'), true);
        }
    }

    async function handleAddRecordSubmit(e) {
        e.preventDefault();
        const studentName = document.getElementById('studentName').value.trim();
        const studentClass = document.getElementById('studentClass').value;
        const bookName = document.getElementById('bookName').value.trim();
        const borrowDate = document.getElementById('borrowDate').value;
        const returnDate = document.getElementById('returnDate').value;
        const note = document.getElementById('recordNote').value.trim();

        if (!studentName || !bookName || !studentClass) {
            showToast('נא למלא את כל השדות', true);
            return;
        }

        try {
            await window.api.addRecord({ studentName, studentClass, bookName, borrowDate, returnDate, note });
            showToast('ההשאלה נשמרה בהצלחה!');

            document.getElementById('studentName').value = '';
            document.getElementById('bookName').value = '';
            document.getElementById('studentClass').value = '';
            document.getElementById('recordNote').value = '';
            resetLoanDates();

            await loadRecords();
        } catch (err) {
            showToast(errorMessage(err, 'שגיאה בשמירת ההשאלה'), true);
        }
    }

    async function handleStatusChange(id, newStatus) {
        try {
            await window.api.setRecordStatus(id, newStatus);
            showToast('הסטטוס עודכן בהצלחה!');
            await loadRecords();
        } catch (err) {
            showToast(errorMessage(err, 'שגיאה בעדכון הסטטוס'), true);
        }
    }

    function openDeleteModal(id) {
        recordToDeleteId = id;
        document.getElementById('deleteModal').classList.remove('hidden');
    }

    function closeDeleteModal() {
        recordToDeleteId = null;
        document.getElementById('deleteModal').classList.add('hidden');
    }

    async function confirmDelete() {
        if (!recordToDeleteId) return;
        try {
            await window.api.deleteRecord(recordToDeleteId);
            showToast('הרשומה נמחקה בהצלחה');
            await loadRecords();
        } catch (err) {
            showToast(errorMessage(err, 'שגיאה במחיקת הרשומה'), true);
        }
        closeDeleteModal();
    }

    // --- Notes ("add an option to every book to add a note") ---
    function openNoteModal(id) {
        const record = records.find((r) => r.id === id);
        if (!record) return;
        noteModalRecordId = id;
        document.getElementById('noteModalSubtitle').textContent = `${record.bookName} - ${record.studentName}`;
        document.getElementById('noteModalTextarea').value = record.note || '';
        document.getElementById('noteModal').classList.remove('hidden');
        document.getElementById('noteModalTextarea').focus();
    }

    function closeNoteModal() {
        noteModalRecordId = null;
        document.getElementById('noteModal').classList.add('hidden');
    }

    async function saveNote() {
        if (!noteModalRecordId) return;
        const note = document.getElementById('noteModalTextarea').value;
        try {
            await window.api.setRecordNote(noteModalRecordId, note);
            showToast('ההערה נשמרה בהצלחה!');
            closeNoteModal();
            await loadRecords();
        } catch (err) {
            showToast(errorMessage(err, 'שגיאה בשמירת ההערה'), true);
        }
    }

    // --- Fun little break: the profile-menu game ---
    // The game lives in its own folder (frontend/games/runner) and runs inside
    // an iframe, so its 3D engine, keyboard handling and styles never mix with
    // the library page. Loading it only when the window opens (and unloading
    // it on close) means it costs nothing until someone actually plays.
    // --- Games: a picker, then the chosen game in an iframe ---
    const GAMES = {
        runner: {
            url: '/games/runner/index.html',
            title: 'ריצה בעיר',
            subtitle: 'חיצים / החלקה להחלפת מסלול · רווח / הקשה לקפיצה',
            icon: 'fa-person-running',
            iconClass: 'bg-sky-100 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400',
            bestKey: 'hillel_city_runner_best',
        },
        jumper: {
            url: '/games/jumper/index.html',
            title: 'קפיצה בשמיים',
            subtitle: 'רווח / הקשה לקפיצה (ארוכה = גבוהה) · למטה לנחיתה מהירה',
            icon: 'fa-cloud',
            iconClass: 'bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400',
            bestKey: 'hillel_sky_hop_best',
        },
        arena: {
            url: '/games/arena/index.html',
            title: 'קרב באי',
            subtitle: 'WASD תנועה · עכבר כיוון וירי · E תיבות ונשקים · Esc הפסקה',
            icon: 'fa-crosshairs',
            iconClass: 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400',
            bestKey: 'hillel_arena_best',
        },
    };
    const PICKER_HEADER = {
        title: 'בחרו משחק',
        subtitle: 'בחרו משחק ותתחילו - המטבעות נשמרים בחשבון שלכם',
        icon: 'fa-gamepad',
        iconClass: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400',
    };
    let currentGame = null;

    function setGameHeader({ title, subtitle, icon, iconClass }) {
        document.getElementById('gameModalTitle').textContent = title;
        document.getElementById('gameModalSubtitle').textContent = subtitle;
        const iconBox = document.getElementById('gameModalIcon');
        iconBox.className = `w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${iconClass}`;
        iconBox.innerHTML = `<i class="fa-solid ${icon}"></i>`;
    }

    function readBest(key) {
        try {
            return parseInt(localStorage.getItem(key), 10) || 0;
        } catch (err) {
            return 0;
        }
    }

    // Which of the three views of the game window is showing.
    function showGameView(view) {
        document.getElementById('gamePicker').classList.toggle('hidden', view !== 'picker');
        document.getElementById('gameShop').classList.toggle('hidden', view !== 'shop');
        document.getElementById('gameView').classList.toggle('hidden', view !== 'game');
        document.getElementById('gameRestartBtn').classList.toggle('hidden', view !== 'game');
        const canFullscreen = document.fullscreenEnabled || document.webkitFullscreenEnabled;
        // iPhones can't put an iframe in fullscreen, so only offer the button where it works
        document.getElementById('gameFullscreenBtn').classList.toggle('hidden', view !== 'game' || !canFullscreen);
        const back = document.getElementById('gameBackBtn');
        back.classList.toggle('hidden', view === 'picker');
        back.classList.toggle('flex', view !== 'picker');
        const shopBtn = document.getElementById('gameShopBtn');
        // the shop is opened from the game list (leaving a game first saves its coins)
        shopBtn.classList.toggle('hidden', view !== 'picker');
        shopBtn.classList.toggle('flex', view === 'picker');
    }

    function showGamePicker() {
        currentGame = null;
        // unloading the iframe fully stops the game (no sound or CPU use in the background)
        document.getElementById('gameFrame').src = 'about:blank';
        showGameView('picker');
        setGameHeader(PICKER_HEADER);
        document.querySelectorAll('#gamePicker .game-card').forEach((card, i) => {
            card.style.animationDelay = `${i * 90}ms`;
            replayAnimation(card, 'anim-card-pop');
        });
        document.querySelectorAll('[data-best-for]').forEach((el) => {
            el.textContent = readBest(GAMES[el.dataset.bestFor].bestKey);
        });
    }

    function startGame(id) {
        const game = GAMES[id];
        if (!game) return;
        currentGame = id;
        setGameHeader(game);
        showGameView('game');

        const frame = document.getElementById('gameFrame');
        frame.title = game.title;
        // the skin you wear is passed to the game in its address
        const skin = gameProfile && gameProfile.equipped;
        frame.src = skin ? `${game.url}?skin=${encodeURIComponent(skin)}` : game.url;
        frame.addEventListener('load', () => frame.focus(), { once: true });
        frame.focus();
    }

    function openGameModal() {
        document.getElementById('userDropdown').classList.add('hidden');
        showGamePicker();
        document.getElementById('gameModal').classList.remove('hidden');
        replayAnimation(document.getElementById('gameModalPanel'), 'anim-modal-in');
        loadGameProfile();
    }

    function closeGameModal() {
        document.getElementById('gameModal').classList.add('hidden');
        showGamePicker();
    }

    // --- Games: coin wallet (kept on the server, per user) ---
    let gameProfile = null;

    async function loadGameProfile() {
        try {
            gameProfile = await window.api.getGameProfile();
            renderWallet();
            if (!document.getElementById('gameShop').classList.contains('hidden')) renderShop();
        } catch (err) {
            // the games still work; coins just aren't shown
        }
    }

    // --- small animation helpers ---
    function replayAnimation(el, cls) {
        el.classList.remove(cls);
        void el.offsetWidth; // restart the CSS animation
        el.classList.add(cls);
    }

    let shownCoins = null;
    let countTimer = null;
    function renderWallet() {
        const chip = document.getElementById('gameWalletChip');
        const label = document.getElementById('gameWalletCoins');
        if (!gameProfile) return;
        chip.classList.remove('hidden');
        chip.classList.add('flex');
        const target = gameProfile.coins;
        if (shownCoins === null || shownCoins === target) {
            shownCoins = target;
            label.textContent = target.toLocaleString();
            return;
        }
        // count up / down to the new balance
        const from = shownCoins;
        const start = performance.now();
        const duration = Math.min(1200, 300 + Math.abs(target - from) / 10);
        shownCoins = target;
        replayAnimation(chip, 'anim-wallet-bump');
        cancelAnimationFrame(countTimer);
        const step = (now) => {
            const t = Math.min(1, (now - start) / duration);
            const eased = 1 - Math.pow(1 - t, 3);
            label.textContent = Math.round(from + (target - from) * eased).toLocaleString();
            if (t < 1) countTimer = requestAnimationFrame(step);
        };
        countTimer = requestAnimationFrame(step);
    }

    function confettiBurst(fromEl) {
        const rect = fromEl.getBoundingClientRect();
        const colors = ['#f59e0b', '#ef4444', '#10b981', '#3b82f6', '#a855f7', '#ec4899', '#facc15'];
        for (let i = 0; i < 42; i++) {
            const piece = document.createElement('div');
            piece.className = 'confetti-piece';
            piece.style.left = `${rect.left + rect.width / 2}px`;
            piece.style.top = `${rect.top + rect.height / 2}px`;
            piece.style.background = colors[i % colors.length];
            const angle = Math.random() * Math.PI * 2;
            const dist = 80 + Math.random() * 160;
            piece.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
            piece.style.setProperty('--dy', `${Math.sin(angle) * dist - 60 + Math.random() * 220}px`);
            piece.style.setProperty('--rot', `${Math.random() * 720 - 360}deg`);
            piece.style.setProperty('--dur', `${1 + Math.random() * 0.8}s`);
            document.body.appendChild(piece);
            setTimeout(() => piece.remove(), 2000);
        }
    }

    // Live 3D characters in the shop (three.js, loaded only when the shop opens).
    let previewsPromise = null;
    function loadPreviews() {
        if (!previewsPromise) {
            previewsPromise = import('/games/shared/shop-preview.js').then((m) => m.startSkinPreviews());
            previewsPromise.catch(() => {});
        }
        return previewsPromise;
    }

    // A game in the window tells us when a run starts and ends; the server
    // times the run and decides how many of its coins count.
    let runQueue = Promise.resolve();
    let currentRunId = null;

    function postToGame(msg) {
        const frame = document.getElementById('gameFrame');
        if (frame.contentWindow && currentGame) frame.contentWindow.postMessage(msg, window.location.origin);
    }

    function handleGameMessage(e) {
        if (e.origin !== window.location.origin || !e.data || !currentUser) return;
        const { type, game, coins } = e.data;
        if (type === 'run-start' && GAMES[game]) {
            runQueue = runQueue.then(async () => {
                try {
                    currentRunId = (await window.api.startGameRun(game)).runId;
                } catch (err) {
                    currentRunId = null;
                }
            });
        } else if (type === 'run-end') {
            runQueue = runQueue.then(async () => {
                const runId = currentRunId;
                currentRunId = null;
                if (!runId) return;
                try {
                    const result = await window.api.finishGameRun(runId, coins);
                    if (gameProfile) gameProfile.coins = result.coins;
                    renderWallet();
                    postToGame({ type: 'run-saved', ...result });
                } catch (err) {
                    postToGame({ type: 'run-saved', error: true });
                }
            });
        }
    }

    // --- Games: the shop ---
    const SKIN_STYLES = {
        gold: 'border-amber-300 dark:border-amber-700',
        neon: 'border-cyan-300 dark:border-cyan-700',
        galaxy: 'border-fuchsia-300 dark:border-fuchsia-800',
        admin: 'border-red-300 dark:border-red-800',
    };

    let animateShopCards = false;
    function showShop() {
        if (currentGame) showGamePicker();
        showGameView('shop');
        animateShopCards = true;
        setGameHeader({
            title: 'חנות',
            subtitle: 'קנו סקינים במטבעות שאספתם במשחקים',
            icon: 'fa-store',
            iconClass: 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
        });
        renderShop();
        // a game that was just closed reports its last run a moment later;
        // wait for it to be saved, then show the fresh balance
        setTimeout(() => runQueue.then(loadGameProfile), 300);
    }

    function renderShop() {
        const grid = document.getElementById('shopGrid');
        if (!gameProfile) {
            grid.innerHTML = '<p class="text-sm text-slate-500 dark:text-slate-400">טוען את החנות...</p>';
            return;
        }
        const p = gameProfile;

        grid.innerHTML = '';
        p.shop.forEach((item, index) => {
            const card = document.createElement('div');
            const isSkin = item.type === 'skin';
            const worn = isSkin && p.equipped === item.id;
            const missing = item.price - p.coins;
            card.className = `shop-card rounded-xl overflow-hidden border-2 ${SKIN_STYLES[item.id] || 'border-slate-200'} bg-white dark:bg-slate-900 flex flex-col transition-transform duration-200 hover:-translate-y-1 hover:shadow-lg${worn ? ' anim-worn' : ''}${animateShopCards ? ' anim-card-pop' : ''}`;
            if (animateShopCards) card.style.animationDelay = `${index * 80}ms`;
            card.dataset.item = item.id;

            const picture = isSkin
                ? `<div class="shop-stage shop-stage-${item.id} w-full aspect-[4/3]"><canvas data-preview="${item.id}" aria-label="${escapeHtml(item.name)}"></canvas></div>`
                : `<div class="shop-stage shop-stage-admin w-full aspect-[4/3] flex items-center justify-center text-white"><span class="anim-crown"><i class="fa-solid fa-crown text-5xl drop-shadow"></i></span></div>`;

            let action;
            if (isSkin && item.owned) {
                action = worn
                    ? `<button data-unequip class="w-full bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-bold py-2 rounded-lg transition-colors"><i class="fa-solid fa-check ml-1"></i>בשימוש · הסר</button>`
                    : `<button data-equip="${item.id}" class="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold py-2 rounded-lg transition-colors">השתמש בסקין</button>`;
            } else if (!isSkin && item.owned) {
                action = `<div class="w-full text-center text-sm font-bold text-emerald-600 dark:text-emerald-400 py-2"><i class="fa-solid fa-check ml-1"></i>כבר יש לך הרשאת מנהל</div>`;
            } else if (missing > 0) {
                action = `<button disabled class="w-full bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400 text-sm font-bold py-2 rounded-lg cursor-not-allowed">חסרים ${missing.toLocaleString()} מטבעות</button>`;
            } else {
                action = `<button data-buy="${item.id}" class="w-full bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold py-2 rounded-lg transition-colors">קנה</button>`;
            }

            card.innerHTML = `
                ${picture}
                <div class="p-2.5 sm:p-3 flex flex-col gap-2 flex-1">
                    <div class="flex flex-wrap items-center justify-between gap-x-2">
                        <h4 class="font-bold text-slate-800 dark:text-white">${escapeHtml(item.name)}</h4>
                        <span class="text-sm font-bold text-amber-600 dark:text-amber-400 whitespace-nowrap"><i class="fa-solid fa-coins ml-1"></i>${item.price.toLocaleString()}</span>
                    </div>
                    <ul class="text-xs text-slate-500 dark:text-slate-400 space-y-0.5 flex-1">
                        ${item.effects.map((fx) => `<li><i class="fa-solid fa-star text-[9px] ml-1 text-amber-400"></i>${escapeHtml(fx)}</li>`).join('')}
                    </ul>
                    ${action}
                </div>
            `;
            grid.appendChild(card);
        });

        animateShopCards = false;

        // the characters come alive once three.js is ready; until then (or if
        // WebGL isn't available) a still picture is shown
        const canvases = grid.querySelectorAll('canvas[data-preview]');
        canvases.forEach((canvas) => {
            const img = document.createElement('img');
            img.src = `/games/shared/skin-previews/${canvas.dataset.preview}.jpg`;
            img.alt = '';
            img.className = 'absolute inset-0 w-full h-full object-cover';
            img.dataset.stillFor = canvas.dataset.preview;
            canvas.parentElement.appendChild(img);
        });
        loadPreviews().then((previews) => {
            canvases.forEach((canvas) => {
                previews.attach(canvas.dataset.preview, canvas);
                const still = canvas.parentElement.querySelector('img[data-still-for]');
                if (still) still.remove();
            });
        }).catch(() => {});

        grid.querySelectorAll('[data-buy]').forEach((btn) => btn.addEventListener('click', () => buyItem(btn.dataset.buy)));
        grid.querySelectorAll('[data-equip]').forEach((btn) => btn.addEventListener('click', () => equipSkin(btn.dataset.equip)));
        grid.querySelectorAll('[data-unequip]').forEach((btn) => btn.addEventListener('click', () => equipSkin('')));
    }

    async function buyItem(itemId) {
        if (itemId === 'admin') {
            const item = gameProfile.shop.find((i) => i.id === 'admin');
            document.getElementById('adminBuyModalMessage').textContent =
                `${item.price.toLocaleString()} מטבעות יורדו מהחשבון, ותקבלו הרשאת מנהל אמיתית במערכת הספרייה (ניהול צוות וכיתות). מארק יכול להסיר אותה בכל עת.`;
            document.getElementById('adminBuyModal').classList.remove('hidden');
            return;
        }
        await completePurchase(itemId);
    }

    async function completePurchase(itemId) {
        try {
            const button = document.querySelector(`[data-buy="${itemId}"]`) || document.getElementById('shopGrid');
            const result = await window.api.buyShopItem(itemId);
            confettiBurst(button);
            gameProfile = result.profile;
            renderWallet();
            renderShop();
            const card = document.querySelector(`.shop-card[data-item="${itemId}"]`);
            if (card) replayAnimation(card, 'anim-card-pop');
            loadPreviews().then((previews) => previews.celebrate(itemId)).catch(() => {});
            if (result.roleChanged) {
                showToast('מזל טוב! קיבלת הרשאת מנהל. הדף ייטען מחדש...');
                setTimeout(() => window.location.reload(), 1800);
            } else {
                showToast('הסקין נקנה והוא כבר עליך!');
            }
        } catch (err) {
            showToast(errorMessage(err, 'הקנייה נכשלה'), true);
            loadGameProfile();
        }
    }

    async function equipSkin(skin) {
        try {
            const result = await window.api.equipSkin(skin);
            gameProfile = result.profile;
            renderShop();
            if (skin) loadPreviews().then((previews) => previews.celebrate(skin)).catch(() => {});
            showToast(skin ? 'הסקין עליך - הוא יופיע במשחק הבא' : 'הסקין הוסר');
        } catch (err) {
            showToast(errorMessage(err, 'שגיאה בהחלפת הסקין'), true);
        }
    }

    function restartGame() {
        const frame = document.getElementById('gameFrame');
        if (currentGame && frame.contentWindow) {
            frame.contentWindow.postMessage({ type: 'restart' }, window.location.origin);
            frame.focus();
        }
    }

    function fullscreenGame() {
        const frame = document.getElementById('gameFrame');
        const request = frame.requestFullscreen || frame.webkitRequestFullscreen;
        if (request) {
            Promise.resolve(request.call(frame)).catch(() => {});
        }
        frame.focus();
    }

    // --- Wiring ---
    document.addEventListener('DOMContentLoaded', () => {
        setTheme(getSavedTheme());

        resetLoanDates();

        document.getElementById('loginForm').addEventListener('submit', (e) => {
            e.preventDefault();
            performLogin();
        });
        document.getElementById('markPasswordForm').addEventListener('submit', (e) => {
            e.preventDefault();
            performMarkVerification();
        });
        document.getElementById('cancelMarkVerificationBtn').addEventListener('click', cancelMarkVerification);

        document.getElementById('adminPanelBtn').addEventListener('click', openAdminModal);
        document.getElementById('closeAdminModalBtn').addEventListener('click', closeAdminModal);
        document.getElementById('addUserForm').addEventListener('submit', handleAddUserSubmit);
        document.getElementById('addClassForm').addEventListener('submit', handleAddClassSubmit);
        document.getElementById('confirmClassDeleteBtn').addEventListener('click', confirmClassDelete);
        document.getElementById('closeClassDeleteModalBtn').addEventListener('click', closeClassDeleteModal);

        document.getElementById('confirmUserDeleteBtn').addEventListener('click', confirmUserDelete);
        document.getElementById('closeUserDeleteModalBtn').addEventListener('click', closeUserDeleteModal);

        document.getElementById('confirmResetPasswordBtn').addEventListener('click', confirmResetPassword);
        document.getElementById('closeResetPasswordModalBtn').addEventListener('click', closeResetPasswordModal);

        document.getElementById('addRecordForm').addEventListener('submit', handleAddRecordSubmit);
        document.getElementById('confirmDeleteBtn').addEventListener('click', confirmDelete);
        document.getElementById('closeDeleteModalBtn').addEventListener('click', closeDeleteModal);

        document.getElementById('closeNoteModalBtn').addEventListener('click', closeNoteModal);
        document.getElementById('saveNoteBtn').addEventListener('click', saveNote);

        const searchInput = document.getElementById('searchInput');
        searchInput.addEventListener('input', (e) => {
            searchQuery = e.target.value.trim().toLowerCase();
            renderUI();
        });

        document.getElementById('userMenuToggle').addEventListener('click', () => {
            document.getElementById('userDropdown').classList.toggle('hidden');
        });
        window.addEventListener('click', (e) => {
            const container = document.getElementById('userMenuContainer');
            const dropdown = document.getElementById('userDropdown');
            if (container && !container.contains(e.target) && dropdown) {
                dropdown.classList.add('hidden');
            }
        });

        document.getElementById('setThemeLightBtn').addEventListener('click', () => setTheme('light'));
        document.getElementById('setThemeDarkBtn').addEventListener('click', () => setTheme('dark'));
        document.getElementById('myPasswordBtn').addEventListener('click', openMyPasswordModal);
        document.getElementById('logoutBtn').addEventListener('click', logout);

        document.getElementById('openGameBtn').addEventListener('click', openGameModal);
        document.getElementById('closeGameModalBtn').addEventListener('click', closeGameModal);
        document.getElementById('closeGameModalBtn2').addEventListener('click', closeGameModal);
        document.getElementById('gameRestartBtn').addEventListener('click', restartGame);
        document.getElementById('gameFullscreenBtn').addEventListener('click', fullscreenGame);
        document.getElementById('gameBackBtn').addEventListener('click', showGamePicker);
        document.getElementById('gameShopBtn').addEventListener('click', showShop);
        document.getElementById('confirmAdminBuyBtn').addEventListener('click', () => {
            document.getElementById('adminBuyModal').classList.add('hidden');
            completePurchase('admin');
        });
        document.getElementById('closeAdminBuyModalBtn').addEventListener('click', () => {
            document.getElementById('adminBuyModal').classList.add('hidden');
        });
        window.addEventListener('message', handleGameMessage);
        document.querySelectorAll('[data-game]').forEach((card) => {
            card.addEventListener('click', () => startGame(card.dataset.game));
        });

        checkSession();
    });
})();
