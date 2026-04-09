/**
 * DEMO 4 – Giỏ hàng & Cache (Redis)
 * ====================================
 * Các chức năng:
 *  1. CartManager  – Giỏ hàng tạm (TTL 2h)
 *  2. SessionManager – Quản lý session user
 *  3. OTPManager   – Quản lý OTP xác thực
 *  4. RateLimiter  – Giới hạn request/phút
 *  5. MenuCache    – Cache danh sách top món
 */

require("dotenv").config();
const redis = require("redis");
const chalk = require("chalk");

const client = redis.createClient({ url: process.env.REDIS_URL || "redis://localhost:6379" });

client.on("error", (err) => console.error("Redis error:", err));

// ─── 1. Cart Manager ──────────────────────────────────────────────────────────
const CartManager = {
  key: (userId) => `cart:${userId}`,

  async get(userId) {
    const raw = await client.get(this.key(userId));
    return raw ? JSON.parse(raw) : { items: [], restaurant_id: null, restaurant_name: null };
  },

  async add(userId, item) {
    const cart = await this.get(userId);

    // Kiểm tra cùng nhà hàng
    if (cart.restaurant_id && cart.restaurant_id !== item.restaurant_id) {
      return { error: "Không thể thêm món từ nhà hàng khác. Xóa giỏ hàng trước?" };
    }

    const existing = cart.items.findIndex(i => i.item_id === item.item_id);
    if (existing >= 0) {
      cart.items[existing].qty      += item.qty;
      cart.items[existing].subtotal  = cart.items[existing].price * cart.items[existing].qty;
    } else {
      cart.items.push({ ...item, subtotal: item.price * item.qty });
    }

    cart.restaurant_id   = item.restaurant_id;
    cart.restaurant_name = item.restaurant_name;
    cart.updated_at      = new Date().toISOString();
    cart.total           = cart.items.reduce((s, x) => s + x.subtotal, 0);

    await client.setEx(this.key(userId), 7200, JSON.stringify(cart));  // TTL 2h
    return cart;
  },

  async remove(userId, itemId) {
    const cart = await this.get(userId);
    cart.items  = cart.items.filter(i => i.item_id !== itemId);
    cart.total  = cart.items.reduce((s, x) => s + x.subtotal, 0);
    if (cart.items.length === 0) cart.restaurant_id = null;
    await client.setEx(this.key(userId), 7200, JSON.stringify(cart));
    return cart;
  },

  async updateQty(userId, itemId, qty) {
    const cart = await this.get(userId);
    const item = cart.items.find(i => i.item_id === itemId);
    if (!item) return { error: "Món không tồn tại trong giỏ" };
    if (qty <= 0) return this.remove(userId, itemId);
    item.qty      = qty;
    item.subtotal = item.price * qty;
    cart.total    = cart.items.reduce((s, x) => s + x.subtotal, 0);
    await client.setEx(this.key(userId), 7200, JSON.stringify(cart));
    return cart;
  },

  async clear(userId) {
    await client.del(this.key(userId));
    return { message: "Đã xóa giỏ hàng" };
  },

  async getTTL(userId) {
    return client.ttl(this.key(userId));
  },
};

// ─── 2. Session Manager ───────────────────────────────────────────────────────
const SessionManager = {
  key: (sessionId) => `session:${sessionId}`,

  async create(userId, userData) {
    const sessionId = `sess_${userId}_${Date.now()}_${Math.random().toString(36).substr(2,6)}`;
    const payload   = { userId, ...userData, created_at: new Date().toISOString() };
    await client.setEx(this.key(sessionId), 86400, JSON.stringify(payload)); // TTL 24h
    return sessionId;
  },

  async get(sessionId) {
    const raw = await client.get(this.key(sessionId));
    return raw ? JSON.parse(raw) : null;
  },

  async refresh(sessionId) {
    const session = await this.get(sessionId);
    if (!session) return null;
    await client.expire(this.key(sessionId), 86400);
    return session;
  },

  async destroy(sessionId) {
    await client.del(this.key(sessionId));
  },
};

// ─── 3. OTP Manager ───────────────────────────────────────────────────────────
const OTPManager = {
  key: (phone) => `otp:${phone}`,

  async generate(phone) {
    const otp     = String(Math.floor(100000 + Math.random() * 900000));
    const payload = { otp, attempts: 0, created_at: new Date().toISOString() };
    await client.setEx(this.key(phone), 300, JSON.stringify(payload));  // TTL 5 phút
    return otp;
  },

  async verify(phone, inputOtp) {
    const raw = await client.get(this.key(phone));
    if (!raw) return { valid: false, reason: "OTP hết hạn hoặc không tồn tại" };

    const data = JSON.parse(raw);
    data.attempts++;

    if (data.attempts > 3) {
      await client.del(this.key(phone));
      return { valid: false, reason: "Quá số lần thử. Yêu cầu OTP mới." };
    }

    if (data.otp !== inputOtp) {
      await client.set(this.key(phone), JSON.stringify(data), { KEEPTTL: true });
      return { valid: false, reason: `Sai OTP. Còn ${3 - data.attempts} lần thử.` };
    }

    await client.del(this.key(phone));
    return { valid: true };
  },
};

// ─── 4. Rate Limiter ──────────────────────────────────────────────────────────
const RateLimiter = {
  async check(identifier, limit = 10, windowSeconds = 60) {
    const key     = `rl:${identifier}`;
    const current = await client.incr(key);
    if (current === 1) await client.expire(key, windowSeconds);
    const ttl = await client.ttl(key);
    return {
      allowed:   current <= limit,
      current,
      limit,
      remaining: Math.max(0, limit - current),
      reset_in:  ttl,
    };
  },
};

// ─── 5. Menu Cache ────────────────────────────────────────────────────────────
const MenuCache = {
  key: (restaurantId) => `menu:${restaurantId}`,
  topKey: () => "top_restaurants",

  async setMenu(restaurantId, menu) {
    await client.setEx(this.key(restaurantId), 1800, JSON.stringify(menu));  // 30 phút
  },

  async getMenu(restaurantId) {
    const raw = await client.get(this.key(restaurantId));
    return raw ? JSON.parse(raw) : null;
  },

  async setTopRestaurants(list) {
    await client.setEx(this.topKey(), 300, JSON.stringify(list));  // 5 phút
  },

  async getTopRestaurants() {
    const raw = await client.get(this.topKey());
    return raw ? JSON.parse(raw) : null;
  },
};

// ─── MAIN: Demo ───────────────────────────────────────────────────────────────
async function main() {
  await client.connect();
  console.log("✅ Kết nối Redis thành công");

  const userId = "user_00042";

  console.log(chalk.blue.bold("\n═══════════════════════════════════════════"));
  console.log(chalk.blue.bold("  DEMO 4 – GIỎ HÀNG & CACHE (Redis)"));
  console.log(chalk.blue.bold("═══════════════════════════════════════════"));

  // ── Giỏ hàng ──────────────────────────────────────────────────────────────
  console.log(chalk.yellow("\n🛒 [1] Quản lý giỏ hàng:"));
  await CartManager.clear(userId);

  let t = Date.now();
  let cart = await CartManager.add(userId, {
    item_id: "item_0001_r0", name: "Phở Bò Tái", price: 65000, qty: 2,
    restaurant_id: "rest_001", restaurant_name: "Phở Hà Nội Ngon",
  });
  console.log(chalk.green(`  ⏱ Thêm item 1: ${Date.now() - t}ms`));

  t = Date.now();
  cart = await CartManager.add(userId, {
    item_id: "item_0002_r0", name: "Phở Gà", price: 55000, qty: 1,
    restaurant_id: "rest_001", restaurant_name: "Phở Hà Nội Ngon",
  });
  console.log(chalk.green(`  ⏱ Thêm item 2: ${Date.now() - t}ms`));

  console.log(`  Giỏ hàng hiện tại (${cart.items.length} món):`);
  cart.items.forEach(i =>
    console.log(`    • ${i.name.padEnd(20)} x${i.qty}  ${i.subtotal.toLocaleString("vi")}đ`)
  );
  console.log(`  Tổng: ${cart.total.toLocaleString("vi")}đ`);
  const ttl = await CartManager.getTTL(userId);
  console.log(`  TTL còn lại: ${ttl} giây`);

  // Thêm từ nhà hàng khác → lỗi
  const conflict = await CartManager.add(userId, {
    item_id: "item_x", name: "Bánh Mì", price: 25000, qty: 1,
    restaurant_id: "rest_002", restaurant_name: "Bánh Mì 37",
  });
  if (conflict.error) console.log(chalk.red(`  ❌ ${conflict.error}`));

  // Cập nhật số lượng
  cart = await CartManager.updateQty(userId, "item_0001_r0", 3);
  console.log(`  Sau cập nhật qty Phở Bò → 3: Tổng ${cart.total.toLocaleString("vi")}đ`);

  // ── Session ───────────────────────────────────────────────────────────────
  console.log(chalk.yellow("\n🔐 [2] Session Manager:"));
  t = Date.now();
  const sessionId = await SessionManager.create(userId, { name: "Nguyễn Văn A", role: "customer" });
  console.log(chalk.green(`  ⏱ Tạo session: ${Date.now() - t}ms`));
  console.log(`  Session ID: ${sessionId}`);

  t = Date.now();
  const session = await SessionManager.get(sessionId);
  console.log(chalk.green(`  ⏱ Lấy session: ${Date.now() - t}ms`));
  console.log(`  Session data: userId=${session.userId}, name=${session.name}`);

  // ── OTP ───────────────────────────────────────────────────────────────────
  console.log(chalk.yellow("\n📱 [3] OTP Manager:"));
  const phone = "0901234567";
  t = Date.now();
  const otp = await OTPManager.generate(phone);
  console.log(chalk.green(`  ⏱ Sinh OTP: ${Date.now() - t}ms`));
  console.log(`  OTP cho ${phone}: ${otp} (hết hạn sau 5 phút)`);

  let verResult = await OTPManager.verify(phone, "000000");
  console.log(`  Nhập sai (000000): ${verResult.reason}`);

  verResult = await OTPManager.verify(phone, otp);
  console.log(`  Nhập đúng (${otp}): ${verResult.valid ? "✅ Xác thực thành công" : verResult.reason}`);

  // ── Rate Limiter ───────────────────────────────────────────────────────────
  console.log(chalk.yellow("\n⚡ [4] Rate Limiter (10 req/phút):"));
  for (let i = 1; i <= 12; i++) {
    const result = await RateLimiter.check(`api:${userId}`, 10, 60);
    const icon = result.allowed ? "✅" : "❌";
    if (i <= 3 || i >= 10) {
      console.log(`  Request ${String(i).padStart(2)}: ${icon} allowed=${result.allowed} | ${result.current}/${result.limit} | còn ${result.remaining}`);
    } else if (i === 4) console.log("  ...");
  }

  // ── Menu Cache ─────────────────────────────────────────────────────────────
  console.log(chalk.yellow("\n⚡ [5] Menu Cache:"));
  const fakeMenu = [
    { item_id: "item_1", name: "Phở Bò Tái", price: 65000 },
    { item_id: "item_2", name: "Phở Gà",     price: 55000 },
  ];

  t = Date.now();
  await MenuCache.setMenu("rest_001", fakeMenu);
  console.log(chalk.green(`  ⏱ Lưu cache menu: ${Date.now() - t}ms`));

  t = Date.now();
  const cached = await MenuCache.getMenu("rest_001");
  console.log(chalk.green(`  ⏱ Đọc cache menu: ${Date.now() - t}ms`));
  console.log(`  Cache hit: ${cached !== null} | ${cached?.length} items`);

  await client.quit();
}

main().catch(console.error);
