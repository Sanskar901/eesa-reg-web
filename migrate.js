const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(path.join(__dirname, "eesa.db"));
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");

// 1. Create Events Table
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

// 2. Create Event-Specific Eligible Students Table
db.exec(`
    CREATE TABLE IF NOT EXISTS event_eligible_students (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL,
        college_id TEXT NOT NULL,
        uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(event_id, college_id)
    );
`);

// 3. Update Registrations Table with event_id
try {
    db.exec("ALTER TABLE registrations ADD COLUMN event_id INTEGER DEFAULT 1;");
    console.log("Added event_id column to registrations.");
} catch (e) {
    // Column already exists
}

// Drop old single-college-id index if exists and replace with (event_id, college_id)
try {
    db.exec("DROP INDEX IF EXISTS idx_registrations_college_id;");
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_registrations_event_college ON registrations(event_id, college_id);");
    console.log("Updated unique index to (event_id, college_id).");
} catch (e) {
    console.warn("Index update warning:", e.message);
}

// 4. Seed Default Flagship EESA Events
const checkEvents = db.prepare("SELECT COUNT(*) AS count FROM events").get();
if (checkEvents.count === 0) {
    const insertEvent = db.prepare(`
        INSERT INTO events (id, slug, title, tagline, category, description, date, time, venue, fee_paise, status, restrict_eligibility, rules)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertEvent.run(
        1,
        "freshers-party-2026",
        "EESA Freshers Party 2026",
        "Welcome to the Electronics Family! An evening of music, dance, and celebrations.",
        "Cultural",
        "The grand annual welcoming gala organized by EESA for the incoming batch! Experience high-energy dance performances, live music, fun titles, student showcase, and delicious banquet refreshments.",
        "October 25, 2026",
        "4:00 PM - 9:00 PM",
        "Main University Auditorium, JSPM Campus",
        200, // ₹2 for demo/test, easily changeable in admin panel
        "active",
        1, // Restrict to eligible students
        "1. College ID Card is mandatory at entry.\n2. Entry gates close strictly at 5:00 PM.\n3. Alcohol, smoking, and misconduct are strictly prohibited.\n4. Non-transferable digital QR pass."
    );

    insertEvent.run(
        2,
        "circuitron-hackathon-2026",
        "Circuitron: National Circuit Design Hackathon",
        "Design, simulate, and fabricate circuits in 24 hours of non-stop innovation.",
        "Hackathon",
        "Circuitron brings together the sharpest minds in electronics to tackle real-world industrial hardware challenges. Compete across analog design, power electronics, embedded firmware, and rapid PCB prototyping with cash prizes worth ₹25,000!",
        "November 14, 2026",
        "9:00 AM - 6:00 PM",
        "Advanced VLSI & Embedded Lab",
        10000, // ₹100
        "active",
        0, // Open to all college students
        "1. Teams of 2 to 4 members.\n2. Components and testing bench will be provided on-site.\n3. Simulation software: KiCAD, Proteus, or LTSpice.\n4. Decision of judges is final."
    );

    insertEvent.run(
        3,
        "iot-embedded-masterclass",
        "IoT & ESP32 Hands-on Masterclass",
        "Build cloud-connected IoT devices from scratch with industry mentors.",
        "Workshop",
        "A comprehensive hands-on workshop covering ESP32 microcontrollers, MQTT cloud protocols, sensor interfacing, and building custom IoT web dashboards. Every attendee receives certificate of completion and verified project credits.",
        "December 05, 2026",
        "10:00 AM - 4:00 PM",
        "EESA Tech Center, Lab 304",
        15000, // ₹150
        "active",
        0, // Open to all
        "1. Bring your own laptop with Arduino IDE installed.\n2. Hardware development kits will be provided during workshop.\n3. Individual registration."
    );

    insertEvent.run(
        4,
        "electroquest-roborace",
        "ElectroQuest & Robo-Sprint 2027",
        "Obstacle tracks, autonomous rovers, and high-speed line followers.",
        "Competition",
        "The flagship inter-department robotics arena! Build custom rovers to navigate extreme obstacle paths, line mazes, and automated sensor gates in minimum time.",
        "January 18, 2027",
        "11:00 AM - 5:00 PM",
        "Campus Sports Complex Arena",
        5000, // ₹50
        "upcoming",
        0,
        "1. Bot dimensions: Max 30cm x 30cm x 30cm.\n2. Maximum allowed operating voltage: 12V.\n3. Ready-made toy bots are disqualified."
    );

    console.log("Seeded 4 default flagship events into database.");
}

// 5. Migrate any existing eligible students to Event 1 (Freshers Party)
try {
    const existing = db.prepare("SELECT college_id FROM eligible_students").all();
    if (existing.length > 0) {
        const insertEligible = db.prepare(`
            INSERT OR IGNORE INTO event_eligible_students (event_id, college_id)
            VALUES (1, ?)
        `);
        for (const s of existing) {
            insertEligible.run(s.college_id);
        }
        console.log(`Migrated ${existing.length} eligible students to Event 1.`);
    }
} catch (e) {
    console.warn("Eligible migration note:", e.message);
}

console.log("Migration complete!");
