const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('./database');

const app = express();
const PORT = 3000;

// ตั้งค่า Express & EJS
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// ตั้งค่า Session
app.use(session({
    secret: 'health_quest_secret_key',
    resave: false,
    saveUninitialized: true
}));

// ตั้งค่า Multer สำหรับอัปโหลดรูปภาพ
const storage = multer.diskStorage({
    destination: './uploads/',
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// ==================== ROUTES ====================

// หน้าแรก (Redirect ไปหน้า Login)
app.get('/', (req, res) => {
    res.redirect('/login');
});

// หน้าเข้าสู่ระบบ
app.get('/login', (req, res) => {
    res.render('login');
});

// ระบบ Login
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, user) => {
        if (!user || !bcrypt.compareSync(password, user.password)) {
            return res.send("<script>alert('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'); window.history.back();</script>");
        }
        req.session.user = user;
        if (user.role === 'teacher') {
            res.redirect('/teacher/dashboard');
        } else {
            res.redirect('/student/dashboard');
        }
    });
});

// ระบบลงทะเบียนนักเรียนใหม่ (พร้อมรหัสนักเรียน)
app.post('/register', (req, res) => {
    const { username, password, fullname, student_id, grade_level, room } = req.body;
    const hashedPassword = bcrypt.hashSync(password, 10);

    db.run(
        `INSERT INTO users (username, password, fullname, student_id, grade_level, room, role) VALUES (?, ?, ?, ?, ?, ?, 'student')`,
        [username, hashedPassword, fullname, student_id, grade_level, room],
        (err) => {
            if (err) return res.send("<script>alert('ชื่อผู้ใช้นี้มีในระบบแล้ว'); window.history.back();</script>");
            res.redirect('/login');
        }
    );
});

// หน้า Dashboard นักเรียน
app.get('/student/dashboard', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'student') return res.redirect('/login');

    const userId = req.session.user.id;
    db.get(`SELECT * FROM users WHERE id = ?`, [userId], (err, user) => {
        db.all(`SELECT * FROM quests`, [], (err, quests) => {
            const expRequired = user.level * 100; // EXP ที่ต้องการตามสูตร Level x 100[cite: 2]
            res.render('student-dashboard', { user, quests, expRequired });
        });
    });
});

// อัปเดตรูปโปรไฟล์นักเรียน
app.post('/student/update-profile-pic', upload.single('profile_pic'), (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    if (req.file) {
        const imgPath = '/uploads/' + req.file.filename;
        db.run(`UPDATE users SET profile_img = ? WHERE id = ?`, [imgPath, req.session.user.id], () => {
            req.session.user.profile_img = imgPath;
            res.redirect('/student/dashboard');
        });
    } else {
        res.redirect('/student/dashboard');
    }
});

// นักเรียนส่งภารกิจ (อนุมัติทันที ได้แต้มเลย)
app.post('/student/submit-quest', upload.single('proof_img'), (req, res) => {
    if (!req.session.user) return res.redirect('/login');

    const userId = req.session.user.id;
    const studentId = req.session.user.student_id;
    const questId = req.body.quest_id;
    const proofImg = req.file ? '/uploads/' + req.file.filename : null;

    if (!proofImg) return res.send("<script>alert('กรุณาแนบรูปก่อนส่ง!'); window.history.back();</script>");

    // ดึงคะแนนภารกิจ
    db.get(`SELECT points_reward FROM quests WHERE id = ?`, [questId], (err, quest) => {
        if (!quest) return res.redirect('/student/dashboard');

        db.get(`SELECT * FROM users WHERE id = ?`, [userId], (err, student) => {
            let newPoints = student.points + quest.points_reward;
            let newExp = student.exp + quest.points_reward;
            let newLevel = student.level;
            
            // คำนวณเลเวลอัป
            while (newExp >= newLevel * 100) {
                newExp -= (newLevel * 100);
                newLevel++;
            }

            // บันทึกสถานะเป็น 'approved' เลย
            db.run(`INSERT INTO submissions (user_id, student_id, quest_id, proof_img, status) VALUES (?, ?, ?, ?, 'approved')`,
                [userId, studentId, questId, proofImg],
                () => {
                    db.run(`UPDATE users SET points = ?, exp = ?, level = ? WHERE id = ?`, [newPoints, newExp, newLevel, userId], () => {
                        req.session.user.points = newPoints;
                        req.session.user.exp = newExp;
                        req.session.user.level = newLevel;
                        res.send("<script>alert('ส่งงานสำเร็จ! ได้รับแต้มเรียบร้อยแล้ว'); window.location.href='/student/dashboard';</script>");
                    });
                }
            );
        });
    });
});

// หน้า Dashboard ครู (ตรวจงานที่อนุมัติไปแล้ว + ระบบกรองห้อง)
app.get('/teacher/dashboard', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'teacher') return res.redirect('/login');

    const filterGrade = req.query.grade_level || '';
    const filterRoom = req.query.room || '';

    let sql = `
        SELECT s.id AS submission_id, u.fullname, u.student_id, u.grade_level, u.room, 
               q.title AS quest_title, q.points_reward, s.proof_img, s.status, s.submitted_at
        FROM submissions s
        JOIN users u ON s.user_id = u.id
        JOIN quests q ON s.quest_id = q.id
        WHERE s.status = 'approved'
    `;
    const params = [];

    if (filterGrade) { 
        sql += ` AND u.grade_level = ?`; 
        params.push(filterGrade); 
    }
    if (filterRoom) { 
        sql += ` AND u.room = ?`; 
        params.push(filterRoom); 
    }

    sql += ` ORDER BY u.grade_level ASC, u.room ASC, s.submitted_at DESC`;

    db.all(sql, params, (err, rows) => {
        if (err) console.error(err);
        res.render('teacher-dashboard', { 
            submissions: rows || [], 
            user: req.session.user, 
            currentGrade: filterGrade, 
            currentRoom: filterRoom 
        });
    });
});

// ครูยึดคะแนนคืน (ถ้ารูปไม่ตรงปก)
app.post('/teacher/revoke', (req, res) => {
    const { submission_id } = req.body;

    db.get(`SELECT s.*, q.points_reward FROM submissions s JOIN quests q ON s.quest_id = q.id WHERE s.id = ?`, [submission_id], (err, sub) => {
        if (!sub || sub.status !== 'approved') return res.redirect('/teacher/dashboard');
        
        // เปลี่ยนสถานะเป็น rejected
        db.run(`UPDATE submissions SET status = 'rejected' WHERE id = ?`, [submission_id], () => {
            db.get(`SELECT * FROM users WHERE id = ?`, [sub.user_id], (err, student) => {
                let newPoints = Math.max(0, student.points - sub.points_reward);
                let newExp = student.exp - sub.points_reward;
                let newLevel = student.level;
                
                // คำนวณเลเวลลด (ถ้า exp ติดลบ)
                while (newExp < 0 && newLevel > 1) {
                    newLevel--;
                    newExp += (newLevel * 100);
                }
                if (newExp < 0) newExp = 0;

                db.run(`UPDATE users SET points = ?, exp = ?, level = ? WHERE id = ?`, [newPoints, newExp, newLevel, sub.user_id], () => {
                    res.redirect('/teacher/dashboard');
                });
            });
        });
    });
});

// หน้าตารางอันดับ (Leaderboard) สำหรับนักเรียน
app.get('/leaderboard', (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    
    // ดึงข้อมูลนักเรียนจัดอันดับตามแต้ม
    db.all(`SELECT fullname, student_id, grade_level, room, points, level, profile_img 
            FROM users WHERE role = 'student' ORDER BY points DESC LIMIT 50`, [], (err, users) => {
        res.render('leaderboard', { students: users || [] });
    });
});

// ออกจากระบบ
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// Route สำหรับดาวน์โหลดคะแนนเป็น Excel (CSV)
app.get('/teacher/export-scores', (req, res) => {
    const sql = `SELECT student_id, fullname, grade_level, room, points, level 
                 FROM users 
                 WHERE role = 'student' 
                 ORDER BY grade_level ASC, room ASC, points DESC`;
                 
    db.all(sql, [], (err, rows) => {
        if (err) return res.send("เกิดข้อผิดพลาดในการดึงข้อมูล");

        let csvContent = "\uFEFFรหัสนักเรียน,ชื่อ-นามสกุล,ชั้นปี,ห้อง,เลเวล,คะแนนสะสม\n";
        
        (rows || []).forEach(row => {
            csvContent += `"${row.student_id}","${row.fullname}","${row.grade_level}","${row.room}",${row.level},${row.points}\n`;
        });

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename=health_quest_scores.csv');
        res.status(200).send(csvContent);
    });
});

// Route ส่งออกคะแนนเป็นไฟล์ Excel (CSV)
app.get('/teacher/export-scores', (req, res) => {
    const sql = `SELECT student_id, fullname, grade_level, room, points, level 
                 FROM users 
                 WHERE role = 'student' 
                 ORDER BY grade_level ASC, room ASC, points DESC`;
                 
    db.all(sql, [], (err, rows) => {
        if (err) return res.send("เกิดข้อผิดพลาดในการดึงข้อมูล");

        let csvContent = "\uFEFFรหัสนักเรียน,ชื่อ-นามสกุล,ชั้นปี,ห้อง,เลเวล,คะแนนสะสม\n";
        
        (rows || []).forEach(row => {
            csvContent += `"${row.student_id}","${row.fullname}","${row.grade_level}","${row.room}",${row.level},${row.points}\n`;
        });

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename=health_quest_scores.csv');
        res.status(200).send(csvContent);
    });
});

// ==========================================
// ระบบจัดการภารกิจ (สำหรับคุณครู)
// ==========================================

// หน้าแสดงรายการภารกิจทั้งหมด
app.get('/teacher/quests', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'teacher') return res.redirect('/login');
    db.all(`SELECT * FROM quests ORDER BY id DESC`, [], (err, quests) => {
        res.render('teacher-quests', { quests: quests || [], user: req.session.user });
    });
});

// ระบบเพิ่มภารกิจใหม่
app.post('/teacher/quests/add', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'teacher') return res.redirect('/login');
    const { title, description, points_reward } = req.body;
    db.run(`INSERT INTO quests (title, description, points_reward) VALUES (?, ?, ?)`, 
        [title, description, points_reward], 
        () => res.redirect('/teacher/quests')
    );
});

// ระบบลบภารกิจ
app.post('/teacher/quests/delete', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'teacher') return res.redirect('/login');
    db.run(`DELETE FROM quests WHERE id = ?`, [req.body.quest_id], 
        () => res.redirect('/teacher/quests')
    );
});

// ==========================================
// ระบบร้านค้า (Shop) สำหรับนักเรียน
// ==========================================
app.get('/student/shop', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'student') return res.redirect('/login');
    db.all(`SELECT * FROM shop_items`, [], (err, items) => {
        res.render('student-shop', { items: items || [], user: req.session.user });
    });
});

app.post('/student/shop/buy', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'student') return res.redirect('/login');
    const { item_name, price } = req.body;
    const userId = req.session.user.id;

    db.get(`SELECT points FROM users WHERE id = ?`, [userId], (err, user) => {
        if (user.points >= price) {
            const newPoints = user.points - price;
            db.run(`UPDATE users SET points = ? WHERE id = ?`, [newPoints, userId], () => {
                req.session.user.points = newPoints;
                res.send(`<script>alert('🎉 แลกซื้อ "${item_name}" สำเร็จ! ระบบหัก ${price} แต้มเรียบร้อย'); window.location.href='/student/shop';</script>`);
            });
        } else {
            res.send(`<script>alert('❌ แต้มไม่พอ! ไปทำภารกิจเพิ่มก่อนนะ'); window.history.back();</script>`);
        }
    });
});

// ==========================================
// ระบบจัดการร้านค้า (สำหรับคุณครู)
// ==========================================

// หน้าแสดงรายการสินค้าทั้งหมด
app.get('/teacher/shop-manage', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'teacher') return res.redirect('/login');
    db.all(`SELECT * FROM shop_items ORDER BY id DESC`, [], (err, items) => {
        res.render('teacher-shop-manage', { items: items || [], user: req.session.user });
    });
});

// ระบบเพิ่มสินค้าใหม่
app.post('/teacher/shop-manage/add', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'teacher') return res.redirect('/login');
    const { name, description, price, icon } = req.body;
    db.run(`INSERT INTO shop_items (name, description, price, icon) VALUES (?, ?, ?, ?)`, 
        [name, description, price, icon], 
        () => res.redirect('/teacher/shop-manage')
    );
});

// ระบบลบสินค้า
app.post('/teacher/shop-manage/delete', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'teacher') return res.redirect('/login');
    db.run(`DELETE FROM shop_items WHERE id = ?`, [req.body.item_id], 
        () => res.redirect('/teacher/shop-manage')
    );
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});