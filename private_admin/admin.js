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
const btnToggleCamera = document.getElementById("btnToggleCamera");
const btnCloseCamera = document.getElementById("btnCloseCamera");
const btnSwitchCamera = document.getElementById("btnSwitchCamera");
const qrCameraContainer = document.getElementById("qrCameraContainer");
const cameraStatusText = document.getElementById("cameraStatusText");
const cameraDeviceSelect = document.getElementById("cameraDeviceSelect");
const gateAutoAdmitCheck = document.getElementById("gateAutoAdmitCheck");
const gateBeepSoundCheck = document.getElementById("gateBeepSoundCheck");
const btnClearGateInput = document.getElementById("btnClearGateInput");
const gatePreviewBtn = document.getElementById("gatePreviewBtn");
const gateResultBanner = document.getElementById("gateResultBanner");
const gateResultQuickAction = document.getElementById("gateResultQuickAction");

const filterEventSelect = document.getElementById("filterEventSelect");
const studentSearch = document.getElementById("studentSearch");
const registrationsTableBody = document.getElementById("registrationsTableBody");
const registrationsCountMessage = document.getElementById("registrationsCountMessage");

// Payment Ledger DOM
const paymentEventSelect = document.getElementById("paymentEventSelect");
const paymentStatusSelect = document.getElementById("paymentStatusSelect");
const paymentSearchInput = document.getElementById("paymentSearchInput");
const paymentsTableBody = document.getElementById("paymentsTableBody");
const paymentBreakdownGrid = document.getElementById("paymentBreakdownGrid");
const paySummaryTotal = document.getElementById("paySummaryTotal");
const paySummaryPaid = document.getElementById("paySummaryPaid");
const paySummaryPending = document.getElementById("paySummaryPending");
const paySummaryRevenue = document.getElementById("paySummaryRevenue");
const paymentsCountMessage = document.getElementById("paymentsCountMessage");

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
        if (response.status === 401 && !url.includes("/api/admin/login")) {
            showLogin();
            if (loginMessage) {
                loginMessage.textContent = "Admin session expired. Please sign in again.";
                loginMessage.className = "message error";
                loginMessage.classList.remove("hidden");
            }
        }
        const error = new Error(data.message || data.error || "Request failed.");
        error.data = data;
        error.status = response.status;
        throw error;
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
        await loadPayments();
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
            ? `<span style="color:#ef4444; font-weight:700;">Restricted (${ev.eligible_students_count || 0})</span>`
            : `<span style="color:#60a5fa; font-weight:600;">Open to All</span>`;

        return `
            <tr>
                <td><strong>${escapeHtml(ev.title)}</strong></td>
                <td><span class="badge-pill" style="background:#000000; color:#ffffff; border:1px solid #2563eb;">${escapeHtml(ev.category)}</span></td>
                <td>${escapeHtml(ev.date)}<br><small style="color:#a3a3a3">${escapeHtml(ev.venue)}</small></td>
                <td><strong>${feeText}</strong></td>
                <td><span class="badge-pill ${ev.status}">${escapeHtml(ev.status.toUpperCase())}</span></td>
                <td>${eligPill}</td>
                <td><strong>${ev.paid_registrations || 0}</strong> paid / ${ev.total_registrations || 0} total</td>
                <td>
                    <button class="btn-action" onclick="openEditEventModal(${ev.id})">Edit</button>
                    <button class="btn-action" onclick="selectEventForUpload(${ev.id})">Roster</button>
                    <button class="btn-action delete" onclick="deleteEvent(${ev.id})">Delete</button>
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

    // 4. Payment Event Filter Select
    if (paymentEventSelect) {
        const currentPayVal = paymentEventSelect.value;
        paymentEventSelect.innerHTML = `
            <option value="">All Events</option>
            ${adminEvents.map(ev => `<option value="${ev.id}">${escapeHtml(ev.title)}</option>`).join("")}
        `;
        if (currentPayVal) paymentEventSelect.value = currentPayVal;
    }
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

// ========================================
// GATE CHECK-IN & QR CAMERA SCANNER LOGIC
// ========================================

let html5QrScanner = null;
let isScanningActive = false;
let isScanProcessing = false;
let isGateVerifying = false;
let availableCameraDevices = [];
let selectedCameraDeviceId = null;
let currentFacingMode = "environment";
let activeCameraIndex = 0;
let lastAdmittedInfo = {
    code: null,
    studentId: null,
    timestamp: 0
};
let audioCtx = null;

// Sound Effects via Web Audio API (No external sound files required)
function playScanSound(type = 'success') {
    if (!gateBeepSoundCheck || !gateBeepSoundCheck.checked) return;
    try {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }

        const now = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);

        if (type === 'success') {
            // High cheerful double chime (Admitted / Valid)
            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, now);
            osc.frequency.setValueAtTime(1320, now + 0.08);
            gain.gain.setValueAtTime(0.2, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
            osc.start(now);
            osc.stop(now + 0.25);
        } else if (type === 'warning') {
            // Dual warning buzz for Reused Pass
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(260, now);
            osc.frequency.setValueAtTime(190, now + 0.12);
            gain.gain.setValueAtTime(0.25, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
            osc.start(now);
            osc.stop(now + 0.35);
        } else {
            // Low error buzz for Unpaid or Not Found
            osc.type = 'square';
            osc.frequency.setValueAtTime(160, now);
            gain.gain.setValueAtTime(0.2, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
            osc.start(now);
            osc.stop(now + 0.3);
        }
    } catch (e) {
        console.warn("Audio feedback notification:", e);
    }
}

// Open and start Camera QR Scanner
async function startQrCamera() {
    if (typeof Html5Qrcode === "undefined") {
        alert("Camera scanner library is loading. Please verify public/html5-qrcode.min.js or reload.");
        return;
    }

    try {
        if (qrCameraContainer) qrCameraContainer.classList.remove("hidden");
        if (btnToggleCamera) btnToggleCamera.classList.add("hidden");
        if (cameraStatusText) cameraStatusText.textContent = "Requesting back camera access...";

        if (!html5QrScanner) {
            html5QrScanner = new Html5Qrcode("qrReader");
        }

        availableCameraDevices = await Html5Qrcode.getCameras().catch(() => []);
        if (!availableCameraDevices || availableCameraDevices.length === 0) {
            if (cameraStatusText) cameraStatusText.textContent = "No camera devices detected.";
            alert("No camera device was detected on your computer or smartphone. You can manually enter or paste the Pass ID / QR code into the input field below.");
            return;
        }

        // Detect Back/Rear camera explicitly
        let backCameraIndex = availableCameraDevices.findIndex(d => {
            const lbl = (d.label || "").toLowerCase();
            return (
                lbl.includes("back") ||
                lbl.includes("rear") ||
                lbl.includes("environment") ||
                lbl.includes("main") ||
                lbl.includes("wide")
            );
        });

        if (backCameraIndex === -1 && availableCameraDevices.length > 1) {
            // If one camera says 'front' or 'user', choose the other camera
            const nonFrontIndex = availableCameraDevices.findIndex(d => {
                const lbl = (d.label || "").toLowerCase();
                return !lbl.includes("front") && !lbl.includes("selfie") && !lbl.includes("user");
            });
            if (nonFrontIndex !== -1) backCameraIndex = nonFrontIndex;
        }

        // Camera select dropdown if multiple cameras exist
        if (availableCameraDevices.length > 1 && cameraDeviceSelect) {
            cameraDeviceSelect.innerHTML = availableCameraDevices.map((d, idx) => {
                const isSelected = selectedCameraDeviceId ? d.id === selectedCameraDeviceId : idx === (backCameraIndex !== -1 ? backCameraIndex : 0);
                const label = d.label ? d.label : (idx === backCameraIndex ? 'Rear / Back Camera' : 'Camera ' + (idx + 1));
                return `<option value="${d.id}" ${isSelected ? 'selected' : ''}>${escapeHtml(label)}</option>`;
            }).join("");
            cameraDeviceSelect.classList.remove("hidden");

            if (!selectedCameraDeviceId && backCameraIndex !== -1) {
                cameraDeviceSelect.value = availableCameraDevices[backCameraIndex].id;
                selectedCameraDeviceId = availableCameraDevices[backCameraIndex].id;
                activeCameraIndex = backCameraIndex;
            }

            cameraDeviceSelect.onchange = () => {
                selectedCameraDeviceId = cameraDeviceSelect.value;
                activeCameraIndex = availableCameraDevices.findIndex(d => d.id === selectedCameraDeviceId);
                stopQrCamera().then(() => startQrCamera());
            };
        }

        // Camera configuration prioritization:
        // 1. User selected device
        // 2. Detected back camera device ID
        // 3. FacingMode: environment (HTML5 standard rear camera constraint)
        let activeCameraConfig;
        if (selectedCameraDeviceId) {
            activeCameraConfig = selectedCameraDeviceId;
        } else if (backCameraIndex !== -1) {
            activeCameraConfig = availableCameraDevices[backCameraIndex].id;
            selectedCameraDeviceId = activeCameraConfig;
            activeCameraIndex = backCameraIndex;
        } else {
            activeCameraConfig = { facingMode: currentFacingMode || "environment" };
        }

        const qrCodeSuccessCallback = async (decodedText) => {
            if (isScanProcessing) return;

            // If this exact pass was admitted within the last 15 seconds, ignore continuous camera frames
            if (
                lastAdmittedInfo.code === decodedText &&
                (Date.now() - lastAdmittedInfo.timestamp) < 15000
            ) {
                if (cameraStatusText) {
                    cameraStatusText.textContent = "Pass already admitted just now. Point at next attendee.";
                }
                return;
            }

            isScanProcessing = true;

            gateInput.value = decodedText;
            if (btnClearGateInput) btnClearGateInput.classList.remove("hidden");

            const autoAdmit = gateAutoAdmitCheck ? gateAutoAdmitCheck.checked : true;
            if (cameraStatusText) cameraStatusText.textContent = `Scanned QR! Verifying pass details...`;

            await verifyPass(decodedText, { preview: !autoAdmit });

            // Cooldown so camera doesn't continuously trigger 10 times per second on the same frame
            setTimeout(() => {
                isScanProcessing = false;
                if (isScanningActive && cameraStatusText) {
                    cameraStatusText.textContent = "Camera Active: Ready for next QR code pass.";
                }
            }, 2500);
        };

        const config = {
            fps: 15,
            qrbox: (viewfinderWidth, viewfinderHeight) => {
                const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
                return {
                    width: Math.floor(minEdge * 0.72),
                    height: Math.floor(minEdge * 0.72)
                };
            },
            aspectRatio: 1.0
        };

        try {
            await html5QrScanner.start(
                activeCameraConfig,
                config,
                qrCodeSuccessCallback,
                () => {} // Frame without QR
            );
        } catch (camErr) {
            console.warn("Back camera direct initialization failed, trying facingMode environment fallback:", camErr);
            try {
                await html5QrScanner.start(
                    { facingMode: "environment" },
                    config,
                    qrCodeSuccessCallback,
                    () => {}
                );
            } catch (fallbackErr) {
                console.warn("Fallback to first available device:", fallbackErr);
                if (availableCameraDevices.length > 0) {
                    await html5QrScanner.start(
                        availableCameraDevices[0].id,
                        config,
                        qrCodeSuccessCallback,
                        () => {}
                    );
                } else {
                    throw fallbackErr;
                }
            }
        }

        isScanningActive = true;
        if (cameraStatusText) cameraStatusText.textContent = "Camera Active: Point rear camera at attendee QR pass";

    } catch (err) {
        console.error("Camera startup error:", err);
        if (cameraStatusText) cameraStatusText.textContent = `Camera Error: ${err.message || 'Permission denied'}`;
        alert(`Could not access camera: ${err.message || 'Permission denied'}. Please check camera permissions in your mobile browser settings.`);
        stopQrCamera();
    }
}

// Stop and close Camera QR Scanner
async function stopQrCamera() {
    if (html5QrScanner && isScanningActive) {
        try {
            await html5QrScanner.stop();
        } catch (e) {
            console.warn("Camera stop error:", e);
        }
    }
    isScanningActive = false;
    if (qrCameraContainer) qrCameraContainer.classList.add("hidden");
    if (btnToggleCamera) btnToggleCamera.classList.remove("hidden");
}

// Core Pass Verification & Duplicate Prevention Handler
async function verifyPass(code, { preview = false } = {}) {
    if (!code || !code.trim()) {
        alert("Please enter or scan a pass identifier.");
        return;
    }

    if (isGateVerifying) return;
    isGateVerifying = true;

    if (gateVerifyBtn) gateVerifyBtn.disabled = true;
    if (gatePreviewBtn) gatePreviewBtn.disabled = true;

    code = code.trim();
    const eventId = gateEventSelect ? gateEventSelect.value : "";

    if (gateResult) {
        gateResult.classList.remove("hidden");
        gateResult.className = "gate-result";
    }
    if (gateStatusBadge) {
        gateStatusBadge.className = "gate-badge";
        gateStatusBadge.textContent = "VERIFYING PASS...";
    }
    if (gateResultTitle) gateResultTitle.textContent = "Authenticating Registration & Payment...";
    if (gateResultDesc) gateResultDesc.textContent = "Querying student record, fee status, and gate attendance...";
    if (gateResultQuickAction) gateResultQuickAction.innerHTML = "";
    if (gateStudentDetails) gateStudentDetails.innerHTML = "";

    try {
        const response = await fetch("/api/admin/verify-entry", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({
                code,
                eventId: eventId ? parseInt(eventId, 10) : undefined,
                preview: Boolean(preview)
            })
        });

        const data = await response.json().catch(() => ({}));

        if (response.ok && data.success) {
            // Record last admitted info
            if (!data.isPreview && data.student) {
                lastAdmittedInfo = {
                    code,
                    studentId: data.student.id,
                    timestamp: Date.now()
                };
            }

            // SUCCESSFUL PASS
            renderGateResult({
                statusType: data.isPreview ? 'preview' : 'valid',
                messageTitle: data.isPreview ? 'PASS VALID & ELIGIBLE (PREVIEW)' : 'PASS VALID & ENTRY APPROVED',
                messageDesc: data.message,
                student: data.student,
                code
            });
            playScanSound('success');
            await refreshDashboard();
        } else {
            // HANDLE ERROR OR REUSE
            if (response.status === 409 || data.isReused || data.alreadyCheckedIn) {
                const wasJustAdmitted = (
                    (lastAdmittedInfo.studentId && lastAdmittedInfo.studentId === data.student?.id) ||
                    (lastAdmittedInfo.code && lastAdmittedInfo.code === code && (Date.now() - lastAdmittedInfo.timestamp) < 45000)
                );

                if (wasJustAdmitted) {
                    // This pass was just admitted moments ago at this terminal
                    renderGateResult({
                        statusType: 'valid',
                        messageTitle: '✅ ADMITTED JUST NOW (CONFIRMED)',
                        messageDesc: `Student was checked in moments ago at ${data.student?.checkedInAt || 'this terminal'}. Entry is Approved!`,
                        student: data.student,
                        code
                    });
                    playScanSound('success');
                } else {
                    // Genuine reused pass
                    renderGateResult({
                        statusType: 'reused',
                        messageTitle: '⚠️ REUSED PASS! ALREADY ADMITTED',
                        messageDesc: data.message || `This pass was already scanned and admitted at ${data.student?.checkedInAt || 'earlier today'}. Entry Forbidden!`,
                        student: data.student,
                        code
                    });
                    playScanSound('warning');
                }
            } else if (response.status === 400 && (data.isUnpaid || data.student)) {
                // UNPAID PASS
                renderGateResult({
                    statusType: 'unpaid',
                    messageTitle: '⛔ PAYMENT PENDING - ACCESS DENIED',
                    messageDesc: data.message || `Registration exists but payment has not been confirmed. Entry forbidden.`,
                    student: data.student,
                    code
                });
                playScanSound('error');
            } else {
                // NOT FOUND OR INVALID
                renderGateResult({
                    statusType: 'notfound',
                    messageTitle: '❌ PASS NOT FOUND / INVALID QR',
                    messageDesc: data.message || 'No matching student registration record was found in the database.',
                    student: null,
                    code
                });
                playScanSound('error');
            }
        }

    } catch (err) {
        console.error("Pass verification error:", err);
        renderGateResult({
            statusType: 'notfound',
            messageTitle: 'SYSTEM ERROR',
            messageDesc: err.message || 'Failed to connect to verification server.',
            student: null,
            code
        });
        playScanSound('error');
    } finally {
        isGateVerifying = false;
        if (gateVerifyBtn) gateVerifyBtn.disabled = false;
        if (gatePreviewBtn) gatePreviewBtn.disabled = false;
    }
}

// Render complete attendee card and status banner
function renderGateResult({ statusType, messageTitle, messageDesc, student, code }) {
    if (!gateResult) return;
    gateResult.classList.remove("hidden");
    gateResult.className = `gate-result status-${statusType}`;

    // Badge styling & labels
    let badgeText = "UNKNOWN";
    let badgeClass = "badge-notfound";

    if (statusType === 'valid') {
        badgeText = "✅ ENTRY APPROVED";
        badgeClass = "badge-valid";
    } else if (statusType === 'preview') {
        badgeText = "ℹ️ VERIFIED (READY TO ADMIT)";
        badgeClass = "badge-preview";
    } else if (statusType === 'reused') {
        badgeText = "⚠️ PASS REUSED (DUPLICATE)";
        badgeClass = "badge-reused";
    } else if (statusType === 'unpaid') {
        badgeText = "⛔ NOT PAID / PENDING";
        badgeClass = "badge-unpaid";
    } else if (statusType === 'notfound') {
        badgeText = "❌ INVALID PASS";
        badgeClass = "badge-notfound";
    }

    if (gateStatusBadge) {
        gateStatusBadge.className = `gate-badge ${badgeClass}`;
        gateStatusBadge.textContent = badgeText;
    }
    if (gateResultTitle) gateResultTitle.textContent = messageTitle;
    if (gateResultDesc) gateResultDesc.textContent = messageDesc;

    // Quick Action button in banner
    if (gateResultQuickAction) {
        gateResultQuickAction.innerHTML = "";
        if (statusType === 'preview' && student) {
            gateResultQuickAction.innerHTML = `
                <button type="button" class="btn-banner-action" onclick="admitScannedStudent('${escapeHtml(code)}')">
                    ✅ Admit Student Now
                </button>
            `;
        } else if (statusType === 'reused' && student && student.id) {
            gateResultQuickAction.innerHTML = `
                <button type="button" class="btn-banner-action danger" onclick="resetAndReverifyStudent(${student.id}, '${escapeHtml(code)}')">
                    ↺ Reset Check-In Status
                </button>
            `;
        }
    }

    if (!gateStudentDetails) return;

    if (!student) {
        gateStudentDetails.innerHTML = `
            <div class="gate-detail-cell full-width" style="text-align: center; color: #ef4444; padding: 20px;">
                <strong>No attendee profile found for input:</strong> <code>${escapeHtml(code)}</code><br>
                <small style="color: #94a3b8; margin-top: 6px; display:inline-block;">Ensure the student has registered through the portal and the QR code is clear.</small>
            </div>
        `;
        return;
    }

    const isPaid = student.paymentStatus === 'paid';
    const payBadge = isPaid
        ? `<span style="background:#15803d; color:#fff; padding:4px 10px; border-radius:12px; font-weight:700; font-size:12px; display:inline-block;">PAID (₹${student.paymentAmountRupees})</span>`
        : `<span style="background:#b91c1c; color:#fff; padding:4px 10px; border-radius:12px; font-weight:700; font-size:12px; display:inline-block;">UNPAID (${escapeHtml((student.paymentStatus || 'PENDING').toUpperCase())})</span>`;

    const checkInStatusHtml = student.checkedIn
        ? `<span style="color:#60a5fa; font-weight:700;">Admitted at:</span> ${escapeHtml(student.checkedInAt || 'Recorded')}`
        : `<span style="color:#94a3b8; font-weight:600;">Not checked in yet</span>`;

    gateStudentDetails.innerHTML = `
        <div class="gate-detail-cell">
            <div class="gate-detail-label">Student Name</div>
            <div class="gate-detail-val large">${escapeHtml(student.name)}</div>
        </div>

        <div class="gate-detail-cell">
            <div class="gate-detail-label">PRN / College ID</div>
            <div class="gate-detail-val mono" style="font-size:16px; color:#60a5fa;">
                ${escapeHtml(student.collegeId)}
                <button type="button" class="copy-mini-btn" onclick="copyIdText('${escapeHtml(student.collegeId)}', 'PRN')">Copy</button>
            </div>
        </div>

        <div class="gate-detail-cell">
            <div class="gate-detail-label">Event</div>
            <div class="gate-detail-val"><strong>${escapeHtml(student.eventTitle)}</strong></div>
        </div>

        <div class="gate-detail-cell">
            <div class="gate-detail-label">Payment Status</div>
            <div class="gate-detail-val">${payBadge}</div>
        </div>

        <div class="gate-detail-cell">
            <div class="gate-detail-label">Department & Year</div>
            <div class="gate-detail-val">${escapeHtml(student.department)} (${escapeHtml(student.academicYear)})</div>
        </div>

        <div class="gate-detail-cell">
            <div class="gate-detail-label">Mobile Contact</div>
            <div class="gate-detail-val">${escapeHtml(student.mobile)}</div>
        </div>

        <div class="gate-detail-cell">
            <div class="gate-detail-label">Bank UTR / Transaction No</div>
            <div class="gate-detail-val mono">
                ${escapeHtml(student.utrNumber)}
                ${student.utrNumber !== 'N/A' ? `<button type="button" class="copy-mini-btn" onclick="copyIdText('${escapeHtml(student.utrNumber)}', 'UTR')">Copy</button>` : ''}
            </div>
        </div>

        <div class="gate-detail-cell">
            <div class="gate-detail-label">Razorpay Payment ID</div>
            <div class="gate-detail-val mono">
                ${escapeHtml(student.razorpayPaymentId)}
                ${student.razorpayPaymentId !== 'N/A' ? `<button type="button" class="copy-mini-btn" onclick="copyIdText('${escapeHtml(student.razorpayPaymentId)}', 'Payment ID')">Copy</button>` : ''}
            </div>
        </div>

        <div class="gate-detail-cell">
            <div class="gate-detail-label">Pass Registration ID</div>
            <div class="gate-detail-val mono" style="color:#facc15;">
                ${escapeHtml(student.registrationId)}
                <button type="button" class="copy-mini-btn" onclick="copyIdText('${escapeHtml(student.registrationId)}', 'Pass ID')">Copy</button>
            </div>
        </div>

        <div class="gate-detail-cell">
            <div class="gate-detail-label">Gate Admission Status</div>
            <div class="gate-detail-val">${checkInStatusHtml}</div>
        </div>

        ${statusType === 'reused' ? `
            <div class="gate-detail-cell full-width">
                <div class="reused-timestamp-box">
                    <strong>⚠️ DUPLICATE ENTRY WARNING:</strong> This pass was already stamped as admitted at <strong>${escapeHtml(student.checkedInAt || 'earlier')}</strong>.
                    Do NOT allow entry unless you verify student identity or click "Reset Check-In Status".
                </div>
            </div>
        ` : ''}

        ${statusType === 'unpaid' ? `
            <div class="gate-detail-cell full-width">
                <div class="reused-timestamp-box" style="background:rgba(220,38,38,0.2); border-color:#dc2626;">
                    <strong>⛔ PAYMENT NOT CLEARED:</strong> This attendee has not completed payment (Status: <strong>${escapeHtml(student.paymentStatus.toUpperCase())}</strong>).
                    Instruct the student to complete payment via their pass link before entering.
                </div>
            </div>
        ` : ''}
    `;
}

// Global action helpers
window.admitScannedStudent = async function(code) {
    await verifyPass(code, { preview: false });
};

window.resetAndReverifyStudent = async function(studentId, code) {
    if (!confirm("Reset admission status for this student to allow entry again?")) return;
    try {
        await apiRequest("/api/admin/reset-checkin", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: studentId })
        });
        showToast("Check-in reset successfully. Re-verifying pass...");
        await verifyPass(code, { preview: false });
    } catch (err) {
        alert(err.message);
    }
};

window.quickAdmit = async function (regId, eventId) {
    if (gateInput) gateInput.value = regId;
    if (eventId && gateEventSelect) gateEventSelect.value = eventId;
    if (btnClearGateInput) btnClearGateInput.classList.remove("hidden");
    await verifyPass(regId, { preview: false });
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
        showToast("Student check-in status reset.");
    } catch (err) {
        alert(err.message);
    }
};

// Gate Event Listeners
if (gateVerifyForm) {
    gateVerifyForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const code = gateInput ? gateInput.value : "";
        await verifyPass(code, { preview: false });
    });
}

if (gatePreviewBtn) {
    gatePreviewBtn.addEventListener("click", async () => {
        const code = gateInput ? gateInput.value : "";
        await verifyPass(code, { preview: true });
    });
}

if (gateInput) {
    gateInput.addEventListener("input", () => {
        if (btnClearGateInput) {
            if (gateInput.value.trim()) btnClearGateInput.classList.remove("hidden");
            else btnClearGateInput.classList.add("hidden");
        }
    });
}

if (btnClearGateInput) {
    btnClearGateInput.addEventListener("click", () => {
        if (gateInput) gateInput.value = "";
        btnClearGateInput.classList.add("hidden");
        if (gateResult) gateResult.classList.add("hidden");
        if (gateInput) gateInput.focus();
    });
}

if (btnToggleCamera) {
    btnToggleCamera.addEventListener("click", () => {
        startQrCamera();
    });
}

if (btnCloseCamera) {
    btnCloseCamera.addEventListener("click", () => {
        stopQrCamera();
    });
}

if (btnSwitchCamera) {
    btnSwitchCamera.addEventListener("click", async () => {
        if (availableCameraDevices.length > 1) {
            activeCameraIndex = (activeCameraIndex + 1) % availableCameraDevices.length;
            selectedCameraDeviceId = availableCameraDevices[activeCameraIndex].id;
            if (cameraDeviceSelect) cameraDeviceSelect.value = selectedCameraDeviceId;
        } else {
            currentFacingMode = currentFacingMode === "environment" ? "user" : "environment";
            selectedCameraDeviceId = null;
        }
        await stopQrCamera();
        await startQrCamera();
    });
}

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
// PAYMENTS & TRANSACTION LEDGER LOGIC
// ========================================

async function loadPayments() {
    const eventId = paymentEventSelect ? paymentEventSelect.value : "";
    const status = paymentStatusSelect ? paymentStatusSelect.value : "all";
    const search = paymentSearchInput ? paymentSearchInput.value.trim() : "";

    try {
        const url = new URL("/api/admin/payments", window.location.origin);
        if (eventId) url.searchParams.set("eventId", eventId);
        if (status) url.searchParams.set("status", status);
        if (search) url.searchParams.set("search", search);

        const data = await apiRequest(url.pathname + url.search);

        // 1. Update Summary Ribbon
        if (data.summary) {
            if (paySummaryTotal) paySummaryTotal.textContent = data.summary.totalCount || 0;
            if (paySummaryPaid) paySummaryPaid.textContent = data.summary.paidCount || 0;
            if (paySummaryPending) paySummaryPending.textContent = data.summary.pendingCount || 0;
            if (paySummaryRevenue) paySummaryRevenue.textContent = `₹${data.summary.totalRevenueRupees || '0.00'}`;
        }

        // 2. Render Event Revenue Breakdown Cards
        if (paymentBreakdownGrid && data.eventBreakdown) {
            paymentBreakdownGrid.innerHTML = data.eventBreakdown.map(b => {
                const isSelected = eventId === String(b.event_id);
                return `
                    <div class="breakdown-card ${isSelected ? 'active' : ''}" style="cursor: pointer;" onclick="filterPaymentsByEvent(${b.event_id})" title="Click to filter by ${escapeHtml(b.event_title)}">
                        <div class="breakdown-card-title">${escapeHtml(b.event_title)}</div>
                        <div class="breakdown-card-stats">
                            <span>Fee: <strong>${b.fee_rupees === 0 ? 'Free' : `₹${b.fee_rupees}`}</strong></span>
                            <span>Paid: <strong>${b.paid_count}</strong> / ${b.total_orders}</span>
                        </div>
                        <div class="breakdown-card-revenue">₹${Number(b.revenue_rupees || 0).toFixed(2)}</div>
                    </div>
                `;
            }).join("");
        }

        // 3. Render Payments Table
        if (!data.payments || data.payments.length === 0) {
            paymentsTableBody.innerHTML = `
                <tr><td colspan="9" class="text-center">No payment transactions found matching the selected filters.</td></tr>
            `;
            if (paymentsCountMessage) paymentsCountMessage.textContent = "Showing 0 transactions.";
            return;
        }

        paymentsTableBody.innerHTML = data.payments.map(p => {
            const isPaid = p.payment_status === "paid";
            const statusBadge = `<span class="badge-pill ${isPaid ? 'active' : 'upcoming'}">${escapeHtml(p.payment_status.toUpperCase())}</span>`;
            const amountRupees = p.payment_amount ? (p.payment_amount / 100).toFixed(2) : "0.00";

            const payIdHtml = p.razorpay_payment_id
                ? `<div class="id-copy-cell"><span class="id-code pay-id">${escapeHtml(p.razorpay_payment_id)}</span><button type="button" class="btn-copy-id" onclick="copyIdText('${escapeHtml(p.razorpay_payment_id)}', 'Payment ID')" title="Copy Payment ID">Copy</button></div>`
                : `<span style="color:#64748b">—</span>`;

            const orderIdHtml = p.razorpay_order_id
                ? `<div class="id-copy-cell"><span class="id-code order-id">${escapeHtml(p.razorpay_order_id)}</span><button type="button" class="btn-copy-id" onclick="copyIdText('${escapeHtml(p.razorpay_order_id)}', 'Order ID')" title="Copy Order ID">Copy</button></div>`
                : `<span style="color:#64748b">—</span>`;

            const utrHtml = (p.utr_number && p.utr_number !== "N/A")
                ? `<div class="id-copy-cell"><span class="id-code utr">${escapeHtml(p.utr_number)}</span><button type="button" class="btn-copy-id" onclick="copyIdText('${escapeHtml(p.utr_number)}', 'UTR / Ref No')" title="Copy UTR / RRN">Copy</button></div>`
                : `<span style="color:#64748b">—</span>`;

            let modeDetails = escapeHtml((p.payment_method || 'online').toUpperCase());
            if (p.payment_vpa) {
                modeDetails += `<span class="pay-meta">UPI: ${escapeHtml(p.payment_vpa)}</span>`;
            } else if (p.payment_bank) {
                modeDetails += `<span class="pay-meta">Bank: ${escapeHtml(p.payment_bank)}</span>`;
            }

            const timestamp = p.paid_at || p.created_at || "—";

            return `
                <tr>
                    <td>
                        <strong>${escapeHtml(p.name)}</strong><br>
                        <small style="color:#94a3b8">${escapeHtml(p.college_id)} • ${escapeHtml(p.mobile)}</small>
                    </td>
                    <td><strong>${escapeHtml(p.event_title || 'General Event')}</strong></td>
                    <td>
                        <span class="pay-amount">₹${amountRupees}</span>
                    </td>
                    <td>${statusBadge}</td>
                    <td>${payIdHtml}</td>
                    <td>${orderIdHtml}</td>
                    <td>${utrHtml}</td>
                    <td>${modeDetails}</td>
                    <td><small style="color:#cbd5e1">${escapeHtml(timestamp)}</small></td>
                </tr>
            `;
        }).join("");

        if (paymentsCountMessage) {
            paymentsCountMessage.textContent = `Showing ${data.payments.length} transaction(s).`;
        }

    } catch (err) {
        if (paymentsTableBody) {
            paymentsTableBody.innerHTML = `
                <tr><td colspan="9" class="text-center" style="color:#f87171">${escapeHtml(err.message)}</td></tr>
            `;
        }
    }
}

window.filterPaymentsByEvent = function(eventId) {
    if (paymentEventSelect) {
        paymentEventSelect.value = paymentEventSelect.value === String(eventId) ? "" : String(eventId);
        loadPayments();
    }
};

window.exportPaymentsExcel = function() {
    const eventId = paymentEventSelect ? paymentEventSelect.value : "";
    const status = paymentStatusSelect ? paymentStatusSelect.value : "all";
    const url = new URL("/api/admin/export-payments", window.location.origin);
    if (eventId) url.searchParams.set("eventId", eventId);
    if (status && status !== "all") url.searchParams.set("status", status);
    window.location.href = url.pathname + url.search;
};

window.copyIdText = function(text, label) {
    if (!navigator.clipboard) {
        prompt(`Copy ${label}:`, text);
        return;
    }
    navigator.clipboard.writeText(text).then(() => {
        showToast(`Copied ${label}: ${text}`);
    }).catch(() => {
        prompt(`Copy ${label}:`, text);
    });
};

function showToast(message) {
    const existing = document.querySelector(".toast-popup");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.className = "toast-popup";
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 2500);
}

// Payment Search Debounce
let paymentSearchTimer;
if (paymentSearchInput) {
    paymentSearchInput.addEventListener("input", () => {
        clearTimeout(paymentSearchTimer);
        paymentSearchTimer = setTimeout(loadPayments, 300);
    });
}

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
