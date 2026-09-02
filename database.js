const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');

const db = new sqlite3.Database('./health_quest.db', (err) => {
    if (err) console.error("Database connection error:", err.message);
    else console.log("Connected to SQLite Database successfully.");
});

db.serialize(() => {
    // 1. ตารางผู้ใช้งาน (Users)
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        fullname TEXT,
        student_id TEXT,
        role TEXT DEFAULT 'student', -- 'student' หรือ 'teacher'
        grade_level TEXT,            -- 'ม.1', 'ม.2', 'ม.3'
        room TEXT,                   -- 'ห้อง 1', 'ห้อง 2'
        points INTEGER DEFAULT 0,
        level INTEGER DEFAULT 1,
        exp INTEGER DEFAULT 0,
        current_streak INTEGER DEFAULT 0,
        highest_streak INTEGER DEFAULT 0,
        last_completed_date TEXT,
        profile_img TEXT DEFAULT '/uploads/default-avatar.png'
    )`);

    // 2. ตารางภารกิจ (Quests)
    db.run(`CREATE TABLE IF NOT EXISTS quests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        description TEXT,
        category TEXT, -- 'water', 'exercise', 'food', 'sleep'
        points_reward INTEGER DEFAULT 10
    )`);

// 3. ตารางส่งงาน/ส่งภารกิจ (Submissions)
    db.run(`CREATE TABLE IF NOT EXISTS submissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        student_id TEXT,              -- เพิ่มช่องเก็บรหัสนักเรียนตรงนี้
        quest_id INTEGER,
        proof_img TEXT,
        status TEXT DEFAULT 'pending', -- pending (รอตรวจ), approved (ผ่าน), rejected (ไม่ผ่าน)
        submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 4. ตารางตราเหรียญรางวัล (Badges)[cite: 1]
    db.run(`CREATE TABLE IF NOT EXISTS badges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        description TEXT,
        icon TEXT,
        required_condition TEXT
    )`);

    // 5. ตารางการครอบครองตราเหรียญ (User_Badges)[cite: 1]
    db.run(`CREATE TABLE IF NOT EXISTS user_badges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        badge_id INTEGER,
        unlocked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    // --- เพิ่มบัญชีครู (Pre-seeded Teacher Account) ---
    // ครูไม่ต้องสมัครระบบ สามารถล็อกอินด้วย: username = teacher / password = teacher123
    const teacherPassword = bcrypt.hashSync('teacher123', 10);
    db.run(`INSERT OR IGNORE INTO users (id, username, password, fullname, role) 
            VALUES (1, 'teacher', '${teacherPassword}', 'คุณครูผู้ดูแลระบบ', 'teacher')`);

    // --- เพิ่มภารกิจตั้งต้น ---
    db.run(`INSERT OR IGNORE INTO quests (id, title, description, category, points_reward) VALUES 
        (1, '💧 ดื่มน้ำเปล่า 2 ลิตร', 'ดื่มน้ำสะอาดตลอดทั้งวันให้ครบ 2 ลิตร', 'water', 10),
        (2, '🧘 ขยับร่างกาย 15 นาที', 'ยืดเส้นสาย หรือออกกำลังกายเบาๆ', 'exercise', 15),
        (3, '🥗 รับประทานผักผลไม้', 'ทานผักหรือผลไม้ในมื้ออาหารวันนี้', 'food', 10),
        (4, '😴 เข้านอนก่อน 4 ทุ่ม', 'พักผ่อนให้เพียงพอนอนก่อน 22:00 น.', 'sleep', 20)`);
});

db.run(`UPDATE quests SET description = 'ยืดเส้นสาย หรือออกกำลังกายเบาๆ' WHERE title LIKE '%ขยับร่างกาย%'`, (err) => {
    if (!err) console.log("อัปเดตข้อความภารกิจสำเร็จ!");
});

// สร้างตารางร้านค้าและเพิ่มข้อมูลจำลอง
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS shop_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        price INTEGER NOT NULL,
        icon TEXT
    )`);

    // เช็กว่ามีสินค้าหรือยัง ถ้ายังไม่มีให้เพิ่มเข้าไป
    db.get(`SELECT COUNT(*) as count FROM shop_items`, (err, row) => {
        if (row.count === 0) {
            const insertItem = db.prepare(`INSERT INTO shop_items (name, description, price, icon) VALUES (?, ?, ?, ?)`);
            insertItem.run("สิทธิพิเศษ: เลือกที่นั่งได้", "สามารถเลือกที่นั่งในห้องเรียนได้ 1 วัน", 100, "🪑");
            insertItem.run("ขนม 1 ชิ้น", "แลกรับขนมฟรี 1 ชิ้นที่โต๊ะคุณครู", 150, "🍬");
            insertItem.run("ตั๋วส่งงานเลท", "ใช้ส่งงานช้าได้ 1 วันโดยไม่โดนหักคะแนน", 300, "🎫");
            insertItem.run("สติกเกอร์เกียรติยศ", "รับสติกเกอร์สะสม 1 ดวง", 50, "⭐");
            insertItem.finalize();
        }
    });
});

module.exports = db;