// State
let adminEvents = [];

// DOM References
const loginSection = document.getElementById("loginSection");
const dashboardSection = document.getElementById("dashboardSection");
const headerActions = document.getElementById("headerActions");

const loginForm = document.getElementById("loginForm");
const loginMessage = document.getElementById("loginMessage");
const logoutButton = document.getElementById("logoutButton");

const eventsTableBody = document.getElementById("eventsTableBody");
const uploadStudentsForm = document.getElementById("uploadStudentsForm");
const uploadEventSelect = document.getElementById("uploadEventSelect");
const uploadMessage = document.getElementById("uploadMessage");

const gateVerifyForm = document.getElementById("gateVerifyForm");
const gateEventSelect = document.getElementById("gateEventSelect");
const gateInput = document.getElementById("gateInput");
const gateResult = document.getElementById("gateResult");
const gateStatusBadge = document.getElementById("gateStatusBadge");
const gateResultTitle = document.getElementById("gateResultTitle");
const gateResultDesc = document.getElementById("gateResultDesc");
const gateStudentDetails = document.getElementById("gateStudentDetails");

const filterEventSelect = document.getElementById("filterEventSelect");
const studentSearch = document.getElementById("studentSearch");
const registrationsTableBody = document.getElementById("registrationsTableBody");
const registrationsCountMessage = document.getElementById("registrationsCountMessage");

// Event Modal DOM
const eventModal = document.getElementById("eventModal");
const eventForm = document.getElementById("eventForm");
const eventModalTitle = document.getElementById("eventModalTitle");
const modalEventId = document.getElementById("modalEventId");
const eventModalMessage = document.getElementById("eventModalMessage");

// API Request Helper
async function apiRequest(url, options = {}) {
    const response = await fetch(url, {
        credentials: "same-origin",
        ...options
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.message || data.error || "Request failed.");
    }

    return data;
}

function showLogin() {
    loginSection.hidden = false;
    dashboardSection.hidden = true;
    headerActions.hidden = true;
}

function showDashboard() {
    loginSection.hidden = true;
    dashboardSection.hidden = false;
    headerActions.hidden = false;
}

// ========================================
// REFRESH & LOAD DATA
// ========================================

async function refreshDashboard() {
    try {
        const stats = await apiRequest("/api/admin/overview");

        document.getElementById("statTotalEvents").textContent = stats.totalEvents || 0;
        document.getElementById("statTotalRegistrations").textContent = stats.totalRegistrations || 0;
        document.getElementById("statConfirmedPayments").textContent = stats.successfulPayments || 0;
        document.getElementById("statTotalRevenue").textContent = `₹${stats.totalRevenueRupees || '0.00'}`;
        document.getElementById("statGateCheckedIn").textContent = stats.checkedInCount || 0;

        await loadEvents();
        await loadRegistrations();

    } catch (err) {
        console.error("Dashboard refresh error:", err);
    }
}

// Load and populate events
async function loadEvents() {
    try {
        const res = await apiRequest("/api/admin/events");
        adminEvents = res.events || [];

        renderEventsTable();
        populateEventDropdowns();

    } catch (err) {
        console.error("Load events error:", err);
    }
}

function renderEventsTable() {
    if (!adminEvents.length) {
        eventsTableBody.innerHTML = `
            <tr><td colspan="8" class="text-center">No events posted yet. Click "+ Post New Event" to add one.</td></tr>
        `;
        return;
    }

    eventsTableBody.innerHTML = adminEvents.map(ev => {
        const feeText = ev.fee_paise === 0 ? 'Free Entry' : `₹${ev.fee_rupees}.00`;
        const eligPill = ev.restrict_eligibility === 1
            ? `<span style="color:#fcd34d">Restricted (${ev.eligible_students_count || 0} students)</span>`
            : `<span style="color:#6ee7b7">Open to All</span>`;

        return `
            <tr>
                <td><strong>${escapeHtml(ev.title)}</strong></td>
                <td><span class="badge-pill" style="background:#312e81; color:#c7d2fe;">${escapeHtml(ev.category)}</span></td>
                <td>${escapeHtml(ev.date)}<br><small style="color:#94a3b8">${escapeHtml(ev.venue)}</small></td>
                <td><strong>${feeText}</strong></td>
                <td><span class="badge-pill ${ev.status}">${escapeHtml(ev.status.toUpperCase())}</span></td>
                <td>${eligPill}</td>
                <td><strong>${ev.paid_registrations || 0}</strong> paid / ${ev.total_registrations || 0} total</td>
                <td>
                    <button class="btn-action" onclick="openEditEventModal(${ev.id})">✏️ Edit</button>
                    <button class="btn-action" onclick="selectEventForUpload(${ev.id})">👥 List</button>
                    <button class="btn-action delete" onclick="deleteEvent(${ev.id})">🗑️</button>
                </td>
            </tr>
        `;
    }).join("");
}

function populateEventDropdowns() {
    // 1. Upload Event Select
    const currentUploadVal = uploadEventSelect.value;
    uploadEventSelect.innerHTML = adminEvents.map(ev => `
        <option value="${ev.id}">${escapeHtml(ev.title)} (${ev.restrict_eligibility === 1 ? 'Restricted' : 'Open'})</option>
    `).join("");
    if (currentUploadVal) uploadEventSelect.value = currentUploadVal;

    // 2. Filter Registrations Event Select
    const currentFilterVal = filterEventSelect.value;
    filterEventSelect.innerHTML = `
        <option value="">All Events</option>
        ${adminEvents.map(ev => `<option value="${ev.id}">${escapeHtml(ev.title)}</option>`).join("")}
    `;
    if (currentFilterVal) filterEventSelect.value = currentFilterVal;

    // 3. Gate Event Select
    const currentGateVal = gateEventSelect.value;
    gateEventSelect.innerHTML = `
        <option value="">All Events (Auto-Detect)</option>
        ${adminEvents.map(ev => `<option value="${ev.id}">${escapeHtml(ev.title)}</option>`).join("")}
    `;
    if (currentGateVal) gateEventSelect.value = currentGateVal;
}

function selectEventForUpload(eventId) {
    uploadEventSelect.value = eventId;
    document.getElementById("studentFile").scrollIntoView({ behavior: "smooth" });
}

// ========================================
// CREATE / EDIT EVENT MODAL
// ========================================

function openCreateEventModal() {
    eventForm.reset();
    modalEventId.value = "";
    eventModalTitle.textContent = "Post New Event";
    document.getElementById("modalEventCategory").value = "Technical";
    document.getElementById("modalEventFee").value = "0";
    document.getElementById("modalEventStatus").value = "active";
    document.getElementById("modalEventEligibility").value = "1";
    eventModalMessage.classList.add("hidden");

    eventModal.classList.remove("hidden");
}

function openEditEventModal(eventId) {
    const ev = adminEvents.find(e => e.id === eventId);
    if (!ev) return;

    modalEventId.value = ev.id;
    eventModalTitle.textContent = `Edit Event: ${ev.title}`;
    document.getElementById("modalEventTitle").value = ev.title;
    document.getElementById("modalEventTagline").value = ev.tagline || "";
    document.getElementById("modalEventCategory").value = ev.category || "Technical";
    document.getElementById("modalEventFee").value = ev.fee_rupees || "0";
    document.getElementById("modalEventDate").value = ev.date;
    document.getElementById("modalEventTime").value = ev.time || "";
    document.getElementById("modalEventVenue").value = ev.venue;
    document.getElementById("modalEventStatus").value = ev.status;
    document.getElementById("modalEventEligibility").value = ev.restrict_eligibility ? "1" : "0";
    document.getElementById("modalEventDesc").value = ev.description;
    document.getElementById("modalEventRules").value = ev.rules || "";

    eventModalMessage.classList.add("hidden");
    eventModal.classList.remove("hidden");
}

function closeEventModal() {
    eventModal.classList.add("hidden");
}

eventForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const saveBtn = document.getElementById("saveEventBtn");
    saveBtn.disabled = true;
    eventModalMessage.textContent = "Saving event details...";
    eventModalMessage.className = "message info";
    eventModalMessage.classList.remove("hidden");

    const id = modalEventId.value;
    const payload = {
        title: document.getElementById("modalEventTitle").value.trim(),
        tagline: document.getElementById("modalEventTagline").value.trim(),
        category: document.getElementById("modalEventCategory").value,
        feeInRupees: document.getElementById("modalEventFee").value,
        date: document.getElementById("modalEventDate").value.trim(),
        time: document.getElementById("modalEventTime").value.trim(),
        venue: document.getElementById("modalEventVenue").value.trim(),
        status: document.getElementById("modalEventStatus").value,
        restrictEligibility: document.getElementById("modalEventEligibility").value === "1",
        description: document.getElementById("modalEventDesc").value.trim(),
        rules: document.getElementById("modalEventRules").value.trim()
    };

    try {
        if (id) {
            await apiRequest(`/api/admin/events/${id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
        } else {
            await apiRequest("/api/admin/events", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
        }

        closeEventModal();
        await refreshDashboard();

    } catch (err) {
        eventModalMessage.textContent = err.message;
        eventModalMessage.className = "message error";
    } finally {
        saveBtn.disabled = false;
    }
});

async function deleteEvent(eventId) {
    const ev = adminEvents.find(e => e.id === eventId);
    if (!confirm(`Are you sure you want to delete "${ev?.title || 'this event'}"?`)) return;

    try {
        await apiRequest(`/api/admin/events/${eventId}`, { method: "DELETE" });
        await refreshDashboard();
    } catch (err) {
        alert(err.message);
    }
}

// ========================================
// UPLOAD ELIGIBLE STUDENTS PER EVENT
// ========================================

uploadStudentsForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const fileInput = document.getElementById("studentFile");
    const eventId = uploadEventSelect.value;

    if (!fileInput.files.length) {
        uploadMessage.textContent = "Please select a file.";
        uploadMessage.className = "message error";
        uploadMessage.classList.remove("hidden");
        return;
    }

    const uploadBtn = document.getElementById("uploadBtn");
    uploadBtn.disabled = true;
    uploadMessage.textContent = "Processing and importing student list...";
    uploadMessage.className = "message info";
    uploadMessage.classList.remove("hidden");

    try {
        const formData = new FormData();
        formData.append("eventId", eventId);
        formData.append("studentFile", fileInput.files[0]);

        const result = await apiRequest("/api/admin/upload-students", {
            method: "POST",
            body: formData
        });

        uploadMessage.textContent = `${result.message} Valid IDs: ${result.validIdsInFile}. Newly added: ${result.newlyAdded}. Already existed: ${result.alreadyExisted}.`;
        uploadMessage.className = "message success";

        uploadStudentsForm.reset();
        await refreshDashboard();

    } catch (err) {
        uploadMessage.textContent = err.message;
        uploadMessage.className = "message error";
    } finally {
        uploadBtn.disabled = false;
    }
});

// ========================================
// GATE SCANNER & VERIFICATION
// ========================================

gateVerifyForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const code = gateInput.value.trim();
    const eventId = gateEventSelect.value;
    if (!code) return;

    const gateVerifyBtn = document.getElementById("gateVerifyBtn");
    gateVerifyBtn.disabled = true;

    try {
        const res = await apiRequest("/api/admin/verify-entry", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code, eventId })
        });

        gateResult.className = "gate-result approved";
        gateResult.classList.remove("hidden");
        gateStatusBadge.textContent = "ENTRY APPROVED";
        gateResultTitle.textContent = res.message;
        gateResultDesc.textContent = `Student ${res.student.name} is admitted for ${res.student.eventTitle}.`;

        gateStudentDetails.innerHTML = `
            <div><strong>Student:</strong> ${escapeHtml(res.student.name)}</div>
            <div><strong>College ID:</strong> ${escapeHtml(res.student.collegeId)}</div>
            <div><strong>Event:</strong> ${escapeHtml(res.student.eventTitle)}</div>
            <div><strong>Dept / Year:</strong> ${escapeHtml(res.student.department)} (${escapeHtml(res.student.academicYear)})</div>
            <div><strong>Pass ID:</strong> ${escapeHtml(res.student.registrationId)}</div>
            <div><strong>Admitted Time:</strong> ${escapeHtml(res.student.checkedInAt)}</div>
        `;

        gateInput.value = "";
        gateInput.focus();
        await refreshDashboard();

    } catch (err) {
        gateResult.classList.remove("hidden");

        if (err.message.includes("ALREADY CHECKED IN")) {
            gateResult.className = "gate-result warning";
            gateStatusBadge.textContent = "ALREADY ADMITTED";
            gateResultTitle.textContent = "DUPLICATE ENTRY DETECTED";
            gateResultDesc.textContent = err.message;
        } else {
            gateResult.className = "gate-result rejected";
            gateStatusBadge.textContent = "ENTRY DENIED";
            gateResultTitle.textContent = "INVALID OR UNPAID PASS";
            gateResultDesc.textContent = err.message;
        }

        gateStudentDetails.innerHTML = "";
    } finally {
        gateVerifyBtn.disabled = false;
    }
});

// ========================================
// REGISTRATIONS TABLE & SEARCH
// ========================================

async function loadRegistrations() {
    const eventId = filterEventSelect.value;
    const search = studentSearch.value.trim();

    try {
        const url = new URL("/api/admin/registrations", window.location.origin);
        if (eventId) url.searchParams.set("eventId", eventId);
        if (search) url.searchParams.set("search", search);

        const result = await apiRequest(url.pathname + url.search);

        if (!result.students || result.students.length === 0) {
            registrationsTableBody.innerHTML = `
                <tr><td colspan="9" class="text-center">No matching registrations found.</td></tr>
            `;
            registrationsCountMessage.textContent = "Showing 0 registrations.";
            return;
        }

        registrationsTableBody.innerHTML = result.students.map(s => {
            const isPaid = s.payment_status === "paid";
            const isCheckedIn = s.checked_in === 1;

            const paymentBadge = `<span class="badge-pill ${isPaid ? 'active' : 'upcoming'}">${escapeHtml(s.payment_status.toUpperCase())}</span>`;
            const gateBadge = `<span class="badge-pill" style="background:${isCheckedIn ? '#0284c7' : '#334155'}; color:white;">${isCheckedIn ? `In (${s.checked_in_at || ''})` : 'Not Arrived'}</span>`;

            let actionHtml = "—";
            if (isCheckedIn) {
                actionHtml = `<button class="btn-action" onclick="resetCheckIn(${s.id})">Reset</button>`;
            } else if (isPaid) {
                actionHtml = `<button class="btn-action" onclick="quickAdmit('${s.registration_id}', ${s.event_id})">Admit</button>`;
            }

            return `
                <tr>
                    <td><strong>${escapeHtml(s.name)}</strong></td>
                    <td>${escapeHtml(s.college_id)}</td>
                    <td><strong>${escapeHtml(s.event_title || 'General Event')}</strong></td>
                    <td>${escapeHtml(s.department)} (${escapeHtml(s.academic_year)})</td>
                    <td>${escapeHtml(s.mobile)}</td>
                    <td><code>${escapeHtml(s.registration_id || '—')}</code></td>
                    <td>${paymentBadge}</td>
                    <td>${gateBadge}</td>
                    <td>${actionHtml}</td>
                </tr>
            `;
        }).join("");

        registrationsCountMessage.textContent = `Showing ${result.students.length} registration(s).`;

    } catch (err) {
        registrationsTableBody.innerHTML = `
            <tr><td colspan="9" class="text-center" style="color:#f87171">${escapeHtml(err.message)}</td></tr>
        `;
    }
}

window.quickAdmit = async function (regId, eventId) {
    gateInput.value = regId;
    if (eventId) gateEventSelect.value = eventId;
    gateVerifyForm.dispatchEvent(new Event("submit"));
};

window.resetCheckIn = async function (id) {
    if (!confirm("Are you sure you want to reset this student's admission status?")) return;

    try {
        await apiRequest("/api/admin/reset-checkin", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id })
        });
        await refreshDashboard();
    } catch (err) {
        alert(err.message);
    }
};

function exportRegistrationsExcel() {
    const eventId = filterEventSelect.value;
    const url = eventId
        ? `/api/admin/export-registrations?eventId=${eventId}`
        : "/api/admin/export-registrations";
    window.location.href = url;
}

// Search typing debounce
let searchTimer;
studentSearch.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadRegistrations, 300);
});

// ========================================
// AUTHENTICATION
// ========================================

loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    loginMessage.textContent = "Signing in...";
    loginMessage.className = "message info";
    loginMessage.classList.remove("hidden");

    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;

    try {
        await apiRequest("/api/admin/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password })
        });

        loginForm.reset();
        loginMessage.classList.add("hidden");
        showDashboard();
        await refreshDashboard();

    } catch (err) {
        loginMessage.textContent = err.message;
        loginMessage.className = "message error";
    }
});

logoutButton.addEventListener("click", async () => {
    try {
        await apiRequest("/api/admin/logout", { method: "POST" });
        showLogin();
    } catch (err) {
        alert(err.message);
    }
});

// Initialize session
async function initializeDashboard() {
    try {
        await apiRequest("/api/admin/me");
        showDashboard();
        await refreshDashboard();
    } catch {
        showLogin();
    }
}

function escapeHtml(str) {
    if (str == null) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

initializeDashboard();
