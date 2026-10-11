// Global state
let allEvents = [];
let activeFilter = 'all';

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadEvents();
});

// ========================================
// EVENTS HUB & DYNAMIC CARDS
// ========================================

async function loadEvents() {
    const loadingEl = document.getElementById('eventsLoading');
    const gridEl = document.getElementById('eventsGrid');

    try {
        const response = await fetch('/api/events');
        const data = await response.json();

        if (response.ok && data.success) {
            allEvents = data.events || [];
            renderEventCards();
        } else {
            gridEl.innerHTML = `<p class="loading-state" style="color:#f87171">${data.message || 'Unable to load events.'}</p>`;
        }
    } catch (err) {
        console.error('Error fetching events:', err);
        gridEl.innerHTML = '<p class="loading-state" style="color:#f87171">Failed to connect to the server. Please check your network.</p>';
    } finally {
        if (loadingEl) loadingEl.classList.add('hidden');
        if (gridEl) gridEl.classList.remove('hidden');
    }
}

function filterEvents(category, btn) {
    activeFilter = category;
    
    // Update active button state
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');

    renderEventCards();
}

function renderEventCards() {
    const gridEl = document.getElementById('eventsGrid');
    if (!gridEl) return;

    const filtered = allEvents.filter(ev => {
        if (activeFilter === 'all') return true;
        return ev.category?.toLowerCase() === activeFilter.toLowerCase();
    });

    if (filtered.length === 0) {
        gridEl.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #94a3b8;">
                <p style="font-size: 16px;">No events currently listed in this category.</p>
            </div>
        `;
        return;
    }

    gridEl.innerHTML = filtered.map(ev => {
        const feeText = ev.fee_paise === 0 ? 'Free Entry' : `₹${ev.fee_rupees}.00`;
        const statusClass = ev.status === 'active' ? 'active' : (ev.status === 'upcoming' ? 'upcoming' : 'closed');
        const statusLabel = ev.status === 'active' ? 'Registrations Open' : (ev.status === 'upcoming' ? 'Upcoming' : 'Closed');

        return `
            <div class="event-card" data-event-id="${ev.id}">
                <div>
                    <div class="event-card-top">
                        <span class="event-category-badge">${escapeHtml(ev.category || 'Event')}</span>
                        <span class="event-status-badge ${statusClass}">${statusLabel}</span>
                    </div>

                    <h4>${escapeHtml(ev.title)}</h4>
                    <p class="event-card-tagline">${escapeHtml(ev.tagline || 'Experience practical learning & innovation.')}</p>

                    <div class="event-card-meta">
                        <div class="event-meta-row">
                            <span>📅</span>
                            <strong>${escapeHtml(ev.date)} ${ev.time ? `• ${escapeHtml(ev.time)}` : ''}</strong>
                        </div>
                        <div class="event-meta-row">
                            <span>📍</span>
                            <span>${escapeHtml(ev.venue)}</span>
                        </div>
                    </div>
                </div>

                <div class="event-card-bottom">
                    <span class="event-price">${feeText}</span>
                    <button type="button" class="btn-event-action" onclick="openEventDetails(${ev.id})">
                        View Details & Register ➔
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

// ========================================
// EVENT DETAILS MODAL
// ========================================

function openEventDetails(eventId) {
    const ev = allEvents.find(e => e.id === eventId);
    if (!ev) return;

    const modalContent = document.getElementById('modalContent');
    const feeText = ev.fee_paise === 0 ? 'Free Entry' : `₹${ev.fee_rupees}.00`;
    const isClosed = ev.status === 'closed';

    const eligibilityHtml = ev.restrict_eligibility === 1
        ? `<div class="eligibility-notice restricted">
                ⚠️ <strong>Restricted Eligibility:</strong> This event is limited to pre-approved eligible College IDs uploaded by the EESA committee.
           </div>`
        : `<div class="eligibility-notice open">
                ✅ <strong>Open to All:</strong> Any enrolled college student with a valid College ID can register.
           </div>`;

    modalContent.innerHTML = `
        <div class="modal-header">
            <span class="badge-tag">${escapeHtml(ev.category)}</span>
            <h3>${escapeHtml(ev.title)}</h3>
            <span class="fee-badge-lg">Registration Fee: ${feeText}</span>
        </div>

        <p class="modal-sub">${escapeHtml(ev.tagline || '')}</p>

        <div class="modal-meta-grid">
            <div>
                <strong>Date & Time</strong>
                <span>${escapeHtml(ev.date)} ${ev.time ? `• ${escapeHtml(ev.time)}` : ''}</span>
            </div>
            <div>
                <strong>Location / Venue</strong>
                <span>${escapeHtml(ev.venue)}</span>
            </div>
        </div>

        ${eligibilityHtml}

        <div class="modal-desc-block">
            <h5>About this Event</h5>
            <p>${escapeHtml(ev.description)}</p>
        </div>

        ${ev.rules ? `
            <div class="modal-desc-block">
                <h5>Guidelines & Rules</h5>
                <p>${escapeHtml(ev.rules)}</p>
            </div>
        ` : ''}

        <div style="margin-top: 24px;">
            ${isClosed ? `
                <button type="button" class="btn-primary-block" disabled style="background:#475569;">
                    Registrations are Closed for this Event
                </button>
            ` : `
                <button type="button" class="btn-primary-block" onclick="startRegistration(${ev.id})">
                    Register for "${escapeHtml(ev.title)}" (${feeText}) ➔
                </button>
            `}
        </div>
    `;

    openModal('eventDetailsModal');
}

// ========================================
// REGISTRATION MODAL & SUBMISSION
// ========================================

function startRegistration(eventId) {
    closeModal('eventDetailsModal');

    const ev = allEvents.find(e => e.id === eventId);
    if (!ev) return;

    document.getElementById('formEventId').value = ev.id;
    document.getElementById('regModalTitle').textContent = `Register for ${ev.title}`;
    document.getElementById('regModalCategory').textContent = ev.category.toUpperCase();
    
    const feeText = ev.fee_paise === 0 ? 'Free Entry' : `₹${ev.fee_rupees}.00`;
    document.getElementById('regModalFee').textContent = `Fee: ${feeText}`;

    const regBtn = document.getElementById('regSubmitBtn');
    regBtn.textContent = ev.fee_paise === 0 ? 'Confirm Free Registration' : `Proceed to Pay (${feeText}) & Get Pass`;

    hideStatus('regStatusMsg');
    openModal('registrationModal');
}

const eventRegistrationForm = document.getElementById('eventRegistrationForm');
const regSubmitBtn = document.getElementById('regSubmitBtn');

eventRegistrationForm.addEventListener('submit', async function (e) {
    e.preventDefault();

    const eventId = document.getElementById('formEventId').value;
    const name = document.getElementById('formStudentName').value.trim();
    const collegeId = document.getElementById('formCollegeId').value.trim();
    const department = document.getElementById('formDepartment').value;
    const year = document.getElementById('formYear').value;
    const mobile = document.getElementById('formMobile').value.trim();

    if (!eventId || !name || !collegeId || !department || !year || !mobile) {
        showStatus('regStatusMsg', 'Please complete all required fields.', 'error');
        return;
    }

    if (!/^[0-9]{10}$/.test(mobile)) {
        showStatus('regStatusMsg', 'Please provide a valid 10-digit mobile number.', 'error');
        return;
    }

    regSubmitBtn.disabled = true;
    showStatus('regStatusMsg', 'Verifying student eligibility and creating order...', 'info');

    try {
        const payload = { eventId, name, collegeId, department, year, mobile };

        const orderRes = await fetch('/api/create-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const orderData = await orderRes.json();

        if (!orderRes.ok) {
            throw new Error(orderData.error || 'Could not initiate registration.');
        }

        // Case 1: Free Event (instant confirmation)
        if (orderData.freeEvent) {
            showStatus('regStatusMsg', 'Registration confirmed! Generating pass...', 'success');
            closeModal('registrationModal');
            showTicketModal({
                name,
                collegeId,
                department,
                academicYear: year,
                eventTitle: orderData.eventTitle,
                registrationId: orderData.registrationId,
                qrNumber: orderData.qrNumber,
                qrImage: orderData.qrImage,
                checkedIn: false
            });
            eventRegistrationForm.reset();
            return;
        }

        // Case 2: Paid Event (Razorpay Checkout)
        const razorpayOptions = {
            key: orderData.keyId,
            amount: orderData.amount,
            currency: orderData.currency || 'INR',
            name: 'EESA JSPM',
            description: orderData.eventTitle || 'Event Registration Pass',
            order_id: orderData.orderId,
            prefill: {
                name: payload.name,
                contact: payload.mobile
            },
            theme: { color: '#4f46e5' },
            handler: async function (paymentResponse) {
                showStatus('regStatusMsg', 'Verifying payment with bank & creating digital pass...', 'info');

                try {
                    const verifyRes = await fetch('/api/verify-payment', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(paymentResponse)
                    });

                    const verifyResult = await verifyRes.json();

                    if (!verifyRes.ok || !verifyResult.success) {
                        throw new Error(verifyResult.message || 'Payment verification failed.');
                    }

                    closeModal('registrationModal');
                    showTicketModal({
                        name: verifyResult.name || payload.name,
                        collegeId: verifyResult.collegeId || payload.collegeId,
                        department: verifyResult.department || payload.department,
                        academicYear: verifyResult.academicYear || payload.year,
                        eventTitle: verifyResult.eventTitle,
                        registrationId: verifyResult.registrationId,
                        qrNumber: verifyResult.qrNumber,
                        qrImage: verifyResult.qrImage,
                        checkedIn: false
                    });
                    eventRegistrationForm.reset();

                } catch (verifyErr) {
                    showStatus('regStatusMsg', verifyErr.message, 'error');
                } finally {
                    regSubmitBtn.disabled = false;
                }
            },
            modal: {
                ondismiss: function () {
                    showStatus(
                        'regStatusMsg',
                        'Payment window was closed. Your registration is saved as pending — you can retry anytime.',
                        'info'
                    );
                    regSubmitBtn.disabled = false;
                }
            }
        };

        const rzp = new Razorpay(razorpayOptions);
        rzp.on('payment.failed', function (resp) {
            showStatus('regStatusMsg', `Payment failed: ${resp.error?.description || 'Transaction declined'}.`, 'error');
            regSubmitBtn.disabled = false;
        });

        rzp.open();

    } catch (err) {
        showStatus('regStatusMsg', err.message, 'error');
        regSubmitBtn.disabled = false;
    }
});

// ========================================
// TICKET SUCCESS MODAL & PASS RENDERING
// ========================================

function showTicketModal(ticket) {
    const container = document.getElementById('ticketViewContainer');
    if (!container) return;

    container.innerHTML = `
        <div class="ticket-card" id="printableTicket">
            <div class="ticket-header">
                <span class="ticket-badge">OFFICIAL EVENT ENTRY PASS</span>
                <span class="ticket-verified">VERIFIED & CONFIRMED</span>
            </div>

            <h3 class="ticket-title">${escapeHtml(ticket.eventTitle || 'EESA EVENT PASS')}</h3>
            <p class="ticket-dept">Electronic Engineering Student Association • JSPM University</p>

            <div class="ticket-content">
                <div class="ticket-qr-area">
                    <img src="${ticket.qrImage}" alt="Event Gate QR Pass">
                    <span style="font-size:10px; font-weight:700; color:#64748b; display:block;">Gate QR Pass</span>
                </div>

                <div class="ticket-details">
                    <div class="ticket-field">
                        <span>STUDENT NAME</span>
                        <strong>${escapeHtml(ticket.name)}</strong>
                    </div>
                    <div class="ticket-field">
                        <span>COLLEGE ID / PRN</span>
                        <strong>${escapeHtml(ticket.collegeId)}</strong>
                    </div>
                    <div class="ticket-field">
                        <span>DEPT & YEAR</span>
                        <strong>${escapeHtml(ticket.department)} (${escapeHtml(ticket.academicYear)})</strong>
                    </div>
                    <div class="ticket-field">
                        <span>PASS ID</span>
                        <code>${escapeHtml(ticket.registrationId)}</code>
                    </div>
                    <div class="ticket-field">
                        <span>QR NUMBER</span>
                        <code>${escapeHtml(ticket.qrNumber)}</code>
                    </div>
                    <div class="ticket-field">
                        <span>GATE STATUS</span>
                        <strong style="color:${ticket.checkedIn ? '#15803d' : '#92400e'}">
                            ${ticket.checkedIn ? `Admitted (${ticket.checkedInAt || ''})` : 'Not Arrived'}
                        </strong>
                    </div>
                </div>
            </div>

            <div style="border-top: 1px solid #f1f5f9; margin-top:14px; padding-top:10px; font-size:11px; color:#94a3b8; text-align:center;">
                ⚠️ Please present this pass along with your College ID card at the entrance desk. Non-transferable.
            </div>
        </div>

        <div class="ticket-actions-row">
            <a href="${ticket.qrImage}" download="EESA-${ticket.registrationId}.png" class="btn-ticket-download">
                ⬇️ Download QR Pass Image
            </a>
            <button type="button" class="btn-ticket-print" onclick="window.print()">
                🖨️ Print / PDF
            </button>
        </div>
    `;

    openModal('ticketModal');
}

// ========================================
// FIND / RETRIEVE ALL PASSES
// ========================================

const passLookupForm = document.getElementById('passLookupForm');
const lookupSubmitBtn = document.getElementById('lookupSubmitBtn');
const lookupResultsList = document.getElementById('lookupResultsList');

passLookupForm.addEventListener('submit', async function (e) {
    e.preventDefault();

    const collegeId = document.getElementById('lookupCollegeId').value.trim();
    const mobile = document.getElementById('lookupMobile').value.trim();

    if (!collegeId || !mobile) {
        showStatus('lookupMessage', 'Please provide both College ID and Mobile Number.', 'error');
        return;
    }

    lookupSubmitBtn.disabled = true;
    lookupResultsList.classList.add('hidden');
    showStatus('lookupMessage', 'Searching your confirmed event passes...', 'info');

    try {
        const response = await fetch('/api/find-pass', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ collegeId, mobile })
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.message || 'No confirmed passes found.');
        }

        showStatus('lookupMessage', `Found ${data.totalPasses} verified event pass(es) for your College ID!`, 'success');

        lookupResultsList.innerHTML = data.passes.map(p => `
            <div class="ticket-card">
                <div class="ticket-header">
                    <span class="ticket-badge">${escapeHtml(p.eventTitle)}</span>
                    <span class="ticket-verified">PAID & CONFIRMED</span>
                </div>

                <div class="ticket-content">
                    <div class="ticket-qr-area">
                        <img src="${p.qrImage}" alt="Event Gate Pass">
                        <span style="font-size:10px; font-weight:700; color:#64748b; display:block;">Gate QR Pass</span>
                    </div>

                    <div class="ticket-details">
                        <div class="ticket-field">
                            <span>STUDENT NAME</span>
                            <strong>${escapeHtml(p.name)}</strong>
                        </div>
                        <div class="ticket-field">
                            <span>COLLEGE ID</span>
                            <strong>${escapeHtml(p.collegeId)}</strong>
                        </div>
                        <div class="ticket-field">
                            <span>DEPARTMENT / YEAR</span>
                            <strong>${escapeHtml(p.department)} (${escapeHtml(p.academicYear)})</strong>
                        </div>
                        <div class="ticket-field">
                            <span>PASS ID</span>
                            <code>${escapeHtml(p.registrationId)}</code>
                        </div>
                        <div class="ticket-field">
                            <span>EVENT DATE & VENUE</span>
                            <strong>${escapeHtml(p.eventDate || 'Auditorium')} • ${escapeHtml(p.eventVenue || 'Campus')}</strong>
                        </div>
                        <div class="ticket-field">
                            <span>GATE ENTRY</span>
                            <strong style="color:${p.checkedIn ? '#15803d' : '#92400e'}">
                                ${p.checkedIn ? `Admitted (${p.checkedInAt || ''})` : 'Valid / Not Arrived'}
                            </strong>
                        </div>
                    </div>
                </div>

                <div class="ticket-actions-row">
                    <a href="${p.qrImage}" download="EESA-${p.registrationId}.png" class="btn-ticket-download">
                        ⬇️ Download QR Pass
                    </a>
                </div>
            </div>
        `).join('');

        lookupResultsList.classList.remove('hidden');

    } catch (err) {
        showStatus('lookupMessage', err.message, 'error');
    } finally {
        lookupSubmitBtn.disabled = false;
    }
});

// ========================================
// MODAL HELPERS & UTILITIES
// ========================================

function openModal(id) {
    const el = document.getElementById(id);
    if (el) {
        el.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    }
}

function closeModal(id) {
    const el = document.getElementById(id);
    if (el) {
        el.classList.add('hidden');
        document.body.style.overflow = '';
    }
}

// Close on clicking overlay background or pressing ESC
document.querySelectorAll('.modal-overlay').forEach(modal => {
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.add('hidden');
            document.body.style.overflow = '';
        }
    });
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay').forEach(m => m.classList.add('hidden'));
        document.body.style.overflow = '';
    }
});

function showStatus(id, text, type) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.className = `status-msg ${type}`;
    el.classList.remove('hidden');
}

function hideStatus(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
}

function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}