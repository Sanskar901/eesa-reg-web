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

app.use(express.json({ limit: "100kb" }));

app.use(session({
    name: "eesa_admin_session",
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 30 * 60 * 1000
    }
}));

app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const PAYMENT_AMOUNT = 200; // ₹2 in paise

// Connect to SQLite database
const db = new Database("eesa.db");

//store eligible College Ids

db.exec('CREATE TABLE IF NOT EXISTS eligible_students(college_id TEXT PRIMARY KEY, uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP);');


// TRACK wheather each College Id has already registered
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_registrations_college_id ON registrations(college_id)');

db.exec(`
    CREATE TABLE IF NOT EXISTS registrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        paid_at TEXT
    );
`);

function getRazorpay() {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (
        !keyId ||
        !keySecret ||
        !keyId.startsWith("rzp_test_")
    ) {
        return null;
    }

    return new Razorpay({
        key_id: keyId,
        key_secret: keySecret
    });
}

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

// Admin login
app.post("/api/admin/login", (req, res, next) => {
    const { username, password } = req.body || {};

    if (
        !process.env.ADMIN_USERNAME ||
        !process.env.ADMIN_PASSWORD ||
        !process.env.SESSION_SECRET
    ) {
        return res.status(503).json({
            success: false,
            message: "Admin credentials are not configured."
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

// Check current admin session
app.get("/api/admin/me", requireAdmin, (req, res) => {
    res.json({ success: true, authenticated: true });
});

// Admin logout
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
// EXCEL / CSV STUDENT LIST UPLOAD
// ========================================

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 2 * 1024 * 1024,
        files: 1
    },
    fileFilter: (req, file, callback) => {
        const allowedExtensions = /\.(xlsx|xls|csv)$/i;

        if (!allowedExtensions.test(file.originalname)) {
            return callback(
                new Error("Upload an Excel (.xlsx/.xls) or CSV file.")
            );
        }

        callback(null, true);
    }
});

function normalizeCollegeId(value) {
    return String(value || "")
        .trim()
        .toUpperCase()
        .replace(/\s+/g, "");
}

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

            const workbook = XLSX.read(req.file.buffer, {
                type: "buffer"
            });

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

            // Accept common header names.
            const firstRow = rows[0].map(value =>
                String(value).trim().toLowerCase().replace(/[\s_-]+/g, "")
            );

            const headerNames = [
                "collegeid",
                "studentid",
                "id"
            ];

            let columnIndex = firstRow.findIndex(value =>
                headerNames.includes(value)
            );

            let startRow = 0;

            // If a header is present, skip it.
            if (columnIndex !== -1) {
                startRow = 1;
            } else {
                // Otherwise, read IDs from the first column.
                columnIndex = 0;

                if (
                    ["college id", "college_id", "student id", "id"]
                        .includes(String(rows[0][0] || "").trim().toLowerCase())
                ) {
                    startRow = 1;
                }
            }

            const collegeIds = [
                ...new Set(
                    rows
                        .slice(startRow)
                        .map(row => normalizeCollegeId(row[columnIndex]))
                        .filter(id => id.length > 0 && id.length <= 100)
                )
            ];

            if (!collegeIds.length) {
                return res.status(400).json({
                    success: false,
                    message: "No valid College IDs were found."
                });
            }

            // Add new IDs without deleting existing eligible students.
            const insertStudent = db.prepare(`
                INSERT OR IGNORE INTO eligible_students (college_id)
                VALUES (?)
            `);

            const importStudents = db.transaction(ids => {
                let added = 0;

                for (const id of ids) {
                    const result = insertStudent.run(id);
                    added += result.changes;
                }

                return added;
            });

            const added = importStudents(collegeIds);

            res.json({
                success: true,
                message: "Student list imported successfully.",
                validIdsInFile: collegeIds.length,
                newlyAdded: added,
                alreadyExisted: collegeIds.length - added
            });

        } catch (error) {
            console.error("Student upload error:", error.message);

            res.status(400).json({
                success: false,
                message: "Unable to process this file. Check its format."
            });
        }
    }
);


// Number of eligible students
app.get(
    "/api/admin/eligible-count",
    requireAdmin,
    (req, res) => {
        const result = db.prepare(`
            SELECT COUNT(*) AS total
            FROM eligible_students
        `).get();

        res.json({
            success: true,
            totalEligibleStudents: result.total
        });
    }
);


// ========================================
// ADMIN DASHBOARD STATISTICS
// ========================================

app.get("/api/admin/overview", requireAdmin, (req, res) => {
    try {
        const stats = db.prepare(`
            SELECT
                COUNT(*) AS totalRegistrations,
                COALESCE(SUM(
                    CASE WHEN payment_status = 'paid'
                    THEN 1 ELSE 0 END
                ), 0) AS successfulPayments,
                COALESCE(SUM(
                    CASE WHEN payment_status = 'pending'
                    THEN 1 ELSE 0 END
                ), 0) AS pendingPayments
            FROM registrations
        `).get();

        const eligible = db.prepare(`
            SELECT COUNT(*) AS total
            FROM eligible_students
        `).get();

        res.json({
            success: true,
            totalRegistrations: stats.totalRegistrations,
            successfulPayments: stats.successfulPayments,
            pendingPayments: stats.pendingPayments,
            eligibleStudents: eligible.total
        });
    } catch (error) {
        console.error("Dashboard statistics error:", error.message);

        res.status(500).json({
            success: false,
            message: "Unable to load dashboard statistics."
        });
    }
});


// ========================================
// ADMIN STUDENT MANAGEMENT
// ========================================

app.get("/api/admin/registrations", requireAdmin, (req, res) => {
    try {
        const search = String(req.query.search || "")
            .trim()
            .slice(0, 100);

        const students = db.prepare(`
            SELECT
                id,
                registration_id,
                name,
                college_id,
                department,
                academic_year,
                mobile,
                razorpay_payment_id,
                payment_amount,
                payment_currency,
                payment_method,
                payment_status,
                created_at,
                paid_at
            FROM registrations
            WHERE
                name LIKE ?
                OR college_id LIKE ?
                OR COALESCE(registration_id, '') LIKE ?
            ORDER BY id DESC
            LIMIT 500
        `).all(
            `%${search}%`,
            `%${search}%`,
            `%${search}%`
        );

        res.json({
            success: true,
            total: students.length,
            students
        });
    } catch (error) {
        console.error("Registration list error:", error.message);

        res.status(500).json({
            success: false,
            message: "Unable to load registrations."
        });
    }
});






// STEP 1: Register student and create payment order

app.post("/api/create-order", async (req, res) => {
    try {
        const razorpay = getRazorpay();

        if (!razorpay) {
            return res.status(503).json({
                error: "Configure valid Razorpay Test Mode keys first."
            });
        }

        const {
            name,
            collegeId,
            department,
            year,
            mobile
        } = req.body;

        if (
            !name?.trim() ||
            !collegeId?.trim() ||
            !department?.trim() ||
            !year?.trim() ||
            !/^[0-9]{10}$/.test(mobile || "")
        ) {
            return res.status(400).json({
                error: "Please provide valid student details."
            });
        }


        // Normalize the College ID for consistent matching.
        const normalizedCollegeId = normalizeCollegeId(collegeId);

        // Check eligibility before creating a Razorpay order.
        const eligibleStudent = db.prepare(`
    SELECT college_id
    FROM eligible_students
    WHERE college_id = ?
`).get(normalizedCollegeId);

        if (!eligibleStudent) {
            return res.status(403).json({
                success: false,
                error: "Your College ID is not on the eligible student list."
            });
        }

        // Prevent duplicate registrations.
        const existingRegistration = db.prepare(`
    SELECT payment_status
    FROM registrations
    WHERE college_id = ?
`).get(normalizedCollegeId);

        if (existingRegistration) {
            return res.status(409).json({
                success: false,
                error: "This College ID has already been used for registration."
            });
        }

        // Create a unique receipt for this order
        const receipt = "eesa_" + crypto.randomUUID();

        const order = await razorpay.orders.create({
            amount: PAYMENT_AMOUNT,
            currency: "INR",
            receipt
        });

        // Store the registration as pending until payment is verified
        const result = db.prepare(`
            INSERT INTO registrations (
                name,
                college_id,
                department,
                academic_year,
                mobile,
                razorpay_order_id,
                payment_amount,
                payment_currency,
                payment_status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, 'INR', 'pending')
        `).run(
            name.trim(),
            normalizedCollegeId,
            department.trim(),
            year.trim(),
            mobile,
            order.id,
            PAYMENT_AMOUNT
        );

        res.json({
            orderId: order.id,
            amount: order.amount,
            currency: order.currency,
            keyId: process.env.RAZORPAY_KEY_ID,
            registrationRecord: result.lastInsertRowid
        });

    } catch (error) {
        console.error("Create order error:", error.message);

        res.status(500).json({
            error: "Unable to create registration or payment order."
        });
    }
});

// STEP 2: Verify payment and generate the unique QR code
app.post("/api/verify-payment", async (req, res) => {
    try {
        const razorpay = getRazorpay();

        if (!razorpay) {
            return res.status(503).json({
                success: false,
                message: "Razorpay Test Mode keys are not configured."
            });
        }

        const {
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature
        } = req.body;

        if (
            !razorpay_order_id ||
            !razorpay_payment_id ||
            !razorpay_signature
        ) {
            return res.status(400).json({
                success: false,
                message: "Missing payment details."
            });
        }

        // Verify Razorpay's payment signature
        const expectedSignature = crypto
            .createHmac(
                "sha256",
                process.env.RAZORPAY_KEY_SECRET
            )
            .update(
                razorpay_order_id + "|" + razorpay_payment_id
            )
            .digest("hex");

        const received = Buffer.from(razorpay_signature, "hex");
        const expected = Buffer.from(expectedSignature, "hex");

        if (
            received.length !== expected.length ||
            !crypto.timingSafeEqual(received, expected)
        ) {
            return res.status(400).json({
                success: false,
                message: "Payment signature verification failed."
            });
        }

        // Find the original registration and order
        const registration = db.prepare(`
            SELECT * FROM registrations
            WHERE razorpay_order_id = ?
        `).get(razorpay_order_id);

        if (!registration) {
            return res.status(404).json({
                success: false,
                message: "Registration not found."
            });
        }

        // Don't issue a second QR code for an already-paid order
        if (registration.payment_status === "paid") {
            if (
                registration.razorpay_payment_id !== razorpay_payment_id
            ) {
                return res.status(409).json({
                    success: false,
                    message: "This order is already associated with another payment."
                });
            }

            const qrData = JSON.stringify({
                registrationId: registration.registration_id,
                qrNumber: registration.qr_number,
                token: registration.qr_token
            });

            return res.json({
                success: true,
                registrationId: registration.registration_id,
                qrNumber: registration.qr_number,
                qrImage: await QRCode.toDataURL(qrData),
                message: "Payment already verified."
            });
        }

        // Confirm the payment directly with Razorpay
        const payment = await razorpay.payments.fetch(
            razorpay_payment_id
        );

        if (
            payment.order_id !== razorpay_order_id ||
            payment.amount !== PAYMENT_AMOUNT ||
            payment.currency !== "INR" ||
            payment.status !== "captured"
        ) {
            return res.status(400).json({
                success: false,
                message: "Payment is not captured or does not match the order."
            });
        }

        // Generate unique registration and QR identifiers
        const registrationId = "EESA-" +
            crypto.randomUUID().slice(0, 8).toUpperCase();

        const qrNumber = "QR-" +
            crypto.randomUUID().toUpperCase();

        const qrToken = crypto.randomBytes(32).toString("hex");

        const qrData = JSON.stringify({
            registrationId,
            qrNumber,
            token: qrToken
        });

        const qrImage = await QRCode.toDataURL(qrData);

        // Save the verified payment and QR identifiers
        db.prepare(`
            UPDATE registrations
            SET registration_id = ?,
                qr_number = ?,
                qr_token = ?,
                razorpay_payment_id = ?,
                payment_amount = ?,
                payment_currency = ?,
                payment_method = ?,
                payment_status = 'paid',
                paid_at = CURRENT_TIMESTAMP
            WHERE razorpay_order_id = ?
              AND payment_status = 'pending'
        `).run(
            registrationId,
            qrNumber,
            qrToken,
            payment.id,
            payment.amount,
            payment.currency,
            payment.method || "unknown",
            razorpay_order_id
        );

        res.json({
            success: true,
            registrationId,
            qrNumber,
            qrImage,
            message: "Payment verified and QR code generated."
        });

    } catch (error) {
        console.error("Payment verification error:", error.message);

        res.status(500).json({
            success: false,
            message: "Unable to verify payment. Please contact support if you were charged."
        });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`EESA Website running at http://localhost:${PORT}`);
});