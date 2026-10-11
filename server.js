const express = require("express");
const path = require("path");
const Razorpay = require("razorpay");
const Database = require("better-sqlite3");
const QRCode = require("qrcode");
const crypto = require("crypto");
const session = require("express-session");
const multer = require("multer");
const XLSX = require("xlsx");
require("dotenv").config();

const app = express();

// Security Headers Middleware
app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    next();
});

app.use(express.json({ limit: "100kb" }));

app.use(session({
    name: "eesa_admin_session",
    secret: process.env.SESSION_SECRET || "eesa_super_secret_session_key",
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 60 * 60 * 1000 // 1 hour session
    }
}));

app.use(express.static(path.join(__dirname, "public")));

const PORT = parseInt(process.env.PORT, 10) || 3000;
const ADMIN_PATH = (process.env.ADMIN_PATH || "/eesa-portal-2026").trim();

// Explicitly block standard admin paths to prevent discovery
app.use((req, res, next) => {
    if (
        req.path === "/admin" ||
        req.path === "/admin.html" ||
        req.path === "/admin.js" ||
        req.path === "/admin.css" ||
        req.path.startsWith("/admin/")
    ) {
        return res.status(404).send("404 Not Found");
    }
    next();
});

// Serve Admin Panel strictly at secret ADMIN_PATH from protected directory
app.get([ADMIN_PATH, ADMIN_PATH + "/"], (req, res) => {
    res.sendFile(path.join(__dirname, "private_admin", "admin.html"));
});

app.get(`${ADMIN_PATH}/admin.css`, (req, res) => {
    res.sendFile(path.join(__dirname, "private_admin", "admin.css"));
});

app.get(`${ADMIN_PATH}/admin.js`, (req, res) => {
    res.sendFile(path.join(__dirname, "private_admin", "admin.js"));
});

// ========================================
// DATABASE INITIALIZATION & OPTIMIZATIONS
// ========================================

const db = new Database(path.join(__dirname, "eesa.db"));

// Enable WAL mode & timeout for high-concurrency reliability
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");

// 1. Events Table
db.exec(`
    CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        tagline TEXT,
        category TEXT NOT NULL DEFAULT 'Technical',
        description TEXT NOT NULL,
        date TEXT NOT NULL,
        time TEXT,
        venue TEXT NOT NULL,
        fee_paise INTEGER NOT NULL DEFAULT 0,
        banner_url TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        restrict_eligibility INTEGER DEFAULT 1,
        rules TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
`);

// 2. Event-Specific Eligible Students Table
db.exec(`
    CREATE TABLE IF NOT EXISTS event_eligible_students (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL,
        college_id TEXT NOT NULL,
        uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(event_id, college_id)
    );
`);

// 3. Registrations Table
db.exec(`
    CREATE TABLE IF NOT EXISTS registrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER DEFAULT 1,
        registration_id TEXT UNIQUE,
        qr_number TEXT UNIQUE,
        qr_token TEXT UNIQUE,
        name TEXT NOT NULL,
        college_id TEXT NOT NULL,
        department TEXT NOT NULL,
        academic_year TEXT NOT NULL,
        mobile TEXT NOT NULL,
        razorpay_order_id TEXT UNIQUE,
        razorpay_payment_id TEXT UNIQUE,
        payment_amount INTEGER,
        payment_currency TEXT,
        payment_method TEXT,
        payment_status TEXT NOT NULL DEFAULT 'pending',
        checked_in INTEGER DEFAULT 0,
        checked_in_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        paid_at TEXT
    );
`);

// Safe migrations if tables were previously created without these columns
try { db.exec("ALTER TABLE registrations ADD COLUMN event_id INTEGER DEFAULT 1;"); } catch (e) {}
try { db.exec("ALTER TABLE registrations ADD COLUMN checked_in INTEGER DEFAULT 0;"); } catch (e) {}
try { db.exec("ALTER TABLE registrations ADD COLUMN checked_in_at TEXT;"); } catch (e) {}
try {
    db.exec("DROP INDEX IF EXISTS idx_registrations_college_id;");
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_registrations_event_college ON registrations(event_id, college_id);");
} catch (e) {}

// Razorpay Client Helper (Supports both test and live credentials)
function getRazorpay() {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (
        !keyId ||
        !keySecret ||
        (!keyId.startsWith("rzp_test_") && !keyId.startsWith("rzp_live_"))
    ) {
        return null;
    }

    return new Razorpay({
        key_id: keyId,
        key_secret: keySecret
    });
}

function normalizeCollegeId(value) {
    return String(value || "")
        .trim()
        .toUpperCase()
        .replace(/\s+/g, "");
}

function slugify(text) {
    return String(text || "")
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, "")
        .replace(/[\s_-]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

// Words to ignore during Excel / CSV upload so headers never get imported as student IDs
const IGNORED_HEADER_KEYWORDS = new Set([
    "COLLEGEID", "COLLEGE_ID", "COLLEGE ID",
    "STUDENTID", "STUDENT_ID", "STUDENT ID",
    "ID", "PRN", "PRNNO", "ROLLNO", "ROLL_NO",
    "NAME", "STUDENTNAME"
]);

// ========================================
// PUBLIC EVENT ENDPOINTS
// ========================================

// List all events
app.get("/api/events", (req, res) => {
    try {
        const events = db.prepare(`
            SELECT
                id,
                slug,
                title,
                tagline,
                category,
                description,
                date,
                time,
                venue,
                fee_paise,
                (fee_paise / 100.0) AS fee_rupees,
                banner_url,
                status,
                restrict_eligibility,
                rules,
                created_at
            FROM events
            ORDER BY id ASC
        `).all();

        res.json({
            success: true,
            events
        });
    } catch (err) {
        console.error("Fetch events error:", err.message);
        res.status(500).json({ success: false, message: "Unable to load events." });
    }
});

// Get single event details
app.get("/api/events/:idOrSlug", (req, res) => {
    try {
        const param = req.params.idOrSlug;
        const event = db.prepare(`
            SELECT
                id,
                slug,
                title,
                tagline,
                category,
                description,
                date,
                time,
                venue,
                fee_paise,
                (fee_paise / 100.0) AS fee_rupees,
                banner_url,
                status,
                restrict_eligibility,
                rules,
                created_at
            FROM events
            WHERE id = ? OR slug = ?
        `).get(param, param);

        if (!event) {
            return res.status(404).json({ success: false, message: "Event not found." });
        }

        // Count registrations
        const regStats = db.prepare(`
            SELECT
                COUNT(*) AS totalRegistrations,
                COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN 1 ELSE 0 END), 0) AS paidRegistrations
            FROM registrations
            WHERE event_id = ?
        `).get(event.id);

        res.json({
            success: true,
            event: {
                ...event,
                registrationsCount: regStats.paidRegistrations
            }
        });
    } catch (err) {
        console.error("Fetch event details error:", err.message);
        res.status(500).json({ success: false, message: "Unable to load event details." });
    }
});

// Public config endpoint
app.get("/api/config", (req, res) => {
    res.json({
        success: true,
        keyId: process.env.RAZORPAY_KEY_ID || ""
    });
});

// ========================================
// EESA ADMIN AUTHENTICATION
// ========================================

function requireAdmin(req, res, next) {
    if (!req.session || req.session.isAdmin !== true) {
        return res.status(401).json({
            success: false,
            message: "Admin login required."
        });
    }
    next();
}

app.post("/api/admin/login", (req, res, next) => {
    const { username, password } = req.body || {};

    if (
        !process.env.ADMIN_USERNAME ||
        !process.env.ADMIN_PASSWORD ||
        !process.env.SESSION_SECRET
    ) {
        return res.status(503).json({
            success: false,
            message: "Admin credentials are not configured in .env."
        });
    }

    if (
        username !== process.env.ADMIN_USERNAME ||
        password !== process.env.ADMIN_PASSWORD
    ) {
        return res.status(401).json({
            success: false,
            message: "Invalid username or password."
        });
    }

    req.session.regenerate((err) => {
        if (err) return next(err);

        req.session.isAdmin = true;
        req.session.save((saveError) => {
            if (saveError) return next(saveError);
            res.json({
                success: true,
                message: "Admin login successful."
            });
        });
    });
});

app.get("/api/admin/me", requireAdmin, (req, res) => {
    res.json({ success: true, authenticated: true });
});

app.post("/api/admin/logout", requireAdmin, (req, res, next) => {
    req.session.destroy((err) => {
        if (err) return next(err);
        res.clearCookie("eesa_admin_session");
        res.json({
            success: true,
            message: "Logged out successfully."
        });
    });
});

// ========================================
// ADMIN EVENT MANAGEMENT (POST, EDIT, DELETE)
// ========================================

// Get all events with stats for admin
app.get("/api/admin/events", requireAdmin, (req, res) => {
    try {
        const events = db.prepare(`
            SELECT
                e.*,
                (e.fee_paise / 100.0) AS fee_rupees,
                COUNT(r.id) AS total_registrations,
                COALESCE(SUM(CASE WHEN r.payment_status = 'paid' THEN 1 ELSE 0 END), 0) AS paid_registrations,
                COALESCE(SUM(CASE WHEN r.checked_in = 1 THEN 1 ELSE 0 END), 0) AS checked_in_count,
                (SELECT COUNT(*) FROM event_eligible_students WHERE event_id = e.id) AS eligible_students_count
            FROM events e
            LEFT JOIN registrations r ON r.event_id = e.id
            GROUP BY e.id
            ORDER BY e.id DESC
        `).all();

        res.json({ success: true, events });
    } catch (err) {
        console.error("Admin events error:", err.message);
        res.status(500).json({ success: false, message: "Error fetching events." });
    }
});

// Create new event
app.post("/api/admin/events", requireAdmin, (req, res) => {
    try {
        const {
            title,
            tagline,
            category,
            description,
            date,
            time,
            venue,
            feeInRupees,
            status,
            restrictEligibility,
            rules
        } = req.body || {};

        if (!title?.trim() || !description?.trim() || !date?.trim() || !venue?.trim()) {
            return res.status(400).json({
                success: false,
                message: "Title, description, date, and venue are required."
            });
        }

        const feeRupeesNum = Math.max(0, parseFloat(feeInRupees) || 0);
        const feePaise = Math.round(feeRupeesNum * 100);

        let eventSlug = slugify(title);
        // Ensure slug uniqueness
        const existing = db.prepare("SELECT id FROM events WHERE slug = ?").get(eventSlug);
        if (existing) {
            eventSlug = `${eventSlug}-${Date.now().toString().slice(-4)}`;
        }

        const insert = db.prepare(`
            INSERT INTO events (
                slug, title, tagline, category, description,
                date, time, venue, fee_paise, status,
                restrict_eligibility, rules
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const result = insert.run(
            eventSlug,
            title.trim(),
            tagline ? tagline.trim() : "",
            category ? category.trim() : "Technical",
            description.trim(),
            date.trim(),
            time ? time.trim() : "",
            venue.trim(),
            feePaise,
            status || "active",
            restrictEligibility ? 1 : 0,
            rules ? rules.trim() : ""
        );

        res.json({
            success: true,
            message: "Event created successfully!",
            eventId: result.lastInsertRowid
        });
    } catch (err) {
        console.error("Create event error:", err.message);
        res.status(500).json({ success: false, message: "Error creating event: " + err.message });
    }
});

// Update event
app.put("/api/admin/events/:id", requireAdmin, (req, res) => {
    try {
        const eventId = parseInt(req.params.id, 10);
        const {
            title,
            tagline,
            category,
            description,
            date,
            time,
            venue,
            feeInRupees,
            status,
            restrictEligibility,
            rules
        } = req.body || {};

        const existing = db.prepare("SELECT id FROM events WHERE id = ?").get(eventId);
        if (!existing) {
            return res.status(404).json({ success: false, message: "Event not found." });
        }

        const feeRupeesNum = Math.max(0, parseFloat(feeInRupees) || 0);
        const feePaise = Math.round(feeRupeesNum * 100);

        db.prepare(`
            UPDATE events
            SET title = ?,
                tagline = ?,
                category = ?,
                description = ?,
                date = ?,
                time = ?,
                venue = ?,
                fee_paise = ?,
                status = ?,
                restrict_eligibility = ?,
                rules = ?
            WHERE id = ?
        `).run(
            title.trim(),
            tagline ? tagline.trim() : "",
            category ? category.trim() : "Technical",
            description.trim(),
            date.trim(),
            time ? time.trim() : "",
            venue.trim(),
            feePaise,
            status || "active",
            restrictEligibility ? 1 : 0,
            rules ? rules.trim() : "",
            eventId
        );

        res.json({
            success: true,
            message: "Event updated successfully!"
        });
    } catch (err) {
        console.error("Update event error:", err.message);
        res.status(500).json({ success: false, message: "Error updating event: " + err.message });
    }
});

// Delete event (only if no paid registrations)
app.delete("/api/admin/events/:id", requireAdmin, (req, res) => {
    try {
        const eventId = parseInt(req.params.id, 10);

        const paidCount = db.prepare(`
            SELECT COUNT(*) AS count
            FROM registrations
            WHERE event_id = ? AND payment_status = 'paid'
        `).get(eventId);

        if (paidCount.count > 0) {
            return res.status(400).json({
                success: false,
                message: `Cannot delete event with ${paidCount.count} paid registration(s). Set status to 'closed' instead.`
            });
        }

        db.prepare("DELETE FROM event_eligible_students WHERE event_id = ?").run(eventId);
        db.prepare("DELETE FROM registrations WHERE event_id = ?").run(eventId);
        db.prepare("DELETE FROM events WHERE id = ?").run(eventId);

        res.json({ success: true, message: "Event deleted successfully." });
    } catch (err) {
        console.error("Delete event error:", err.message);
        res.status(500).json({ success: false, message: "Error deleting event: " + err.message });
    }
});

// ========================================
// EXCEL / CSV ELIGIBLE STUDENTS UPLOAD (PER EVENT)
// ========================================

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, callback) => {
        const allowedExtensions = /\.(xlsx|xls|csv)$/i;
        if (!allowedExtensions.test(file.originalname)) {
            return callback(new Error("Upload an Excel (.xlsx/.xls) or CSV file."));
        }
        callback(null, true);
    }
});

app.post(
    "/api/admin/upload-students",
    requireAdmin,
    upload.single("studentFile"),
    (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    message: "Please select an Excel or CSV file."
                });
            }

            const eventId = parseInt(req.body.eventId, 10) || 1;
            const event = db.prepare("SELECT id, title FROM events WHERE id = ?").get(eventId);
            if (!event) {
                return res.status(404).json({ success: false, message: "Selected event not found." });
            }

            const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];

            if (!firstSheet) {
                return res.status(400).json({
                    success: false,
                    message: "The file contains no worksheet."
                });
            }

            const rows = XLSX.utils.sheet_to_json(firstSheet, {
                header: 1,
                defval: "",
                raw: false
            });

            if (!rows.length) {
                return res.status(400).json({
                    success: false,
                    message: "The uploaded file is empty."
                });
            }

            // Detect column header
            const firstRow = rows[0].map(value =>
                String(value).trim().toLowerCase().replace(/[\s_-]+/g, "")
            );

            const headerNames = ["collegeid", "studentid", "id", "prn", "prnno", "rollno"];
            let columnIndex = firstRow.findIndex(value => headerNames.includes(value));
            let startRow = 0;

            if (columnIndex !== -1) {
                startRow = 1;
            } else {
                columnIndex = 0;
                const topVal = String(rows[0][0] || "").trim().toUpperCase().replace(/[\s_-]+/g, "");
                if (IGNORED_HEADER_KEYWORDS.has(topVal)) {
                    startRow = 1;
                }
            }

            const rawIds = rows.slice(startRow).map(row => normalizeCollegeId(row[columnIndex]));
            const collegeIds = [
                ...new Set(
                    rawIds.filter(id =>
                        id.length > 0 &&
                        id.length <= 100 &&
                        !IGNORED_HEADER_KEYWORDS.has(id)
                    )
                )
            ];

            if (!collegeIds.length) {
                return res.status(400).json({
                    success: false,
                    message: "No valid College IDs found in the uploaded file."
                });
            }

            const insertStudent = db.prepare(`
                INSERT OR IGNORE INTO event_eligible_students (event_id, college_id)
                VALUES (?, ?)
            `);

            const importStudents = db.transaction(ids => {
                let added = 0;
                for (const id of ids) {
                    const result = insertStudent.run(eventId, id);
                    added += result.changes;
                }
                return added;
            });

            const added = importStudents(collegeIds);

            res.json({
                success: true,
                message: `Imported eligible students for "${event.title}".`,
                validIdsInFile: collegeIds.length,
                newlyAdded: added,
                alreadyExisted: collegeIds.length - added
            });

        } catch (error) {
            console.error("Student upload error:", error.message);
            res.status(400).json({
                success: false,
                message: "Unable to process file: " + error.message
            });
        }
    }
);

// Count of eligible students for an event
app.get("/api/admin/eligible-count", requireAdmin, (req, res) => {
    const eventId = req.query.eventId ? parseInt(req.query.eventId, 10) : null;
    let result;

    if (eventId) {
        result = db.prepare(`
            SELECT COUNT(*) AS total
            FROM event_eligible_students
            WHERE event_id = ?
        `).get(eventId);
    } else {
        result = db.prepare(`
            SELECT COUNT(*) AS total
            FROM event_eligible_students
        `).get();
    }

    res.json({
        success: true,
        totalEligibleStudents: result.total
    });
});

// ========================================
// ADMIN OVERVIEW & REGISTRATIONS
// ========================================

app.get("/api/admin/overview", requireAdmin, (req, res) => {
    try {
        const eventId = req.query.eventId ? parseInt(req.query.eventId, 10) : null;

        let statsQuery = `
            SELECT
                COUNT(*) AS totalRegistrations,
                COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN 1 ELSE 0 END), 0) AS successfulPayments,
                COALESCE(SUM(CASE WHEN payment_status = 'pending' THEN 1 ELSE 0 END), 0) AS pendingPayments,
                COALESCE(SUM(CASE WHEN checked_in = 1 THEN 1 ELSE 0 END), 0) AS checkedInCount,
                COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN payment_amount ELSE 0 END), 0) AS totalRevenuePaise
            FROM registrations
        `;
        let eligibleQuery = `SELECT COUNT(*) AS total FROM event_eligible_students`;

        if (eventId) {
            statsQuery += ` WHERE event_id = ${eventId}`;
            eligibleQuery += ` WHERE event_id = ${eventId}`;
        }

        const stats = db.prepare(statsQuery).get();
        const eligible = db.prepare(eligibleQuery).get();

        const totalEvents = db.prepare("SELECT COUNT(*) AS count FROM events").get().count;

        res.json({
            success: true,
            totalRegistrations: stats.totalRegistrations,
            successfulPayments: stats.successfulPayments,
            pendingPayments: stats.pendingPayments,
            checkedInCount: stats.checkedInCount,
            totalRevenueRupees: (stats.totalRevenuePaise / 100.0).toFixed(2),
            eligibleStudents: eligible.total,
            totalEvents
        });
    } catch (error) {
        console.error("Dashboard overview error:", error.message);
        res.status(500).json({ success: false, message: "Unable to load dashboard statistics." });
    }
});

// Get registrations list (filterable by eventId and search query)
app.get("/api/admin/registrations", requireAdmin, (req, res) => {
    try {
        const search = String(req.query.search || "").trim().slice(0, 100);
        const eventId = req.query.eventId ? parseInt(req.query.eventId, 10) : null;

        let query = `
            SELECT
                r.id,
                r.event_id,
                e.title AS event_title,
                r.registration_id,
                r.name,
                r.college_id,
                r.department,
                r.academic_year,
                r.mobile,
                r.razorpay_payment_id,
                r.payment_amount,
                r.payment_currency,
                r.payment_method,
                r.payment_status,
                r.checked_in,
                r.checked_in_at,
                r.created_at,
                r.paid_at
            FROM registrations r
            LEFT JOIN events e ON e.id = r.event_id
            WHERE (
                r.name LIKE ?
                OR r.college_id LIKE ?
                OR COALESCE(r.registration_id, '') LIKE ?
                OR r.mobile LIKE ?
            )
        `;

        const params = [
            `%${search}%`,
            `%${search}%`,
            `%${search}%`,
            `%${search}%`
        ];

        if (eventId) {
            query += " AND r.event_id = ?";
            params.push(eventId);
        }

        query += " ORDER BY r.id DESC LIMIT 500";

        const students = db.prepare(query).all(...params);

        res.json({
            success: true,
            total: students.length,
            students
        });
    } catch (error) {
        console.error("Registration list error:", error.message);
        res.status(500).json({ success: false, message: "Unable to load registrations." });
    }
});

// ========================================
// GATE SCANNER & ENTRY VERIFICATION
// ========================================

app.post("/api/admin/verify-entry", requireAdmin, (req, res) => {
    try {
        let { code, eventId } = req.body || {};
        if (!code) {
            return res.status(400).json({
                success: false,
                message: "Please enter or scan a pass identifier (Registration ID, QR Number, or Token)."
            });
        }

        code = String(code).trim();
        let searchRegId = code;
        let searchQrNum = code;
        let searchToken = code;

        if (code.startsWith("{") && code.endsWith("}")) {
            try {
                const parsed = JSON.parse(code);
                if (parsed.registrationId) searchRegId = parsed.registrationId;
                if (parsed.qrNumber) searchQrNum = parsed.qrNumber;
                if (parsed.token) searchToken = parsed.token;
                if (parsed.eventId && !eventId) eventId = parsed.eventId;
            } catch (e) {}
        }

        let studentQuery = `
            SELECT r.*, e.title AS event_title
            FROM registrations r
            LEFT JOIN events e ON e.id = r.event_id
            WHERE (
                r.registration_id = ?
                OR r.qr_number = ?
                OR r.qr_token = ?
                OR r.college_id = ?
            )
        `;
        const params = [searchRegId, searchQrNum, searchToken, normalizeCollegeId(code)];

        if (eventId) {
            studentQuery += " AND r.event_id = ?";
            params.push(parseInt(eventId, 10));
        }

        const student = db.prepare(studentQuery).get(...params);

        if (!student) {
            return res.status(404).json({
                success: false,
                message: "Pass not found. No matching registration record."
            });
        }

        if (student.payment_status !== "paid") {
            return res.status(400).json({
                success: false,
                message: `Payment is not completed (Status: ${student.payment_status}). Entry denied.`,
                student: {
                    name: student.name,
                    collegeId: student.college_id,
                    eventTitle: student.event_title,
                    paymentStatus: student.payment_status
                }
            });
        }

        if (student.checked_in === 1) {
            return res.status(409).json({
                success: false,
                alreadyCheckedIn: true,
                message: `ALREADY CHECKED IN! Entry was recorded at ${student.checked_in_at}.`,
                student: {
                    name: student.name,
                    collegeId: student.college_id,
                    department: student.department,
                    academicYear: student.academic_year,
                    eventTitle: student.event_title,
                    registrationId: student.registration_id,
                    checkedInAt: student.checked_in_at
                }
            });
        }

        const checkInTime = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
        db.prepare(`
            UPDATE registrations
            SET checked_in = 1,
                checked_in_at = ?
            WHERE id = ?
        `).run(checkInTime, student.id);

        res.json({
            success: true,
            message: `ENTRY APPROVED for "${student.event_title}"!`,
            student: {
                name: student.name,
                collegeId: student.college_id,
                department: student.department,
                academicYear: student.academic_year,
                eventTitle: student.event_title,
                registrationId: student.registration_id,
                checkedInAt: checkInTime
            }
        });

    } catch (error) {
        console.error("Gate verification error:", error.message);
        res.status(500).json({ success: false, message: "Error verifying gate pass." });
    }
});

// Admin Check-in Reset
app.post("/api/admin/reset-checkin", requireAdmin, (req, res) => {
    try {
        const { id } = req.body || {};
        if (!id) {
            return res.status(400).json({ success: false, message: "Missing registration ID." });
        }

        db.prepare(`
            UPDATE registrations
            SET checked_in = 0,
                checked_in_at = NULL
            WHERE id = ?
        `).run(id);

        res.json({ success: true, message: "Check-in status reset successfully." });
    } catch (error) {
        console.error("Reset check-in error:", error.message);
        res.status(500).json({ success: false, message: "Unable to reset check-in." });
    }
});

// Export to Excel (Per event or all)
app.get("/api/admin/export-registrations", requireAdmin, (req, res) => {
    try {
        const eventId = req.query.eventId ? parseInt(req.query.eventId, 10) : null;

        let query = `
            SELECT
                r.id,
                e.title AS event_title,
                r.name,
                r.college_id,
                r.department,
                r.academic_year,
                r.mobile,
                r.payment_status,
                r.registration_id,
                r.qr_number,
                r.razorpay_payment_id,
                r.payment_amount,
                r.payment_method,
                r.checked_in,
                r.checked_in_at,
                r.paid_at,
                r.created_at
            FROM registrations r
            LEFT JOIN events e ON e.id = r.event_id
        `;
        const params = [];

        if (eventId) {
            query += " WHERE r.event_id = ?";
            params.push(eventId);
        }

        query += " ORDER BY r.id DESC";

        const rows = db.prepare(query).all(...params);

        const exportData = rows.map((r, index) => ({
            "Sr No": index + 1,
            "Event": r.event_title || "General Event",
            "Full Name": r.name,
            "College ID": r.college_id,
            "Department": r.department,
            "Academic Year": r.academic_year,
            "Mobile Number": r.mobile,
            "Payment Status": r.payment_status.toUpperCase(),
            "Registration ID": r.registration_id || "N/A",
            "QR Number": r.qr_number || "N/A",
            "Razorpay Payment ID": r.razorpay_payment_id || "N/A",
            "Amount (INR)": r.payment_amount ? (r.payment_amount / 100).toFixed(2) : "0.00",
            "Payment Mode": r.payment_method || "N/A",
            "Gate Checked In": r.checked_in === 1 ? "YES" : "NO",
            "Checked In Time": r.checked_in_at || "Not Arrived",
            "Payment Time": r.paid_at || "N/A",
            "Registered At": r.created_at
        }));

        const worksheet = XLSX.utils.json_to_sheet(exportData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Registrations");

        const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

        const filename = eventId
            ? `EESA_Event_${eventId}_Registrations.xlsx`
            : "EESA_All_Events_Registrations.xlsx";

        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.send(buffer);

    } catch (error) {
        console.error("Export error:", error.message);
        res.status(500).json({ success: false, message: "Unable to generate Excel file." });
    }
});

// ========================================
// STUDENT REGISTRATION & PAYMENT FLOW
// ========================================

// STEP 1: Register student for a specific event
app.post("/api/create-order", async (req, res) => {
    try {
        const {
            eventId,
            name,
            collegeId,
            department,
            year,
            mobile
        } = req.body || {};

        if (
            !eventId ||
            !name?.trim() ||
            !collegeId?.trim() ||
            !department?.trim() ||
            !year?.trim() ||
            !/^[0-9]{10}$/.test(mobile || "")
        ) {
            return res.status(400).json({
                error: "Please select an event and fill all details with a 10-digit mobile number."
            });
        }

        const targetEvent = db.prepare("SELECT * FROM events WHERE id = ?").get(parseInt(eventId, 10));
        if (!targetEvent) {
            return res.status(404).json({ error: "Selected event does not exist." });
        }

        if (targetEvent.status !== "active") {
            return res.status(400).json({
                error: `Registrations are currently ${targetEvent.status.toUpperCase()} for this event.`
            });
        }

        const normalizedCollegeId = normalizeCollegeId(collegeId);

        // Check event eligibility if restricted
        if (targetEvent.restrict_eligibility === 1) {
            const isEligible = db.prepare(`
                SELECT college_id
                FROM event_eligible_students
                WHERE event_id = ? AND college_id = ?
            `).get(targetEvent.id, normalizedCollegeId);

            if (!isEligible) {
                return res.status(403).json({
                    error: `Your College ID (${normalizedCollegeId}) is not on the approved eligible list for "${targetEvent.title}". Please contact EESA committee coordinators.`
                });
            }
        }

        // Check existing registration for this specific event
        const existingRegistration = db.prepare(`
            SELECT id, payment_status, razorpay_order_id
            FROM registrations
            WHERE event_id = ? AND college_id = ?
        `).get(targetEvent.id, normalizedCollegeId);

        if (existingRegistration && existingRegistration.payment_status === "paid") {
            return res.status(409).json({
                error: `You are already registered and confirmed for "${targetEvent.title}". Use 'Find My Pass' to download your QR ticket.`
            });
        }

        const feeAmount = targetEvent.fee_paise;

        // FREE EVENT HANDLING (If fee is ₹0)
        if (feeAmount === 0) {
            const registrationId = "EESA-" + crypto.randomUUID().slice(0, 8).toUpperCase();
            const qrNumber = "QR-" + crypto.randomUUID().toUpperCase();
            const qrToken = crypto.randomBytes(32).toString("hex");

            const qrData = JSON.stringify({
                eventId: targetEvent.id,
                registrationId,
                qrNumber,
                token: qrToken
            });
            const qrImage = await QRCode.toDataURL(qrData);

            if (existingRegistration) {
                db.prepare(`
                    UPDATE registrations
                    SET registration_id = ?,
                        qr_number = ?,
                        qr_token = ?,
                        payment_status = 'paid',
                        payment_amount = 0,
                        paid_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `).run(registrationId, qrNumber, qrToken, existingRegistration.id);
            } else {
                db.prepare(`
                    INSERT INTO registrations (
                        event_id, name, college_id, department, academic_year, mobile,
                        registration_id, qr_number, qr_token, payment_amount,
                        payment_currency, payment_method, payment_status, paid_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'INR', 'free', 'paid', CURRENT_TIMESTAMP)
                `).run(
                    targetEvent.id, name.trim(), normalizedCollegeId, department.trim(),
                    year.trim(), mobile.trim(), registrationId, qrNumber, qrToken
                );
            }

            return res.json({
                freeEvent: true,
                success: true,
                registrationId,
                qrNumber,
                qrImage,
                eventTitle: targetEvent.title,
                message: "Registration confirmed! Your free entry pass is ready."
            });
        }

        // PAID EVENT (Razorpay Order Creation)
        const razorpay = getRazorpay();
        if (!razorpay) {
            return res.status(503).json({
                error: "Razorpay credentials are not configured in .env."
            });
        }

        const receipt = "eesa_" + crypto.randomUUID().slice(0, 18);
        const order = await razorpay.orders.create({
            amount: feeAmount,
            currency: "INR",
            receipt
        });

        if (existingRegistration && existingRegistration.payment_status === "pending") {
            db.prepare(`
                UPDATE registrations
                SET name = ?,
                    department = ?,
                    academic_year = ?,
                    mobile = ?,
                    razorpay_order_id = ?,
                    payment_amount = ?,
                    payment_currency = 'INR',
                    created_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(
                name.trim(), department.trim(), year.trim(), mobile.trim(),
                order.id, feeAmount, existingRegistration.id
            );

            return res.json({
                orderId: order.id,
                amount: order.amount,
                currency: order.currency,
                keyId: process.env.RAZORPAY_KEY_ID,
                eventTitle: targetEvent.title,
                registrationRecord: existingRegistration.id
            });
        }

        const insertResult = db.prepare(`
            INSERT INTO registrations (
                event_id, name, college_id, department, academic_year,
                mobile, razorpay_order_id, payment_amount, payment_currency, payment_status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'INR', 'pending')
        `).run(
            targetEvent.id, name.trim(), normalizedCollegeId, department.trim(),
            year.trim(), mobile.trim(), order.id, feeAmount
        );

        res.json({
            orderId: order.id,
            amount: order.amount,
            currency: order.currency,
            keyId: process.env.RAZORPAY_KEY_ID,
            eventTitle: targetEvent.title,
            registrationRecord: insertResult.lastInsertRowid
        });

    } catch (error) {
        console.error("Create order error:", error.message);
        res.status(500).json({ error: "Unable to process registration: " + error.message });
    }
});

// STEP 2: Verify payment and generate QR pass
app.post("/api/verify-payment", async (req, res) => {
    try {
        const razorpay = getRazorpay();
        if (!razorpay) {
            return res.status(503).json({ success: false, message: "Razorpay credentials not configured." });
        }

        const {
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature
        } = req.body || {};

        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            return res.status(400).json({ success: false, message: "Missing payment verification parameters." });
        }

        // HMAC SHA256 timing-safe verification
        const expectedSignature = crypto
            .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
            .update(razorpay_order_id + "|" + razorpay_payment_id)
            .digest("hex");

        const isSignatureValid = (
            typeof razorpay_signature === "string" &&
            razorpay_signature.length === expectedSignature.length &&
            crypto.timingSafeEqual(Buffer.from(razorpay_signature), Buffer.from(expectedSignature))
        );

        if (!isSignatureValid) {
            return res.status(400).json({ success: false, message: "Payment signature verification failed." });
        }

        const registration = db.prepare(`
            SELECT r.*, e.title AS event_title, e.fee_paise
            FROM registrations r
            LEFT JOIN events e ON e.id = r.event_id
            WHERE r.razorpay_order_id = ?
        `).get(razorpay_order_id);

        if (!registration) {
            return res.status(404).json({ success: false, message: "Order record not found." });
        }

        if (registration.payment_status === "paid") {
            const qrData = JSON.stringify({
                eventId: registration.event_id,
                registrationId: registration.registration_id,
                qrNumber: registration.qr_number,
                token: registration.qr_token
            });

            return res.json({
                success: true,
                registrationId: registration.registration_id,
                qrNumber: registration.qr_number,
                eventTitle: registration.event_title,
                qrImage: await QRCode.toDataURL(qrData),
                message: "Payment already verified."
            });
        }

        const payment = await razorpay.payments.fetch(razorpay_payment_id);
        if (
            payment.order_id !== razorpay_order_id ||
            payment.amount !== registration.payment_amount ||
            payment.currency !== "INR"
        ) {
            return res.status(400).json({ success: false, message: "Payment details do not match expected order." });
        }

        if (payment.status === "authorized") {
            try {
                await razorpay.payments.capture(razorpay_payment_id, registration.payment_amount, "INR");
            } catch (e) {}
        } else if (payment.status !== "captured") {
            return res.status(400).json({
                success: false,
                message: `Payment status is '${payment.status}'. If money was deducted, contact committee coordinators.`
            });
        }

        const registrationId = "EESA-" + crypto.randomUUID().slice(0, 8).toUpperCase();
        const qrNumber = "QR-" + crypto.randomUUID().toUpperCase();
        const qrToken = crypto.randomBytes(32).toString("hex");

        const qrData = JSON.stringify({
            eventId: registration.event_id,
            registrationId,
            qrNumber,
            token: qrToken
        });
        const qrImage = await QRCode.toDataURL(qrData);

        db.prepare(`
            UPDATE registrations
            SET registration_id = ?,
                qr_number = ?,
                qr_token = ?,
                razorpay_payment_id = ?,
                payment_currency = ?,
                payment_method = ?,
                payment_status = 'paid',
                paid_at = CURRENT_TIMESTAMP
            WHERE razorpay_order_id = ?
        `).run(
            registrationId,
            qrNumber,
            qrToken,
            payment.id,
            payment.currency,
            payment.method || "online",
            razorpay_order_id
        );

        res.json({
            success: true,
            registrationId,
            qrNumber,
            qrImage,
            eventTitle: registration.event_title,
            name: registration.name,
            collegeId: registration.college_id,
            department: registration.department,
            academicYear: registration.academic_year,
            message: `Payment confirmed for "${registration.event_title}"! Entry pass is generated.`
        });

    } catch (error) {
        console.error("Verify payment error:", error.message);
        res.status(500).json({ success: false, message: "Verification failed: " + error.message });
    }
});

// ========================================
// FIND / RETRIEVE EXISTING PASSES
// ========================================

app.post("/api/find-pass", async (req, res) => {
    try {
        const { collegeId, mobile, eventId } = req.body || {};

        if (!collegeId?.trim() || !mobile?.trim()) {
            return res.status(400).json({
                success: false,
                message: "Please enter both College ID and Mobile Number."
            });
        }

        const normalizedCollegeId = normalizeCollegeId(collegeId);
        const cleanMobile = mobile.trim();

        let query = `
            SELECT r.*, e.title AS event_title, e.date AS event_date, e.venue AS event_venue
            FROM registrations r
            LEFT JOIN events e ON e.id = r.event_id
            WHERE r.college_id = ?
              AND r.mobile = ?
              AND r.payment_status = 'paid'
        `;
        const params = [normalizedCollegeId, cleanMobile];

        if (eventId) {
            query += " AND r.event_id = ?";
            params.push(parseInt(eventId, 10));
        }

        query += " ORDER BY r.id DESC";

        const passes = db.prepare(query).all(...params);

        if (!passes.length) {
            return res.status(404).json({
                success: false,
                message: "No confirmed event passes found matching this College ID and Mobile Number."
            });
        }

        // Attach QR data URL to each pass
        const enrichedPasses = await Promise.all(passes.map(async (p) => {
            const qrData = JSON.stringify({
                eventId: p.event_id,
                registrationId: p.registration_id,
                qrNumber: p.qr_number,
                token: p.qr_token
            });
            return {
                name: p.name,
                collegeId: p.college_id,
                department: p.department,
                academicYear: p.academic_year,
                registrationId: p.registration_id,
                qrNumber: p.qr_number,
                eventTitle: p.event_title,
                eventDate: p.event_date,
                eventVenue: p.event_venue,
                paidAt: p.paid_at,
                checkedIn: p.checked_in === 1,
                checkedInAt: p.checked_in_at,
                qrImage: await QRCode.toDataURL(qrData)
            };
        }));

        res.json({
            success: true,
            totalPasses: enrichedPasses.length,
            passes: enrichedPasses
        });

    } catch (error) {
        console.error("Find pass error:", error.message);
        res.status(500).json({ success: false, message: "Error retrieving passes: " + error.message });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`EESA Website running at http://localhost:${PORT}`);
    console.log(`Admin Portal accessible at http://localhost:${PORT}${ADMIN_PATH}`);
});