// ==========================================================================
// EESA Volunteer Gate Pass Scanner
// Client Application Logic
// ==========================================================================

(() => {
    // State
    let currentVolunteer = null;
    let availableEvents = [];
    let html5QrScanner = null;
    let isCameraActive = false;
    let isCameraPaused = false;
    let isScanBusy = false;
    let currentFacingMode = "environment";
    let lastScannedText = null;
    let lastScanTime = 0;
    let recentScans = [];
    let audioCtx = null;

    // DOM Elements
    const loginSection = document.getElementById("loginSection");
    const scannerSection = document.getElementById("scannerSection");
    const volunteerLoginForm = document.getElementById("volunteerLoginForm");
    const volunteerUsername = document.getElementById("volunteerUsername");
    const volunteerPassword = document.getElementById("volunteerPassword");
    const btnVolunteerLogin = document.getElementById("btnVolunteerLogin");
    const loginFeedback = document.getElementById("loginFeedback");

    const headerVolunteerName = document.getElementById("headerVolunteerName");
    const btnLogoutVolunteer = document.getElementById("btnLogoutVolunteer");
    const activeEventSelect = document.getElementById("activeEventSelect");
    const gateAdmittedCount = document.getElementById("gateAdmittedCount");
    const gatePaidCount = document.getElementById("gatePaidCount");
    const btnRefreshStats = document.getElementById("btnRefreshStats");

    const cameraStatusText = document.getElementById("cameraStatusText");
    const btnFlipCamera = document.getElementById("btnFlipCamera");
    const btnToggleCameraPower = document.getElementById("btnToggleCameraPower");
    const laserLine = document.getElementById("laserLine");

    const autoAdmitToggle = document.getElementById("autoAdmitToggle");
    const soundToggle = document.getElementById("soundToggle");
    const manualVerifyForm = document.getElementById("manualVerifyForm");
    const manualPassInput = document.getElementById("manualPassInput");
    const btnClearInput = document.getElementById("btnClearInput");
    const btnVerifyAdmit = document.getElementById("btnVerifyAdmit");
    const btnPreviewCheck = document.getElementById("btnPreviewCheck");

    const verificationResultCard = document.getElementById("verificationResultCard");
    const resultBanner = document.getElementById("resultBanner");
    const resultBadge = document.getElementById("resultBadge");
    const resultTimestamp = document.getElementById("resultTimestamp");
    const resultTitle = document.getElementById("resultTitle");
    const resultSubtitle = document.getElementById("resultSubtitle");
    const studentDetailsGrid = document.getElementById("studentDetailsGrid");
    const resultActionRow = document.getElementById("resultActionRow");

    const recentScansList = document.getElementById("recentScansList");
    const recentCountText = document.getElementById("recentCountText");

    // ==========================================
    // API HELPER
    // ==========================================
    async function api(url, options = {}) {
        const response = await fetch(url, {
            credentials: "same-origin",
            ...options
        });
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            const err = new Error(data.message || data.error || "Request failed.");
            err.status = response.status;
            err.data = data;
            throw err;
        }
        return data;
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

    // ==========================================
    // AUDIO & TACTILE FEEDBACK
    // ==========================================
    function playAudioTone(type = "success") {
        if (!soundToggle || !soundToggle.checked) return;
        try {
            if (!audioCtx) {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            }
            if (audioCtx.state === "suspended") {
                audioCtx.resume();
            }

            const now = audioCtx.currentTime;
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.connect(gain);
            gain.connect(audioCtx.destination);

            if (type === "success") {
                // High crisp ascending chime
                osc.type = "sine";
                osc.frequency.setValueAtTime(880, now);
                osc.frequency.setValueAtTime(1320, now + 0.09);
                gain.gain.setValueAtTime(0.28, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
                osc.start(now);
                osc.stop(now + 0.28);

                if (navigator.vibrate) navigator.vibrate(120);

            } else if (type === "warning") {
                // Double alert tone (Pass reused)
                osc.type = "sawtooth";
                osc.frequency.setValueAtTime(320, now);
                osc.frequency.setValueAtTime(240, now + 0.12);
                gain.gain.setValueAtTime(0.3, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
                osc.start(now);
                osc.stop(now + 0.35);

                if (navigator.vibrate) navigator.vibrate([100, 60, 120]);

            } else {
                // Low error buzz (Unpaid or invalid)
                osc.type = "sawtooth";
                osc.frequency.setValueAtTime(180, now);
                gain.gain.setValueAtTime(0.35, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
                osc.start(now);
                osc.stop(now + 0.3);

                if (navigator.vibrate) navigator.vibrate([180, 80, 180]);
            }
        } catch (e) {
            console.warn("Audio playback not supported:", e);
        }
    }

    // ==========================================
    // INITIALIZATION & AUTH STATE
    // ==========================================
    async function checkAuthSession() {
        try {
            const data = await api("/api/volunteer/me");
            if (data.authenticated && data.volunteer) {
                currentVolunteer = data.volunteer;
                showScannerView();
                await setupGateSession();
            } else {
                showLoginView();
            }
        } catch {
            showLoginView();
        }
    }

    function showLoginView() {
        loginSection.classList.remove("hidden");
        scannerSection.classList.add("hidden");
        stopCameraScanner();
    }

    function showScannerView() {
        loginSection.classList.add("hidden");
        scannerSection.classList.remove("hidden");
        if (headerVolunteerName) {
            headerVolunteerName.textContent = currentVolunteer.name || "Volunteer Staff";
        }
    }

    // ==========================================
    // VOLUNTEER LOGIN & LOGOUT
    // ==========================================
    volunteerLoginForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        btnVolunteerLogin.disabled = true;
        loginFeedback.classList.add("hidden");

        const username = volunteerUsername.value.trim();
        const password = volunteerPassword.value.trim();

        try {
            const data = await api("/api/volunteer/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password })
            });

            currentVolunteer = data.volunteer;
            volunteerLoginForm.reset();
            showScannerView();
            await setupGateSession();

        } catch (err) {
            loginFeedback.textContent = err.message || "Invalid username or password.";
            loginFeedback.className = "feedback-banner error";
            loginFeedback.classList.remove("hidden");
        } finally {
            btnVolunteerLogin.disabled = false;
        }
    });

    btnLogoutVolunteer.addEventListener("click", async () => {
        if (!confirm("Are you sure you want to sign out of the gate scanner?")) return;
        try {
            await api("/api/volunteer/logout", { method: "POST" });
        } catch (e) {}
        currentVolunteer = null;
        showLoginView();
    });

    // ==========================================
    // GATE SESSION SETUP & EVENTS
    // ==========================================
    async function setupGateSession() {
        try {
            const eventsData = await api("/api/volunteer/events");
            availableEvents = eventsData.events || [];

            activeEventSelect.innerHTML = `
                <option value="">All Events (Auto-Detect from Pass)</option>
                ${availableEvents.map(ev => `<option value="${ev.id}">${escapeHtml(ev.title)}</option>`).join("")}
            `;

            // If locked to a specific event
            if (eventsData.assignedEventId) {
                activeEventSelect.value = String(eventsData.assignedEventId);
                activeEventSelect.disabled = true;
            }

            await updateGateStats();
            await startCameraScanner();

        } catch (err) {
            console.error("Setup gate session error:", err);
        }
    }

    async function updateGateStats() {
        try {
            const eventId = activeEventSelect.value;
            const url = eventId ? `/api/volunteer/stats?eventId=${eventId}` : "/api/volunteer/stats";
            const stats = await api(url);

            if (gateAdmittedCount) gateAdmittedCount.textContent = stats.checkedInCount || 0;
            if (gatePaidCount) gatePaidCount.textContent = `${stats.totalPaid || 0} Expected`;
        } catch (e) {
            console.warn("Could not refresh gate stats:", e);
        }
    }

    activeEventSelect.addEventListener("change", async () => {
        await updateGateStats();
    });

    btnRefreshStats.addEventListener("click", async () => {
        btnRefreshStats.textContent = "⏳";
        await updateGateStats();
        setTimeout(() => { btnRefreshStats.textContent = "🔄"; }, 500);
    });

    // ==========================================
    // QR CAMERA SCANNER LOGIC
    // ==========================================
    async function startCameraScanner() {
        if (typeof Html5Qrcode === "undefined") {
            if (cameraStatusText) cameraStatusText.textContent = "QR library loading...";
            return;
        }

        try {
            if (!html5QrScanner) {
                html5QrScanner = new Html5Qrcode("qrReader");
            }

            if (isCameraActive) {
                await html5QrScanner.stop();
            }

            const qrCodeSuccessCallback = async (decodedText) => {
                if (isScanBusy || isCameraPaused) return;

                // De-duplicate rapid scans within 8 seconds
                const now = Date.now();
                if (decodedText === lastScannedText && (now - lastScanTime) < 8000) {
                    return;
                }

                isScanBusy = true;
                lastScannedText = decodedText;
                lastScanTime = now;

                manualPassInput.value = decodedText;
                if (btnClearInput) btnClearInput.classList.remove("hidden");

                if (cameraStatusText) cameraStatusText.textContent = "Pass Scanned! Checking validity...";
                const autoAdmit = autoAdmitToggle ? autoAdmitToggle.checked : true;

                await handlePassVerification(decodedText, { preview: !autoAdmit });

                setTimeout(() => {
                    isScanBusy = false;
                    if (cameraStatusText && !isCameraPaused) {
                        cameraStatusText.textContent = "Camera Active: Align attendee QR code";
                    }
                }, 2200);
            };

            const qrConfig = {
                fps: 15,
                qrbox: (viewWidth, viewHeight) => {
                    const minDim = Math.min(viewWidth, viewHeight);
                    return {
                        width: Math.floor(minDim * 0.72),
                        height: Math.floor(minDim * 0.72)
                    };
                },
                aspectRatio: 1.0
            };

            await html5QrScanner.start(
                { facingMode: currentFacingMode },
                qrConfig,
                qrCodeSuccessCallback,
                () => {} // Frame without QR
            );

            isCameraActive = true;
            isCameraPaused = false;
            if (laserLine) laserLine.classList.remove("hidden");
            if (cameraStatusText) cameraStatusText.textContent = "Camera Active: Align attendee QR code";
            if (btnToggleCameraPower) btnToggleCameraPower.textContent = "⏸️ Pause";

        } catch (err) {
            console.warn("Camera start error:", err);
            isCameraActive = false;
            if (laserLine) laserLine.classList.add("hidden");
            if (cameraStatusText) {
                if (location.protocol !== "https:" && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
                    cameraStatusText.innerHTML = "⚠️ <strong>HTTPS Required:</strong> Mobile browsers block camera on HTTP. Please open using <code>https://</code> or use manual ID entry below.";
                } else {
                    cameraStatusText.textContent = "Camera access denied or unavailable. Use manual ID search below.";
                }
            }
        }
    }

    async function stopCameraScanner() {
        if (html5QrScanner && isCameraActive) {
            try {
                await html5QrScanner.stop();
            } catch (e) {}
        }
        isCameraActive = false;
        if (laserLine) laserLine.classList.add("hidden");
    }

    btnFlipCamera.addEventListener("click", async () => {
        currentFacingMode = currentFacingMode === "environment" ? "user" : "environment";
        await startCameraScanner();
    });

    btnToggleCameraPower.addEventListener("click", async () => {
        if (!isCameraActive) {
            await startCameraScanner();
            return;
        }

        if (isCameraPaused) {
            try {
                html5QrScanner.resume();
                isCameraPaused = false;
                btnToggleCameraPower.textContent = "⏸️ Pause";
                if (laserLine) laserLine.classList.remove("hidden");
                if (cameraStatusText) cameraStatusText.textContent = "Camera Active: Align attendee QR code";
            } catch (e) {
                await startCameraScanner();
            }
        } else {
            try {
                html5QrScanner.pause();
                isCameraPaused = true;
                btnToggleCameraPower.textContent = "▶️ Resume";
                if (laserLine) laserLine.classList.add("hidden");
                if (cameraStatusText) cameraStatusText.textContent = "Camera Paused";
            } catch (e) {
                await stopCameraScanner();
            }
        }
    });

    // ==========================================
    // MANUAL FORM SUBMISSION & CONTROLS
    // ==========================================
    manualVerifyForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const code = manualPassInput.value.trim();
        if (!code) return;
        await handlePassVerification(code, { preview: false });
    });

    btnPreviewCheck.addEventListener("click", async () => {
        const code = manualPassInput.value.trim();
        if (!code) {
            alert("Please enter or scan a pass identifier.");
            return;
        }
        await handlePassVerification(code, { preview: true });
    });

    manualPassInput.addEventListener("input", () => {
        if (manualPassInput.value.trim()) {
            btnClearInput.classList.remove("hidden");
        } else {
            btnClearInput.classList.add("hidden");
        }
    });

    btnClearInput.addEventListener("click", () => {
        manualPassInput.value = "";
        btnClearInput.classList.add("hidden");
        verificationResultCard.classList.add("hidden");
        manualPassInput.focus();
    });

    // ==========================================
    // PASS VERIFICATION HANDLER
    // ==========================================
    async function handlePassVerification(code, { preview = false } = {}) {
        if (!code || !code.trim()) return;

        btnVerifyAdmit.disabled = true;
        btnPreviewCheck.disabled = true;

        const eventId = activeEventSelect ? activeEventSelect.value : "";

        // Show verifying state
        verificationResultCard.classList.remove("hidden");
        resultBanner.className = "result-banner preview";
        resultBadge.textContent = "VERIFYING PASS...";
        resultTimestamp.textContent = new Date().toLocaleTimeString();
        resultTitle.textContent = "Checking Registration Record...";
        resultSubtitle.textContent = "Querying pass authenticity and admission status...";
        studentDetailsGrid.innerHTML = "";
        resultActionRow.innerHTML = "";

        try {
            const data = await api("/api/volunteer/verify-entry", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    code: code.trim(),
                    eventId: eventId ? parseInt(eventId, 10) : undefined,
                    preview: Boolean(preview)
                })
            });

            // SUCCESS - APPROVED OR PREVIEW
            const isPreview = Boolean(data.isPreview);
            renderResultCard({
                type: isPreview ? "preview" : "valid",
                badge: isPreview ? "VALID (PREVIEW ONLY)" : "ENTRY APPROVED",
                title: isPreview ? "PASS IS ELIGIBLE & VALID" : "ENTRY APPROVED",
                subtitle: data.message,
                student: data.student,
                code: code.trim(),
                canAdmitNow: isPreview
            });

            playAudioTone("success");
            recordRecentScan(data.student, isPreview ? "preview" : "valid");
            await updateGateStats();

        } catch (err) {
            const data = err.data || {};

            if (err.status === 409 || data.isReused || data.alreadyCheckedIn) {
                // REUSED PASS
                renderResultCard({
                    type: "reused",
                    badge: "PASS REUSED! ALREADY ENTERED",
                    title: "DUPLICATE ENTRY FORBIDDEN",
                    subtitle: data.message || `This pass was already scanned and admitted earlier.`,
                    student: data.student,
                    code: code.trim()
                });
                playAudioTone("warning");
                if (data.student) recordRecentScan(data.student, "reused");

            } else if (err.status === 400 && data.isUnpaid) {
                // UNPAID PASS
                renderResultCard({
                    type: "unpaid",
                    badge: "PAYMENT NOT PAID",
                    title: "ENTRY FORBIDDEN: UNPAID PASS",
                    subtitle: data.message || "Student registration is pending payment confirmation.",
                    student: data.student,
                    code: code.trim()
                });
                playAudioTone("error");
                if (data.student) recordRecentScan(data.student, "unpaid");

            } else if (data.isEventMismatch) {
                // WRONG EVENT PASS
                renderResultCard({
                    type: "warning",
                    badge: "WRONG EVENT GATE",
                    title: "DIFFERENT EVENT PASS",
                    subtitle: data.message,
                    student: null,
                    code: code.trim()
                });
                playAudioTone("warning");

            } else {
                // NOT FOUND / INVALID
                renderResultCard({
                    type: "notfound",
                    badge: "INVALID / NOT FOUND",
                    title: "PASS NOT FOUND",
                    subtitle: data.message || "No registration record matches this QR Code or ID in the database.",
                    student: null,
                    code: code.trim()
                });
                playAudioTone("error");
            }
        } finally {
            btnVerifyAdmit.disabled = false;
            btnPreviewCheck.disabled = false;
        }
    }

    // ==========================================
    // RENDER RESULT CARD
    // ==========================================
    function renderResultCard({ type, badge, title, subtitle, student, code, canAdmitNow }) {
        verificationResultCard.classList.remove("hidden");
        resultBanner.className = `result-banner ${type}`;
        resultBadge.textContent = badge;
        resultTimestamp.textContent = new Date().toLocaleTimeString();
        resultTitle.textContent = title;
        resultSubtitle.textContent = subtitle;

        if (student) {
            studentDetailsGrid.innerHTML = `
                <div class="detail-item full-width">
                    <span class="detail-label">Attendee Name</span>
                    <span class="detail-value name-highlight">${escapeHtml(student.name)}</span>
                </div>
                ${student.email ? `
                <div class="detail-item full-width">
                    <span class="detail-label">Student Email</span>
                    <span class="detail-value" style="color:#93c5fd; font-size:12px;">${escapeHtml(student.email)}</span>
                </div>
                ` : ''}
                <div class="detail-item">
                    <span class="detail-label">College ID / PRN</span>
                    <span class="detail-value mono">${escapeHtml(student.collegeId)}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Department / Year</span>
                    <span class="detail-value">${escapeHtml(student.department)} (${escapeHtml(student.academicYear)})</span>
                </div>
                <div class="detail-item full-width">
                    <span class="detail-label">Registered Event</span>
                    <span class="detail-value" style="color:#60a5fa;">${escapeHtml(student.eventTitle)}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Pass Registration ID</span>
                    <span class="detail-value mono">${escapeHtml(student.registrationId)}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Admission Timestamp</span>
                    <span class="detail-value" style="font-size:12px;">${escapeHtml(student.checkedInAt || 'Pending admission')}</span>
                </div>
            `;
        } else {
            studentDetailsGrid.innerHTML = `
                <div class="detail-item full-width">
                    <span class="detail-label">Scanned Identifier</span>
                    <span class="detail-value mono">${escapeHtml(code)}</span>
                </div>
            `;
        }

        // Action buttons
        if (canAdmitNow) {
            resultActionRow.innerHTML = `
                <button type="button" class="btn-mini-admit" id="btnAdmitFromPreview">
                    Admit Attendee Now &rarr;
                </button>
                <button type="button" class="btn-mini-dismiss" id="btnDismissCard">
                    Dismiss
                </button>
            `;
            const btnAdmitFromPreview = document.getElementById("btnAdmitFromPreview");
            if (btnAdmitFromPreview) {
                btnAdmitFromPreview.onclick = () => handlePassVerification(code, { preview: false });
            }
        } else {
            resultActionRow.innerHTML = `
                <button type="button" class="btn-mini-dismiss" id="btnDismissCard">
                    Dismiss
                </button>
            `;
        }

        const btnDismissCard = document.getElementById("btnDismissCard");
        if (btnDismissCard) {
            btnDismissCard.onclick = () => {
                verificationResultCard.classList.add("hidden");
                manualPassInput.value = "";
                if (btnClearInput) btnClearInput.classList.add("hidden");
            };
        }
    }

    // ==========================================
    // RECENT SCANS LOG
    // ==========================================
    function recordRecentScan(student, status) {
        if (!student) return;
        recentScans.unshift({
            name: student.name,
            collegeId: student.collegeId,
            eventTitle: student.eventTitle,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            status
        });

        if (recentScans.length > 20) recentScans.pop();
        renderRecentScans();
    }

    function renderRecentScans() {
        if (!recentScansList) return;
        if (!recentScans.length) {
            recentScansList.innerHTML = `<p class="empty-recent-msg">No passes scanned yet in this session.</p>`;
            if (recentCountText) recentCountText.textContent = "0 Scans";
            return;
        }

        if (recentCountText) recentCountText.textContent = `${recentScans.length} Scans`;

        recentScansList.innerHTML = recentScans.map(scan => `
            <div class="recent-scan-item status-${scan.status}">
                <div class="recent-info-col">
                    <strong>${escapeHtml(scan.name)}</strong>
                    <span>${escapeHtml(scan.collegeId)} • ${escapeHtml(scan.eventTitle)}</span>
                </div>
                <div class="recent-time-col">${escapeHtml(scan.time)}</div>
            </div>
        `).join("");
    }

    // Bootstrap
    checkAuthSession();

})();
