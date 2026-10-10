const loginSection = document.getElementById("loginSection");
const dashboardSection = document.getElementById("dashboardSection");

const loginForm = document.getElementById("loginForm");
const loginMessage = document.getElementById("loginMessage");

const uploadForm = document.getElementById("uploadForm");
const uploadMessage = document.getElementById("uploadMessage");

const logoutButton = document.getElementById("logoutButton");

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
}

function showDashboard() {
    loginSection.hidden = true;
    dashboardSection.hidden = false;
}

async function refreshDashboard() {
    const stats = await apiRequest("/api/admin/overview");

    document.getElementById("eligibleCount").textContent =
        stats.eligibleStudents;

    document.getElementById("registrationCount").textContent =
        stats.totalRegistrations;

    document.getElementById("paidCount").textContent =
        stats.successfulPayments;

    document.getElementById("pendingCount").textContent =
        stats.pendingPayments;

    await loadRegistrations();
}

// ========================================
// STUDENT REGISTRATION TABLE
// ========================================

const studentSearch = document.getElementById("studentSearch");
const studentTableBody = document.getElementById("studentTableBody");
const studentMessage = document.getElementById("studentMessage");

function createCell(value) {
    const cell = document.createElement("td");

    // Use textContent to avoid treating database values as HTML.
    cell.textContent = value == null || value === ""
        ? "—"
        : String(value);

    return cell;
}

async function loadRegistrations(search = "") {
    studentTableBody.replaceChildren();

    const loadingRow = document.createElement("tr");
    const loadingCell = createCell("Loading registrations...");
    loadingCell.colSpan = 6;
    loadingRow.appendChild(loadingCell);
    studentTableBody.appendChild(loadingRow);

    try {
        const url = new URL(
            "/api/admin/registrations",
            window.location.origin
        );

        url.searchParams.set("search", search);

        const result = await apiRequest(
            url.pathname + url.search
        );

        studentTableBody.replaceChildren();

        if (result.students.length === 0) {
            const row = document.createElement("tr");
            const cell = createCell("No registrations found.");
            cell.colSpan = 6;
            row.appendChild(cell);
            studentTableBody.appendChild(row);
            return;
        }

        for (const student of result.students) {
            const row = document.createElement("tr");

            row.appendChild(createCell(student.name));
            row.appendChild(createCell(student.college_id));
            row.appendChild(createCell(student.registration_id));
            row.appendChild(createCell(student.payment_status));
            row.appendChild(createCell(student.razorpay_payment_id));

            row.appendChild(
                createCell(student.created_at)
            );

            studentTableBody.appendChild(row);
        }

        studentMessage.textContent =
            `Showing ${result.total} registration(s).`;

    } catch (error) {
        studentTableBody.replaceChildren();

        const row = document.createElement("tr");
        const cell = createCell(error.message);
        cell.colSpan = 6;
        row.appendChild(cell);
        studentTableBody.appendChild(row);
    }
}

// Search after a short pause while typing.
let searchTimer;

studentSearch.addEventListener("input", () => {
    clearTimeout(searchTimer);

    searchTimer = setTimeout(() => {
        loadRegistrations(studentSearch.value.trim());
    }, 300);
});

loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    loginMessage.textContent = "Signing in...";

    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;

    try {
        await apiRequest("/api/admin/login", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ username, password })
        });

        loginForm.reset();
        showDashboard();

        await refreshDashboard();

    } catch (error) {
        loginMessage.textContent = error.message;
    }
});

uploadForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const fileInput = document.getElementById("studentFile");

    if (!fileInput.files.length) {
        uploadMessage.textContent = "Please select a file.";
        return;
    }

    const button = uploadForm.querySelector("button");
    button.disabled = true;
    uploadMessage.textContent = "Uploading student list...";

    try {
        const formData = new FormData();
        formData.append("studentFile", fileInput.files[0]);

        const result = await apiRequest("/api/admin/upload-students", {
            method: "POST",
            body: formData
        });

        uploadMessage.textContent =
            `${result.message} ` +
            `Valid IDs: ${result.validIdsInFile}. ` +
            `Newly added: ${result.newlyAdded}. ` +
            `Already existed: ${result.alreadyExisted}.`;

        uploadForm.reset();
        await refreshDashboard();

    } catch (error) {
        uploadMessage.textContent = error.message;
    } finally {
        button.disabled = false;
    }
});

logoutButton.addEventListener("click", async () => {
    try {
        await apiRequest("/api/admin/logout", {
            method: "POST"
        });

        showLogin();

    } catch (error) {
        alert(error.message);
    }
});

async function initializeDashboard() {
    try {
        await apiRequest("/api/admin/me");
        showDashboard();
        await refreshDashboard();
    } catch {
        showLogin();
    }
}

initializeDashboard();