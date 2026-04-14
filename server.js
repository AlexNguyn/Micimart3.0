/* eslint-disable no-console */
// @ts-check
"use strict";

// ============================================================
//  MiciMart  –  server.js
//  Node.js + Express + PostgreSQL
// ============================================================

require("dotenv").config();

const express  = require("express");
const { Pool } = require("pg");
const bcrypt   = require("bcryptjs");
const jwt      = require("jsonwebtoken");
const cors     = require("cors");
const multer   = require("multer");
const XLSX     = require("xlsx");
const path     = require("path");

// ── APP SETUP ─────────────────────────────────────────────

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const JWT_SECRET = process.env.JWT_SECRET || "micimart2026secret";
const JWT_EXPIRES = process.env.JWT_EXPIRES || "8h";
const PORT = Number(process.env.PORT) || 3000;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

// ── DATABASE INIT ─────────────────────────────────────────

async function initDB() {
  const client = await pool.connect();
  try {
    // Tạo bảng
    await client.query(`
      CREATE TABLE IF NOT EXISTS roles (
        id           SERIAL PRIMARY KEY,
        name         VARCHAR(50)  UNIQUE NOT NULL,
        display_name VARCHAR(100) NOT NULL,
        permissions  TEXT NOT NULL DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS users (
        id            SERIAL PRIMARY KEY,
        username      VARCHAR(50)  UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        full_name     VARCHAR(100) NOT NULL,
        email         VARCHAR(100),
        phone         VARCHAR(20),
        role_id       INT NOT NULL DEFAULT 7,
        is_active     BOOLEAN DEFAULT TRUE,
        avatar        VARCHAR(10) DEFAULT '👤',
        last_login    TIMESTAMP,
        created_at    TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS products (
        id               SERIAL PRIMARY KEY,
        code             VARCHAR(30)  UNIQUE NOT NULL,
        name             VARCHAR(255) NOT NULL,
        category         VARCHAR(100) NOT NULL DEFAULT 'Khác',
        subcategory      VARCHAR(100),
        unit             VARCHAR(50)  NOT NULL DEFAULT 'Cái',
        cost_price       BIGINT NOT NULL DEFAULT 0,
        selling_price    BIGINT NOT NULL DEFAULT 0,
        discount_percent INT DEFAULT 0,
        stock            INT NOT NULL DEFAULT 0,
        min_stock        INT NOT NULL DEFAULT 10,
        icon             VARCHAR(10) DEFAULT '📦',
        is_active        BOOLEAN DEFAULT TRUE,
        created_at       TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS orders (
        id               SERIAL PRIMARY KEY,
        order_code       VARCHAR(30) UNIQUE,
        customer_name    VARCHAR(100) DEFAULT 'Khách lẻ',
        customer_id      INT,
        subtotal         BIGINT NOT NULL DEFAULT 0,
        discount         BIGINT NOT NULL DEFAULT 0,
        vat              BIGINT NOT NULL DEFAULT 0,
        total            BIGINT NOT NULL DEFAULT 0,
        payment_method   VARCHAR(20) DEFAULT 'cash',
        cashier_id       INT,
        status           VARCHAR(20) DEFAULT 'done',
        delivery_status  VARCHAR(20) DEFAULT 'none',
        delivery_id      INT,
        delivery_address TEXT,
        notes            TEXT,
        voucher_code     VARCHAR(50),
        created_at       TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS order_items (
        id           SERIAL PRIMARY KEY,
        order_id     INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        product_id   INT REFERENCES products(id) ON DELETE SET NULL,
        product_name VARCHAR(255) NOT NULL,
        qty          INT   NOT NULL DEFAULT 1,
        price        BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS customer_profiles (
        id          SERIAL PRIMARY KEY,
        user_id     INT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        rank        VARCHAR(20) DEFAULT 'Thường',
        points      INT DEFAULT 0,
        total_spent BIGINT DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS vouchers (
        id             SERIAL PRIMARY KEY,
        code           VARCHAR(50) UNIQUE NOT NULL,
        description    VARCHAR(255),
        discount_type  VARCHAR(20) DEFAULT 'percent',
        discount_value INT NOT NULL DEFAULT 0,
        min_order      BIGINT DEFAULT 0,
        max_uses       INT DEFAULT 100,
        used_count     INT DEFAULT 0,
        is_active      BOOLEAN DEFAULT TRUE,
        expires_at     TIMESTAMP,
        created_at     TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS user_vouchers (
        id          SERIAL PRIMARY KEY,
        user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        voucher_id  INT NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
        used        BOOLEAN DEFAULT FALSE,
        assigned_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, voucher_id)
      );

      CREATE TABLE IF NOT EXISTS attendance (
        id       SERIAL PRIMARY KEY,
        user_id  INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        date     DATE NOT NULL DEFAULT CURRENT_DATE,
        checkin  TIMESTAMP,
        checkout TIMESTAMP,
        status   VARCHAR(20) DEFAULT 'present',
        UNIQUE(user_id, date)
      );

      CREATE TABLE IF NOT EXISTS salary (
        id          SERIAL PRIMARY KEY,
        user_id     INT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        base_salary BIGINT DEFAULT 0,
        bonus       BIGINT DEFAULT 0,
        deduction   BIGINT DEFAULT 0,
        updated_at  TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS feedback (
        id         SERIAL PRIMARY KEY,
        user_id    INT REFERENCES users(id) ON DELETE SET NULL,
        name       VARCHAR(100),
        content    TEXT NOT NULL,
        rating     INT DEFAULT 5,
        status     VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS delivery_addresses (
        id         SERIAL PRIMARY KEY,
        user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        address    TEXT NOT NULL,
        label      VARCHAR(50),
        is_default BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Seed roles
    await client.query(`
      INSERT INTO roles (id, name, display_name, permissions) VALUES
        (1,'admin',       'Quản trị viên',      '["dashboard","pos","products","orders","inventory","customers","vouchers","reports","staff","user_management","delivery_mgmt","attendance","salary","feedback","import","my_profile"]'),
        (2,'manager',     'Quản lý cửa hàng',   '["dashboard","pos","products","orders","inventory","customers","vouchers","reports","staff","delivery_mgmt","attendance","salary","feedback","import","my_profile"]'),
        (3,'cashier',     'Thu ngân',            '["pos","orders","customers","my_shift","my_orders","my_vouchers","my_profile","attendance"]'),
        (4,'warehouse',   'Nhân viên kho',       '["inventory","products","my_profile","attendance"]'),
        (5,'delivery',    'Nhân viên giao hàng', '["delivery","my_profile","attendance"]'),
        (6,'salesperson', 'Nhân viên bán hàng',  '["pos","products","inventory","my_profile","attendance"]'),
        (7,'customer',    'Khách hàng',          '["my_orders","my_vouchers","my_profile","attendance"]')
      ON CONFLICT (name) DO UPDATE SET permissions = EXCLUDED.permissions;
    `);
    await client.query(`SELECT setval('roles_id_seq', GREATEST((SELECT MAX(id) FROM roles), 1))`);

    // Seed admin
    const adminCheck = await client.query(`SELECT id FROM users WHERE username = 'admin12'`);
    if (adminCheck.rows.length === 0) {
      const hash = await bcrypt.hash("admin12", 10);
      await client.query(
        `INSERT INTO users (username, password_hash, full_name, email, role_id)
         VALUES ('admin12', $1, 'Admin MiciMart', 'admin@micimart.vn', 1)`,
        [hash]
      );
      console.log("🔑 Tài khoản admin: admin12 / admin12");
    }

    // Seed vouchers
    await client.query(`
      INSERT INTO vouchers (code, description, discount_type, discount_value, min_order, max_uses) VALUES
        ('WELCOME10',  'Giảm 10% đơn đầu tiên',  'percent', 10, 0,      1000),
        ('MICIMART20', 'Giảm 20% đơn từ 200k',   'percent', 20, 200000, 500),
        ('FREESHIP',   'Miễn phí giao hàng',      'fixed',   30000, 100000, 200)
      ON CONFLICT (code) DO NOTHING;
    `);

    // Seed sản phẩm mẫu
    await client.query(`
      INSERT INTO products (code, name, category, unit, cost_price, selling_price, stock, min_stock, icon) VALUES
        ('SP001','Sữa tươi TH True Milk 1L',    'Sữa & chế phẩm từ sữa', 'Hộp',   28000,  35000,  124, 20, '🥛'),
        ('SP002','Gạo ST25 5kg',                 'Thực phẩm tươi sống',   'Kg',    65000,  85000,  48,  15, '🌾'),
        ('SP003','Nước ngọt Pepsi 1.5L',         'Đồ uống',               'Chai',  18000,  25000,  200, 30, '🥤'),
        ('SP004','Bánh Oreo 133g',               'Bánh kẹo & snack',      'Gói',   22000,  30000,  87,  25, '🍪'),
        ('SP005','Trứng gà ta (vỉ 10)',          'Thực phẩm tươi sống',   'Vỉ',    32000,  42000,  60,  20, '🥚'),
        ('SP006','Bia Tiger thùng 24',           'Đồ uống',               'Thùng', 280000, 360000, 30,  10, '🍺'),
        ('SP007','Nước mắm Phú Quốc 500ml',     'Gia vị',                'Chai',  35000,  48000,  75,  15, '🫙'),
        ('SP008','Dầu ăn Neptune 2L',            'Gia vị',                'Chai',  65000,  82000,  40,  15, '🫒'),
        ('SP009','Xà phòng Dove 100g',           'Chăm sóc cá nhân',     'Cái',   18000,  26000,  8,   20, '🧼'),
        ('SP010','Nước rửa bát Sunlight 750ml',  'Hóa phẩm',             'Chai',  22000,  32000,  55,  15, '🧴'),
        ('SP011','Mì Hảo Hảo thùng 30 gói',     'Thực phẩm tươi sống',  'Thùng', 95000,  125000, 22,  10, '🍜'),
        ('SP012','Sữa chua Vinamilk lốc 4',      'Sữa & chế phẩm từ sữa','Lốc',   28000,  36000,  6,   15, '🍦')
      ON CONFLICT (code) DO NOTHING;
    `);

    // ── MIGRATION: thêm cột còn thiếu vào các bảng đã tồn tại ──
    await client.query(`
      DO $$
      BEGIN

        -- attendance: đổi tên cột cũ nếu có
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'attendance' AND column_name = 'date_of_attendance'
        ) THEN
          ALTER TABLE attendance RENAME COLUMN date_of_attendance TO date;
        END IF;

        -- attendance: thêm cột date nếu chưa có
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'attendance' AND column_name = 'date'
        ) THEN
          ALTER TABLE attendance ADD COLUMN date DATE NOT NULL DEFAULT CURRENT_DATE;
        END IF;

        -- attendance: thêm cột checkin nếu chưa có
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'attendance' AND column_name = 'checkin'
        ) THEN
          ALTER TABLE attendance ADD COLUMN checkin TIMESTAMP;
        END IF;

        -- attendance: thêm cột checkout nếu chưa có
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'attendance' AND column_name = 'checkout'
        ) THEN
          ALTER TABLE attendance ADD COLUMN checkout TIMESTAMP;
        END IF;

        -- attendance: thêm cột status nếu chưa có
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'attendance' AND column_name = 'status'
        ) THEN
          ALTER TABLE attendance ADD COLUMN status VARCHAR(20) DEFAULT 'present';
        END IF;

        -- attendance: unique constraint
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'attendance_user_id_date_key'
        ) THEN
          ALTER TABLE attendance ADD CONSTRAINT attendance_user_id_date_key UNIQUE(user_id, date);
        END IF;

        -- salary: thêm cột bonus nếu chưa có
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'salary' AND column_name = 'bonus'
        ) THEN
          ALTER TABLE salary ADD COLUMN bonus BIGINT DEFAULT 0;
        END IF;

        -- salary: thêm cột deduction nếu chưa có
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'salary' AND column_name = 'deduction'
        ) THEN
          ALTER TABLE salary ADD COLUMN deduction BIGINT DEFAULT 0;
        END IF;

        -- salary: thêm cột updated_at nếu chưa có
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'salary' AND column_name = 'updated_at'
        ) THEN
          ALTER TABLE salary ADD COLUMN updated_at TIMESTAMP DEFAULT NOW();
        END IF;

        -- orders: thêm cột delivery_id nếu chưa có
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'orders' AND column_name = 'delivery_id'
        ) THEN
          ALTER TABLE orders ADD COLUMN delivery_id INT;
        END IF;

        -- orders: thêm cột delivery_status nếu chưa có
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'orders' AND column_name = 'delivery_status'
        ) THEN
          ALTER TABLE orders ADD COLUMN delivery_status VARCHAR(20) DEFAULT 'none';
        END IF;

        -- orders: thêm cột delivery_address nếu chưa có
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'orders' AND column_name = 'delivery_address'
        ) THEN
          ALTER TABLE orders ADD COLUMN delivery_address TEXT;
        END IF;

        -- orders: thêm cột voucher_code nếu chưa có
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'orders' AND column_name = 'voucher_code'
        ) THEN
          ALTER TABLE orders ADD COLUMN voucher_code VARCHAR(50);
        END IF;

        -- orders: thêm cột order_code nếu chưa có
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'orders' AND column_name = 'order_code'
        ) THEN
          ALTER TABLE orders ADD COLUMN order_code VARCHAR(30);
        END IF;

        -- orders: thêm cột notes nếu chưa có
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'orders' AND column_name = 'notes'
        ) THEN
          ALTER TABLE orders ADD COLUMN notes TEXT;
        END IF;

        -- orders: thêm cột vat nếu chưa có
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'orders' AND column_name = 'vat'
        ) THEN
          ALTER TABLE orders ADD COLUMN vat BIGINT NOT NULL DEFAULT 0;
        END IF;

        -- products: thêm cột subcategory nếu chưa có
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'products' AND column_name = 'subcategory'
        ) THEN
          ALTER TABLE products ADD COLUMN subcategory VARCHAR(100);
        END IF;

        -- products: thêm cột discount_percent nếu chưa có
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'products' AND column_name = 'discount_percent'
        ) THEN
          ALTER TABLE products ADD COLUMN discount_percent INT DEFAULT 0;
        END IF;

        -- users: thêm cột avatar nếu chưa có
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'users' AND column_name = 'avatar'
        ) THEN
          ALTER TABLE users ADD COLUMN avatar VARCHAR(10) DEFAULT '👤';
        END IF;

      END$$;
    `);

    // Migration: tạo salary mặc định cho nhân viên chưa có
    await client.query(`
      INSERT INTO salary (user_id, base_salary, bonus, deduction)
      SELECT u.id, 0, 0, 0
      FROM users u
      WHERE u.role_id != 7
        AND NOT EXISTS (SELECT 1 FROM salary s WHERE s.user_id = u.id)
    `);

    console.log("✅ Database sẵn sàng");
  } finally {
    client.release();
  }
}

// ── MIDDLEWARE ────────────────────────────────────────────

/**
 * Xác thực JWT
 */
function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Chưa đăng nhập" });
  }
  try {
    req.user = jwt.verify(header.split(" ")[1], JWT_SECRET);
    next();
  } catch (err) {
    res.status(401).json({ error: "Phiên đăng nhập hết hạn" });
  }
}

/**
 * Kiểm tra vai trò
 * @param {...string} roles
 */
function can(...roles) {
  return function (req, res, next) {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Không có quyền thực hiện thao tác này" });
    }
    next();
  };
}

// ── AUTH ──────────────────────────────────────────────────

app.post("/api/auth/register", async (req, res) => {
  const { username, password, full_name, email, phone } = req.body;
  if (!username || !password || !full_name) {
    return res.status(400).json({ error: "Vui lòng điền đầy đủ thông tin" });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "Mật khẩu phải ít nhất 6 ký tự" });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (username, password_hash, full_name, email, phone, role_id)
       VALUES ($1, $2, $3, $4, $5, 7) RETURNING id`,
      [username.trim(), hash, full_name.trim(), email || null, phone || null]
    );
    await pool.query(
      `INSERT INTO customer_profiles (user_id) VALUES ($1)`,
      [result.rows[0].id]
    );
    res.status(201).json({ message: "Đăng ký thành công! Hãy đăng nhập." });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Tên đăng nhập đã tồn tại" });
    }
    console.error(err);
    res.status(500).json({ error: "Lỗi hệ thống" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Vui lòng nhập thông tin đăng nhập" });
  }
  try {
    const result = await pool.query(
      `SELECT u.*, ro.name AS role, ro.display_name AS role_display, ro.permissions
       FROM users u JOIN roles ro ON u.role_id = ro.id
       WHERE u.username = $1`,
      [username.trim()]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Sai tên đăng nhập hoặc mật khẩu" });
    }
    const user = result.rows[0];
    if (!user.is_active) {
      return res.status(403).json({ error: "Tài khoản đã bị khóa. Liên hệ Admin." });
    }
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: "Sai tên đăng nhập hoặc mật khẩu" });
    }
    await pool.query(`UPDATE users SET last_login = NOW() WHERE id = $1`, [user.id]);

    const permissions = typeof user.permissions === "string"
      ? JSON.parse(user.permissions)
      : user.permissions;

    const payload = {
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      role: user.role,
      role_display: user.role_display,
      permissions,
    };
    res.json({
      token: jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES }),
      user: payload,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi hệ thống" });
  }
});

app.get("/api/auth/me", auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.username, u.full_name, u.email, u.phone, u.last_login,
              ro.name AS role, ro.display_name AS role_display, ro.permissions
       FROM users u JOIN roles ro ON u.role_id = ro.id
       WHERE u.id = $1`,
      [req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Không tìm thấy người dùng" });
    }
    const user = result.rows[0];
    user.permissions = typeof user.permissions === "string"
      ? JSON.parse(user.permissions)
      : user.permissions;
    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi hệ thống" });
  }
});

// ── USERS ─────────────────────────────────────────────────

// QUAN TRỌNG: route tĩnh phải đặt TRƯỚC route động /:id
app.get("/api/users/delivery-staff", auth, can("admin", "manager"), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.full_name, u.phone
       FROM users u JOIN roles ro ON u.role_id = ro.id
       WHERE ro.name = 'delivery' AND u.is_active = true
       ORDER BY u.full_name`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi hệ thống" });
  }
});

app.get("/api/users", auth, can("admin"), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.username, u.full_name, u.email, u.phone,
              u.is_active, u.last_login, u.created_at,
              ro.id AS role_id, ro.name AS role, ro.display_name AS role_display
       FROM users u JOIN roles ro ON u.role_id = ro.id
       ORDER BY u.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi hệ thống" });
  }
});

app.get("/api/roles", auth, can("admin", "manager"), async (req, res) => {
  try {
    const result = await pool.query(`SELECT id, name, display_name FROM roles ORDER BY id`);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi hệ thống" });
  }
});

app.post("/api/users", auth, can("admin", "manager"), async (req, res) => {
  const { username, password, full_name, email, phone, role_id } = req.body;
  if (!username || !password || !full_name || !role_id) {
    return res.status(400).json({ error: "Thiếu thông tin bắt buộc" });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (username, password_hash, full_name, email, phone, role_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [username.trim(), hash, full_name.trim(), email || null, phone || null, role_id]
    );
    const newId = result.rows[0].id;
    // Tự động tạo bản ghi lương mặc định nếu là nhân viên (role 1-6)
    if (parseInt(role_id, 10) !== 7) {
      await pool.query(
        `INSERT INTO salary (user_id, base_salary, bonus, deduction)
         VALUES ($1, 0, 0, 0) ON CONFLICT (user_id) DO NOTHING`,
        [newId]
      );
    }
    res.status(201).json({ message: "Tạo tài khoản thành công" });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Tên đăng nhập đã tồn tại" });
    }
    console.error(err);
    res.status(500).json({ error: "Lỗi hệ thống" });
  }
});

app.put("/api/users/:id/role", auth, can("admin"), async (req, res) => {
  const uid     = parseInt(req.params.id, 10);
  const role_id = parseInt(req.body.role_id, 10);
  if (uid === req.user.id) {
    return res.status(400).json({ error: "Không thể tự đổi vai trò của mình" });
  }
  try {
    await pool.query(`UPDATE users SET role_id = $1 WHERE id = $2`, [role_id, uid]);
    if (role_id !== 7) {
      // Nhân viên → tạo bản ghi lương mặc định nếu chưa có
      await pool.query(
        `INSERT INTO salary (user_id, base_salary, bonus, deduction)
         VALUES ($1, 0, 0, 0) ON CONFLICT (user_id) DO NOTHING`,
        [uid]
      );
    } else {
      // Đổi sang khách hàng → xóa bản ghi lương
      await pool.query(`DELETE FROM salary WHERE user_id = $1`, [uid]);
    }
    res.json({ message: "Cập nhật vai trò thành công" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi hệ thống" });
  }
});

app.put("/api/users/:id/toggle", auth, can("admin"), async (req, res) => {
  const uid = parseInt(req.params.id, 10);
  if (uid === req.user.id) {
    return res.status(400).json({ error: "Không thể khóa tài khoản đang đăng nhập" });
  }
  try {
    const result = await pool.query(
      `UPDATE users SET is_active = NOT is_active WHERE id = $1 RETURNING is_active`,
      [uid]
    );
    res.json({
      message: result.rows[0].is_active ? "Đã mở khóa tài khoản" : "Đã khóa tài khoản",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi hệ thống" });
  }
});

app.delete("/api/users/:id", auth, can("admin"), async (req, res) => {
  const uid = parseInt(req.params.id, 10);
  if (uid === req.user.id) {
    return res.status(400).json({ error: "Không thể xóa tài khoản đang đăng nhập" });
  }
  try {
    await pool.query(`DELETE FROM users WHERE id = $1`, [uid]);
    res.json({ message: "Đã xóa tài khoản" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi hệ thống" });
  }
});

// ── PRODUCTS ──────────────────────────────────────────────

app.get("/api/products/public", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM products WHERE is_active = true ORDER BY id`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi hệ thống" });
  }
});

app.get("/api/products", auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM products WHERE is_active = true ORDER BY id`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi hệ thống" });
  }
});

app.post("/api/products", auth, can("admin", "manager", "salesperson"), async (req, res) => {
  const { code, name, category, subcategory, unit, cost_price, selling_price,
          discount_percent, stock, min_stock, icon } = req.body;
  if (!code || !name) {
    return res.status(400).json({ error: "Mã và tên sản phẩm là bắt buộc" });
  }
  try {
    await pool.query(
      `INSERT INTO products
         (code, name, category, subcategory, unit, cost_price, selling_price,
          discount_percent, stock, min_stock, icon)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        code,
        name,
        category || "Khác",
        subcategory || null,
        unit || "Cái",
        cost_price || 0,
        selling_price || 0,
        discount_percent || 0,
        stock || 0,
        min_stock || 10,
        icon || "📦",
      ]
    );
    res.status(201).json({ message: "Thêm sản phẩm thành công" });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Mã sản phẩm đã tồn tại" });
    }
    console.error(err);
    res.status(500).json({ error: "Lỗi hệ thống" });
  }
});

app.put("/api/products/:id", auth, can("admin", "manager", "salesperson"), async (req, res) => {
  const { name, category, subcategory, unit, cost_price, selling_price,
          discount_percent, stock, min_stock, icon } = req.body;
  try {
    await pool.query(
      `UPDATE products SET
         name=$1, category=$2, subcategory=$3, unit=$4,
         cost_price=$5, selling_price=$6, discount_percent=$7,
         stock=$8, min_stock=$9, icon=$10
       WHERE id = $11`,
      [
        name, category, subcategory || null, unit,
        cost_price, selling_price, discount_percent || 0,
        stock, min_stock, icon, req.params.id,
      ]
    );
    res.json({ message: "Cập nhật thành công" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi hệ thống" });
  }
});

app.delete("/api/products/:id", auth, can("admin", "manager"), async (req, res) => {
  try {
    await pool.query(`UPDATE products SET is_active = false WHERE id = $1`, [req.params.id]);
    res.json({ message: "Đã xóa sản phẩm" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi hệ thống" });
  }
});

// ── IMPORT EXCEL ──────────────────────────────────────────

app.post("/api/import/products", auth, can("admin", "manager"), upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Vui lòng chọn file Excel" });
  }
  try {
    const wb   = XLSX.read(req.file.buffer, { type: "buffer" });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    let ok = 0, skip = 0;
    for (const row of rows) {
      const code = String(row["Mã SP"]         || row["code"] || "").trim();
      const name = String(row["Tên sản phẩm"]  || row["name"] || "").trim();
      if (!code || !name) { skip++; continue; }
      try {
        await pool.query(
          `INSERT INTO products (code, name, category, unit, cost_price, selling_price, stock, min_stock, icon)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (code) DO UPDATE SET
             name=$2, category=$3, unit=$4,
             cost_price=$5, selling_price=$6,
             stock=$7, min_stock=$8, icon=$9`,
          [
            code,
            name,
            String(row["Danh mục"]      || row["category"]    || "Khác").trim(),
            String(row["Đơn vị"]        || row["unit"]        || "Cái").trim(),
            parseInt(row["Giá nhập"]    || row["cost_price"]  || 0, 10),
            parseInt(row["Giá bán"]     || row["selling_price"]|| 0, 10),
            parseInt(row["Tồn kho"]     || row["stock"]       || 0, 10),
            parseInt(row["Tồn tối thiểu"]|| row["min_stock"]  || 10, 10),
            String(row["Icon"]          || row["icon"]        || "📦").trim(),
          ]
        );
        ok++;
      } catch (_) {
        skip++;
      }
    }
    res.json({
      message: `Import thành công ${ok} sản phẩm${skip ? `, bỏ qua ${skip} dòng` : ""}`,
      ok,
      skip,
    });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: "Lỗi đọc file Excel" });
  }
});

app.post("/api/import/staff", auth, can("admin"), upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Vui lòng chọn file Excel" });
  }
  const roleMap = {
    "Quản trị viên": 1,
    "Quản lý cửa hàng": 2,
    "Thu ngân": 3,
    "Nhân viên kho": 4,
    "Nhân viên giao hàng": 5,
    "Nhân viên bán hàng": 6,
    "Khách hàng": 7,
  };
  try {
    const wb   = XLSX.read(req.file.buffer, { type: "buffer" });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    let ok = 0, skip = 0;
    for (const row of rows) {
      // Ép về string — tránh lỗi khi Excel lưu dạng số
      const username  = String(row["Tên đăng nhập"] || row["username"]  || "").trim();
      const password  = String(row["Mật khẩu"]      || row["password"]  || "").trim();
      const full_name = String(row["Họ và tên"]      || row["full_name"] || "").trim();
      if (!username || !password || !full_name) {
        console.log("⚠️  Bỏ qua dòng thiếu dữ liệu:", JSON.stringify(row));
        skip++;
        continue;
      }
      try {
        const hash = await bcrypt.hash(password, 10);
        await pool.query(
          `INSERT INTO users (username, password_hash, full_name, email, phone, role_id)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (username) DO UPDATE SET
             password_hash=$2, full_name=$3, email=$4, phone=$5, role_id=$6`,
          [
            username,
            hash,
            full_name,
            String(row["Email"]           || row["email"] || "").trim() || null,
            String(row["Số điện thoại"]   || row["phone"] || "").trim() || null,
            roleMap[String(row["Vai trò"] || row["role"]  || "Thu ngân").trim()] || 3,
          ]
        );
        ok++;
      } catch (rowErr) {
        console.error("⚠️  Lỗi import dòng:", username, rowErr.message);
        skip++;
      }
    }
    res.json({
      message: `Import thành công ${ok} nhân viên${skip ? `, bỏ qua ${skip} dòng` : ""}`,
      ok,
      skip,
    });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: "Lỗi đọc file Excel" });
  }
});

// ── ORDERS ────────────────────────────────────────────────

app.get("/api/orders", auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT o.*, u.full_name AS cashier_name
       FROM orders o LEFT JOIN users u ON o.cashier_id = u.id
       ORDER BY o.created_at DESC LIMIT 300`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi hệ thống" });
  }
});

// QUAN TRỌNG: route tĩnh phải đặt TRƯỚC /:id
app.get("/api/orders/my-shift", auth, async (req, res) => {
  const today = new Date().toISOString().split("T")[0];
  try {
    const result = await pool.query(
      `SELECT o.*, u.full_name AS cashier_name
       FROM orders o LEFT JOIN users u ON o.cashier_id = u.id
       WHERE o.cashier_id = $1 AND DATE(o.created_at) = $2
       ORDER BY o.created_at DESC`,
      [req.user.id, today]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi hệ thống" });
  }
});

app.get("/api/orders/my-orders", auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM orders WHERE customer_id = $1 ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi hệ thống" });
  }
});

app.get("/api/orders/delivery-pending", auth, can("admin", "manager"), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT o.*, u.full_name AS cashier_name
       FROM orders o LEFT JOIN users u ON o.cashier_id = u.id
       WHERE o.delivery_status = 'pending'
       ORDER BY o.created_at ASC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi hệ thống" });
  }
});

app.get("/api/orders/my-deliveries", auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM orders
       WHERE delivery_id = $1 AND delivery_status IN ('shipping','pending')
       ORDER BY created_at ASC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi hệ thống" });
  }
});

app.post("/api/orders", auth, can("admin", "manager", "cashier", "salesperson", "customer"), async (req, res) => {
  const {
    customer_name,
    customer_id,
    items,
    discount = 0,
    payment_method = "cash",
    delivery_address,
    notes,
    voucher_code,
  } = req.body;

  if (!items || items.length === 0) {
    return res.status(400).json({ error: "Giỏ hàng trống" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const subtotal    = items.reduce((sum, item) => sum + item.price * item.qty, 0);
    const vat         = Math.round((subtotal - discount) * 0.1);
    const total       = subtotal - discount + vat;
    const orderCode   = "DH" + Date.now();
    const delivStatus = delivery_address ? "pending" : "none";

    const orderResult = await client.query(
      `INSERT INTO orders
         (order_code, customer_name, customer_id, subtotal, discount,
          vat, total, payment_method, cashier_id,
          delivery_status, delivery_address, notes, voucher_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id`,
      [
        orderCode,
        customer_name || "Khách lẻ",
        customer_id   || null,
        subtotal,
        discount,
        vat,
        total,
        payment_method,
        req.user.id,
        delivStatus,
        delivery_address || null,
        notes            || null,
        voucher_code     || null,
      ]
    );
    const orderId = orderResult.rows[0].id;

    for (const item of items) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, product_name, qty, price)
         VALUES ($1,$2,$3,$4,$5)`,
        [orderId, item.product_id || null, item.name, item.qty, item.price]
      );
      if (item.product_id) {
        await client.query(
          `UPDATE products SET stock = stock - $1 WHERE id = $2`,
          [item.qty, item.product_id]
        );
      }
    }

    if (voucher_code) {
      await client.query(
        `UPDATE vouchers SET used_count = used_count + 1 WHERE code = $1`,
        [voucher_code]
      );
      if (customer_id) {
        await client.query(
          `UPDATE user_vouchers SET used = true
           WHERE user_id = $1
             AND voucher_id = (SELECT id FROM vouchers WHERE code = $2)`,
          [customer_id, voucher_code]
        );
      }
    }

    if (customer_id) {
      const pts = Math.floor(total / 10000);
      await client.query(
        `UPDATE customer_profiles
         SET total_spent = total_spent + $1, points = points + $2
         WHERE user_id = $3`,
        [total, pts, customer_id]
      );
    }

    await client.query("COMMIT");
    res.status(201).json({ message: "Thanh toán thành công", order_id: orderId, total });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Lỗi xử lý đơn hàng" });
  } finally {
    client.release();
  }
});

app.put("/api/orders/:id/status", auth, can("admin", "manager", "cashier"), async (req, res) => {
  try {
    await pool.query(`UPDATE orders SET status = $1 WHERE id = $2`, [
      req.body.status, req.params.id,
    ]);
    res.json({ message: "Cập nhật trạng thái thành công" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi hệ thống" });
  }
});

app.put("/api/orders/:id/assign-delivery", auth, can("admin", "manager"), async (req, res) => {
  const { delivery_id } = req.body;
  if (!delivery_id) {
    return res.status(400).json({ error: "Thiếu delivery_id" });
  }
  try {
    const result = await pool.query(
      `UPDATE orders
       SET delivery_id = $1, delivery_status = 'shipping'
       WHERE id = $2 RETURNING id`,
      [parseInt(delivery_id, 10), req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Không tìm thấy đơn hàng" });
    }
    res.json({ message: "Đã phân công giao hàng thành công" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi phân công: " + err.message });
  }
});

app.put("/api/orders/:id/delivery", auth, async (req, res) => {
  try {
    await pool.query(`UPDATE orders SET delivery_status = $1 WHERE id = $2`, [
      req.body.delivery_status, req.params.id,
    ]);
    res.json({ message: "Cập nhật giao hàng thành công" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi hệ thống" });
  }
});

// ── ADDRESSES ─────────────────────────────────────────────

app.get("/api/addresses", auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM delivery_addresses
       WHERE user_id = $1 ORDER BY is_default DESC, id DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi hệ thống" });
  }
});

app.post("/api/addresses", auth, async (req, res) => {
  const { address, label, is_default } = req.body;
  try {
    if (is_default) {
      await pool.query(
        `UPDATE delivery_addresses SET is_default = false WHERE user_id = $1`,
        [req.user.id]
      );
    }
    await pool.query(
      `INSERT INTO delivery_addresses (user_id, address, label, is_default)
       VALUES ($1,$2,$3,$4)`,
      [req.user.id, address, label || null, is_default || false]
    );
    res.status(201).json({ message: "Đã thêm địa chỉ" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi hệ thống" });
  }
});

app.delete("/api/addresses/:id", auth, async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM delivery_addresses WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    res.json({ message: "Đã xóa địa chỉ" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi hệ thống" });
  }
});

// ── VOUCHERS ──────────────────────────────────────────────

app.get("/api/vouchers", auth, can("admin", "manager"), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT v.*, COUNT(uv.id) AS assigned_count
       FROM vouchers v
       LEFT JOIN user_vouchers uv ON v.id = uv.voucher_id
       GROUP BY v.id ORDER BY v.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi hệ thống" });
  }
});

// QUAN TRỌNG: /check phải đặt TRƯỚC /:id
app.post("/api/vouchers/check", async (req, res) => {
  const { code, order_total } = req.body;
  if (!code) {
    return res.status(400).json({ error: "Thiếu mã voucher" });
  }
  try {
    const result = await pool.query(
      `SELECT * FROM vouchers WHERE code = $1 AND is_active = true`,
      [code.toUpperCase().trim()]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Mã voucher không tồn tại hoặc đã hết hiệu lực" });
    }
    const voucher = result.rows[0];
    if (voucher.used_count >= voucher.max_uses) {
      return res.status(400).json({ error: "Voucher đã hết lượt sử dụng" });
    }
    if (voucher.expires_at && new Date(voucher.expires_at) < new Date()) {
      return res.status(400).json({ error: "Voucher đã hết hạn" });
    }
    if (order_total < voucher.min_order) {
      return res.status(400).json({
        error: `Đơn hàng tối thiểu ${Number(voucher.min_order).toLocaleString("vi-VN")}đ`,
      });
    }
    const discount = voucher.discount_type === "percent"
      ? Math.round((order_total * voucher.discount_value) / 100)
      : voucher.discount_value;
    res.json({ valid: true, voucher, discount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi hệ thống" });
  }
});

app.post("/api/vouchers/assign", auth, can("admin", "manager"), async (req, res) => {
  const { user_id, voucher_id } = req.body;
  try {
    await pool.query(
      `INSERT INTO user_vouchers (user_id, voucher_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [user_id, voucher_id]
    );
    res.json({ message: "Đã gán voucher thành công" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi hệ thống" });
  }
});

app.post("/api/vouchers/assign-bulk", auth, can("admin", "manager"), async (req, res) => {
  const { voucher_id, role_id } = req.body;
  try {
    const users = role_id
      ? await pool.query(`SELECT id FROM users WHERE role_id = $1 AND is_active = true`, [role_id])
      : await pool.query(`SELECT id FROM users WHERE is_active = true`);
    let ok = 0;
    for (const u of users.rows) {
      try {
        await pool.query(
          `INSERT INTO user_vouchers (user_id, voucher_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [u.id, voucher_id]
        );
        ok++;
      } catch (_) { /* bỏ qua trùng */ }
    }
    res.json({ message: `Đã gán voucher cho ${ok} người dùng` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi hệ thống" });
  }
});

app.post("/api/vouchers", auth, can("admin", "manager"), async (req, res) => {
  const { code, description, discount_type, discount_value, min_order, max_uses, expires_at } = req.body;
  if (!code || !discount_value) {
    return res.status(400).json({ error: "Thiếu thông tin bắt buộc" });
  }
  try {
    await pool.query(
      `INSERT INTO vouchers (code, description, discount_type, discount_value, min_order, max_uses, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        code.toUpperCase().trim(),
        description   || null,
        discount_type || "percent",
        discount_value,
        min_order  || 0,
        max_uses   || 100,
        expires_at || null,
      ]
    );
    res.status(201).json({ message: "Tạo voucher thành công" });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Mã voucher đã tồn tại" });
    }
    console.error(err);
    res.status(500).json({ error: "Lỗi hệ thống" });
  }
});

app.put("/api/vouchers/:id", auth, can("admin", "manager"), async (req, res) => {
  const { description, discount_value, min_order, max_uses, is_active, expires_at } = req.body;
  try {
    await pool.query(
      `UPDATE vouchers SET
         description=$1, discount_value=$2, min_order=$3,
         max_uses=$4, is_active=$5, expires_at=$6
       WHERE id = $7`,
      [description, discount_value, min_order, max_uses, is_active, expires_at || null, req.params.id]
    );
    res.json({ message: "Cập nhật voucher thành công" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi hệ thống" });
  }
});

app.get("/api/my-vouchers", auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT v.*, uv.used, uv.assigned_at
       FROM user_vouchers uv JOIN vouchers v ON uv.voucher_id = v.id
       WHERE uv.user_id = $1 ORDER BY uv.assigned_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi hệ thống" });
  }
});

// ── ATTENDANCE ────────────────────────────────────────────

app.post("/api/attendance/checkin", auth, async (req, res) => {
  const today = new Date().toISOString().split("T")[0];
  try {
    await pool.query(
      `INSERT INTO attendance (user_id, date, checkin, status)
       VALUES ($1,$2,NOW(),'present')
       ON CONFLICT (user_id, date) DO UPDATE SET checkin = NOW()`,
      [req.user.id, today]
    );
    res.json({
      message: "Điểm danh vào ca thành công",
      time: new Date().toLocaleTimeString("vi-VN"),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi hệ thống: " + err.message });
  }
});

app.post("/api/attendance/checkout", auth, async (req, res) => {
  const today = new Date().toISOString().split("T")[0];
  try {
    const result = await pool.query(
      `UPDATE attendance SET checkout = NOW()
       WHERE user_id = $1 AND date = $2 RETURNING *`,
      [req.user.id, today]
    );
    if (result.rows.length === 0) {
      return res.status(400).json({ error: "Chưa điểm danh vào ca hôm nay" });
    }
    res.json({
      message: "Kết thúc ca thành công",
      time: new Date().toLocaleTimeString("vi-VN"),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi hệ thống: " + err.message });
  }
});

app.get("/api/attendance/my", auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM attendance WHERE user_id = $1 ORDER BY date DESC LIMIT 30`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi hệ thống" });
  }
});

app.get("/api/attendance", auth, can("admin", "manager"), async (req, res) => {
  const target = req.query.date || new Date().toISOString().split("T")[0];
  try {
    const result = await pool.query(
      `SELECT a.*, u.full_name, u.username, ro.display_name AS role_display
       FROM attendance a
       JOIN users u  ON a.user_id = u.id
       JOIN roles ro ON u.role_id = ro.id
       WHERE a.date = $1
       ORDER BY a.checkin ASC NULLS LAST`,
      [target]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi hệ thống" });
  }
});

// ── SALARY ────────────────────────────────────────────────

app.get("/api/salary", auth, can("admin", "manager"), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.*, u.full_name, u.username, ro.display_name AS role_display
       FROM salary s
       JOIN users u  ON s.user_id = u.id
       JOIN roles ro ON u.role_id = ro.id
       ORDER BY u.full_name`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi hệ thống" });
  }
});

app.get("/api/salary/:userId", auth, async (req, res) => {
  const uid = parseInt(req.params.userId, 10);
  if (isNaN(uid)) {
    return res.status(400).json({ error: "userId không hợp lệ" });
  }
  if (req.user.id !== uid && !["admin", "manager"].includes(req.user.role)) {
    return res.status(403).json({ error: "Không có quyền" });
  }
  try {
    const result = await pool.query(
      `SELECT s.*, u.full_name FROM salary s JOIN users u ON s.user_id = u.id WHERE s.user_id = $1`,
      [uid]
    );
    if (result.rows.length === 0) {
      return res.json({ user_id: uid, base_salary: 0, bonus: 0, deduction: 0 });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi hệ thống" });
  }
});

app.put("/api/salary/:userId", auth, can("admin", "manager"), async (req, res) => {
  const uid    = parseInt(req.params.userId, 10);
  if (isNaN(uid)) {
    return res.status(400).json({ error: "userId không hợp lệ" });
  }
  const base   = parseInt(req.body.base_salary, 10) || 0;
  const bonus  = parseInt(req.body.bonus,       10) || 0;
  const deduct = parseInt(req.body.deduction,   10) || 0;
  try {
    await pool.query(
      `INSERT INTO salary (user_id, base_salary, bonus, deduction, updated_at)
       VALUES ($1,$2,$3,$4,NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         base_salary=$2, bonus=$3, deduction=$4, updated_at=NOW()`,
      [uid, base, bonus, deduct]
    );
    res.json({ message: "Cập nhật lương thành công" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi cập nhật lương: " + err.message });
  }
});

// ── FEEDBACK ──────────────────────────────────────────────

app.post("/api/feedback", async (req, res) => {
  const { name, content, rating, user_id } = req.body;
  if (!content) {
    return res.status(400).json({ error: "Nội dung không được trống" });
  }
  try {
    await pool.query(
      `INSERT INTO feedback (user_id, name, content, rating) VALUES ($1,$2,$3,$4)`,
      [user_id || null, name || "Khách hàng", content, rating || 5]
    );
    res.status(201).json({ message: "Cảm ơn bạn đã gửi phản hồi!" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi hệ thống" });
  }
});

app.get("/api/feedback", auth, can("admin", "manager"), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT f.*, u.username
       FROM feedback f LEFT JOIN users u ON f.user_id = u.id
       ORDER BY f.created_at DESC LIMIT 100`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi hệ thống" });
  }
});

app.put("/api/feedback/:id/status", auth, can("admin", "manager"), async (req, res) => {
  try {
    await pool.query(`UPDATE feedback SET status = $1 WHERE id = $2`, [
      req.body.status, req.params.id,
    ]);
    res.json({ message: "Cập nhật trạng thái thành công" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi hệ thống" });
  }
});

// ── MY STATS ──────────────────────────────────────────────

app.get("/api/my-stats", auth, async (req, res) => {
  const today = new Date().toISOString().split("T")[0];
  try {
    const [ordersResult, attResult] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) AS cnt, COALESCE(SUM(total),0) AS rev
         FROM orders WHERE cashier_id = $1 AND DATE(created_at) = $2`,
        [req.user.id, today]
      ),
      pool.query(
        `SELECT checkin, checkout FROM attendance WHERE user_id = $1 AND date = $2`,
        [req.user.id, today]
      ),
    ]);
    const att   = attResult.rows[0] || {};
    let hours   = 0;
    if (att.checkin && att.checkout) {
      hours = ((new Date(att.checkout) - new Date(att.checkin)) / 3600000).toFixed(1);
    }
    res.json({
      orders_today:  parseInt(ordersResult.rows[0].cnt, 10),
      revenue_today: parseInt(ordersResult.rows[0].rev, 10),
      checkin:       att.checkin  || null,
      checkout:      att.checkout || null,
      hours_worked:  hours,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi hệ thống" });
  }
});

// ── CUSTOMERS ─────────────────────────────────────────────

app.get("/api/customers", auth, can("admin", "manager", "cashier"), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.username, u.full_name, u.email, u.phone,
              u.created_at, cp.rank, cp.points, cp.total_spent
       FROM users u
       JOIN roles ro ON u.role_id = ro.id
       LEFT JOIN customer_profiles cp ON u.id = cp.user_id
       WHERE ro.name = 'customer'
       ORDER BY cp.total_spent DESC NULLS LAST`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi hệ thống" });
  }
});

// ── DASHBOARD STATS ───────────────────────────────────────

app.get("/api/stats", auth, can("admin", "manager"), async (req, res) => {
  const today = new Date().toISOString().split("T")[0];
  try {
    const [rev, ord, cust, low] = await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM(total),0) AS v FROM orders WHERE DATE(created_at) = $1 AND status = 'done'`,
        [today]
      ),
      pool.query(
        `SELECT COUNT(*) AS v FROM orders WHERE DATE(created_at) = $1`,
        [today]
      ),
      pool.query(`SELECT COUNT(*) AS v FROM users WHERE role_id = 7`),
      pool.query(`SELECT COUNT(*) AS v FROM products WHERE stock <= min_stock AND is_active = true`),
    ]);

    const dayLabels = ["CN","T2","T3","T4","T5","T6","T7"];
    const weekly   = [];
    for (let i = 6; i >= 0; i--) {
      const d  = new Date();
      d.setDate(d.getDate() - i);
      const ds = d.toISOString().split("T")[0];
      const r  = await pool.query(
        `SELECT COALESCE(SUM(total),0) AS v FROM orders WHERE DATE(created_at) = $1 AND status = 'done'`,
        [ds]
      );
      weekly.push({ label: dayLabels[d.getDay()], rev: parseInt(r.rows[0].v, 10) });
    }

    res.json({
      revenue_today:   parseInt(rev.rows[0].v,  10),
      orders_today:    parseInt(ord.rows[0].v,  10),
      customers:       parseInt(cust.rows[0].v, 10),
      low_stock:       parseInt(low.rows[0].v,  10),
      today_revenue:   parseInt(rev.rows[0].v,  10),
      today_orders:    parseInt(ord.rows[0].v,  10),
      total_customers: parseInt(cust.rows[0].v, 10),
      weekly,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi thống kê" });
  }
});

app.get("/api/admin/summary", auth, can("admin", "manager"), async (req, res) => {
  try {
    const [users, prods, orders, lowStock, pendingDeliv, pendingFb, vouchers] =
      await Promise.all([
        pool.query(`SELECT COUNT(*) AS v FROM users WHERE is_active = true`),
        pool.query(`SELECT COUNT(*) AS v FROM products WHERE is_active = true`),
        pool.query(`SELECT COUNT(*) AS v, COALESCE(SUM(total),0) AS rev FROM orders WHERE status = 'done'`),
        pool.query(`SELECT COUNT(*) AS v FROM products WHERE stock <= min_stock AND is_active = true`),
        pool.query(`SELECT COUNT(*) AS v FROM orders WHERE delivery_status = 'pending'`),
        pool.query(`SELECT COUNT(*) AS v FROM feedback WHERE status = 'pending'`),
        pool.query(`SELECT COUNT(*) AS v FROM vouchers WHERE is_active = true`),
      ]);
    res.json({
      total_users:      parseInt(users.rows[0].v,       10),
      total_products:   parseInt(prods.rows[0].v,       10),
      total_orders:     parseInt(orders.rows[0].v,      10),
      total_revenue:    parseInt(orders.rows[0].rev,    10),
      low_stock:        parseInt(lowStock.rows[0].v,    10),
      pending_delivery: parseInt(pendingDeliv.rows[0].v,10),
      pending_feedback: parseInt(pendingFb.rows[0].v,   10),
      active_vouchers:  parseInt(vouchers.rows[0].v,    10),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi hệ thống" });
  }
});

// ── REPORTS ───────────────────────────────────────────────

app.get("/api/reports/revenue", auth, can("admin", "manager"), async (req, res) => {
  const days = Math.min(parseInt(req.query.days, 10) || 30, 365);
  try {
    const result = await pool.query(
      `SELECT DATE(created_at) AS date,
              COUNT(*) AS order_count,
              COALESCE(SUM(total),0)    AS revenue,
              COALESCE(SUM(discount),0) AS total_discount
       FROM orders
       WHERE created_at >= NOW() - INTERVAL '${days} days' AND status = 'done'
       GROUP BY DATE(created_at)
       ORDER BY date DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi báo cáo doanh thu" });
  }
});

app.get("/api/reports/top-products", auth, can("admin", "manager"), async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
  try {
    const result = await pool.query(
      `SELECT oi.product_name,
              COALESCE(oi.product_id, 0) AS product_id,
              SUM(oi.qty)                AS total_qty,
              SUM(oi.qty * oi.price)     AS total_revenue
       FROM order_items oi JOIN orders o ON oi.order_id = o.id
       WHERE o.status = 'done'
       GROUP BY oi.product_name, oi.product_id
       ORDER BY total_qty DESC LIMIT $1`,
      [limit]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi báo cáo sản phẩm" });
  }
});

app.get("/api/reports/categories", auth, can("admin", "manager"), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.category,
              COUNT(DISTINCT p.id)             AS product_count,
              COALESCE(SUM(oi.qty),0)          AS total_sold,
              COALESCE(SUM(oi.qty * oi.price),0) AS revenue
       FROM products p
       LEFT JOIN order_items oi ON p.id = oi.product_id
       LEFT JOIN orders o ON oi.order_id = o.id AND o.status = 'done'
       WHERE p.is_active = true
       GROUP BY p.category ORDER BY revenue DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi báo cáo danh mục" });
  }
});

app.get("/api/reports/staff-stats", auth, can("admin", "manager"), async (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  try {
    const result = await pool.query(
      `SELECT u.id, u.full_name, u.username,
              ro.display_name              AS role_display,
              COUNT(DISTINCT a.date)       AS days_worked,
              COUNT(DISTINCT o.id)         AS orders_handled,
              COALESCE(SUM(o.total),0)     AS revenue_handled,
              COALESCE(s.base_salary,0)    AS base_salary,
              COALESCE(s.bonus,0)          AS bonus,
              COALESCE(s.deduction,0)      AS deduction
       FROM users u
       JOIN roles ro ON u.role_id = ro.id
       LEFT JOIN attendance a ON u.id = a.user_id AND TO_CHAR(a.date,'YYYY-MM') = $1
       LEFT JOIN orders o
         ON u.id = o.cashier_id
         AND TO_CHAR(o.created_at,'YYYY-MM') = $1
         AND o.status = 'done'
       LEFT JOIN salary s ON u.id = s.user_id
       WHERE u.is_active = true AND ro.name != 'customer'
       GROUP BY u.id, u.full_name, u.username, ro.display_name,
                s.base_salary, s.bonus, s.deduction
       ORDER BY revenue_handled DESC`,
      [month]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi báo cáo nhân viên" });
  }
});

app.get("/api/reports/export", auth, can("admin", "manager"), async (req, res) => {
  const type = req.query.type || "revenue";
  const days = Math.min(parseInt(req.query.days, 10) || 30, 365);
  try {
    let csv = "\uFEFF"; // BOM UTF-8

    if (type === "revenue") {
      const r = await pool.query(
        `SELECT DATE(created_at) AS date, COUNT(*) AS orders, COALESCE(SUM(total),0) AS revenue
         FROM orders
         WHERE created_at >= NOW() - INTERVAL '${days} days' AND status = 'done'
         GROUP BY DATE(created_at) ORDER BY date DESC`
      );
      csv += "Ngày,Số đơn,Doanh thu\n";
      csv += r.rows.map((row) => `${row.date},${row.orders},${row.revenue}`).join("\n");

    } else if (type === "products") {
      const r = await pool.query(
        `SELECT oi.product_name, SUM(oi.qty) AS qty, SUM(oi.qty * oi.price) AS revenue
         FROM order_items oi JOIN orders o ON oi.order_id = o.id
         WHERE o.status = 'done'
         GROUP BY oi.product_name ORDER BY qty DESC LIMIT 50`
      );
      csv += "Sản phẩm,Số lượng bán,Doanh thu\n";
      csv += r.rows.map((row) => `"${row.product_name}",${row.qty},${row.revenue}`).join("\n");

    } else if (type === "staff") {
      const month = new Date().toISOString().slice(0, 7);
      const r = await pool.query(
        `SELECT u.full_name, ro.display_name AS role,
                COUNT(DISTINCT a.date)   AS days_worked,
                COUNT(DISTINCT o.id)     AS orders,
                COALESCE(SUM(o.total),0) AS revenue,
                COALESCE(s.base_salary,0) + COALESCE(s.bonus,0) - COALESCE(s.deduction,0) AS net_salary
         FROM users u
         JOIN roles ro ON u.role_id = ro.id
         LEFT JOIN attendance a ON u.id = a.user_id AND TO_CHAR(a.date,'YYYY-MM') = $1
         LEFT JOIN orders o
           ON u.id = o.cashier_id AND TO_CHAR(o.created_at,'YYYY-MM') = $1 AND o.status = 'done'
         LEFT JOIN salary s ON u.id = s.user_id
         WHERE u.is_active = true AND ro.name != 'customer'
         GROUP BY u.full_name, ro.display_name, s.base_salary, s.bonus, s.deduction
         ORDER BY revenue DESC`,
        [month]
      );
      csv += "Nhân viên,Vai trò,Ngày làm,Đơn xử lý,Doanh thu,Thực nhận\n";
      csv += r.rows
        .map((row) => `"${row.full_name}","${row.role}",${row.days_worked},${row.orders},${row.revenue},${row.net_salary}`)
        .join("\n");

    } else if (type === "categories") {
      const r = await pool.query(
        `SELECT p.category,
                COUNT(DISTINCT p.id)             AS products,
                COALESCE(SUM(oi.qty),0)          AS sold,
                COALESCE(SUM(oi.qty * oi.price),0) AS revenue
         FROM products p
         LEFT JOIN order_items oi ON p.id = oi.product_id
         LEFT JOIN orders o ON oi.order_id = o.id AND o.status = 'done'
         WHERE p.is_active = true
         GROUP BY p.category ORDER BY revenue DESC`
      );
      csv += "Danh mục,Số SP,Đã bán,Doanh thu\n";
      csv += r.rows
        .map((row) => `"${row.category}",${row.products},${row.sold},${row.revenue}`)
        .join("\n");
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=baocao_${type}_${Date.now()}.csv`);
    res.send(csv);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi xuất báo cáo" });
  }
});

// ── HEALTH CHECK ──────────────────────────────────────────

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", time: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ── SERVE FRONTEND ────────────────────────────────────────

app.get("/app.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "app.html"));
});

// Fallback cho SPA
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ── KHỞI ĐỘNG ─────────────────────────────────────────────

initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🚀 MiciMart chạy tại http://localhost:${PORT}`);
      console.log(`📦 Môi trường: ${process.env.NODE_ENV || "development"}`);
    });
  })
  .catch((err) => {
    console.error("❌ Lỗi khởi động:", err.message);
    process.exit(1);
  });
