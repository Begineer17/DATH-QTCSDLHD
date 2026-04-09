/**
 * DEMO 5 – Leaderboard & Pub/Sub (Redis nâng cao)
 * =================================================
 * Các chức năng:
 *  1. RestaurantLeaderboard – Xếp hạng nhà hàng theo điểm (Sorted Set)
 *  2. RealtimeNotifier      – Pub/Sub thông báo real-time
 *  3. ViewCounter           – Đếm lượt xem nhà hàng (HyperLogLog)
 */

require("dotenv").config();
const redis = require("redis");
const chalk = require("chalk");

const client    = redis.createClient({ url: process.env.REDIS_URL || "redis://localhost:6379" });
const subscriber = redis.createClient({ url: process.env.REDIS_URL || "redis://localhost:6379" });

// ─── 1. Restaurant Leaderboard (Sorted Set) ───────────────────────────────────
const Leaderboard = {
  BOARD_KEY: "leaderboard:restaurants",

  async updateScore(restaurantId, restaurantName, score) {
    // Lưu điểm vào sorted set
    await client.zAdd(this.BOARD_KEY, [{ score, value: restaurantId }]);
    // Lưu tên nhà hàng vào hash map
    await client.hSet(`restaurant:names`, restaurantId, restaurantName);
  },

  async getTop(n = 10) {
    // Lấy top N theo score giảm dần
    const entries = await client.zRangeWithScores(this.BOARD_KEY, 0, n - 1, { REV: true });
    const names   = await client.hGetAll("restaurant:names");
    return entries.map((e, i) => ({
      rank:  i + 1,
      id:    e.value,
      name:  names[e.value] || e.value,
      score: parseFloat(e.score.toFixed(2)),
    }));
  },

  async getRank(restaurantId) {
    const rank  = await client.zRevRank(this.BOARD_KEY, restaurantId);
    const score = await client.zScore(this.BOARD_KEY, restaurantId);
    return { rank: rank !== null ? rank + 1 : null, score };
  },

  async incrementScore(restaurantId, delta) {
    return client.zIncrBy(this.BOARD_KEY, delta, restaurantId);
  },
};

// ─── 2. HyperLogLog – Đếm unique viewers ─────────────────────────────────────
const ViewCounter = {
  key: (restaurantId) => `views:unique:${restaurantId}`,

  async addView(restaurantId, userId) {
    await client.pfAdd(this.key(restaurantId), userId);
  },

  async getUniqueCount(restaurantId) {
    return client.pfCount(this.key(restaurantId));
  },
};

// ─── 3. Pub/Sub – Thông báo đơn hàng real-time ───────────────────────────────
async function demoRealtimePubSub() {
  const CHANNEL = "order:updates";
  const messages = [];

  await subscriber.connect();

  // Subscriber lắng nghe channel
  await subscriber.subscribe(CHANNEL, (msg) => {
    const data = JSON.parse(msg);
    messages.push(data);
    const icon = { placed:"📥", confirmed:"✅", preparing:"👨‍🍳", picked_up:"🛵", delivered:"🎉", cancelled:"❌" }[data.status] || "📌";
    console.log(chalk.cyan(`  [REALTIME] ${icon} ${data.order_code} → ${data.status} | ${data.restaurant_name}`));
  });

  // Publisher gửi events mô phỏng luồng đơn hàng
  const orderCode  = "ORD_0001234";
  const restaurantName = "Phở Hà Nội Ngon";
  const statuses   = ["placed","confirmed","preparing","picked_up","delivered"];

  for (const status of statuses) {
    await client.publish(CHANNEL, JSON.stringify({
      order_code:      orderCode,
      restaurant_name: restaurantName,
      status,
      timestamp:       new Date().toISOString(),
    }));
    await new Promise(r => setTimeout(r, 200));
  }

  await new Promise(r => setTimeout(r, 300));
  await subscriber.unsubscribe(CHANNEL);
  await subscriber.quit();

  return messages.length;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  await client.connect();
  console.log("✅ Kết nối Redis thành công");

  console.log(chalk.blue.bold("\n═════════════════════════════════════════════"));
  console.log(chalk.blue.bold("  DEMO 5 – LEADERBOARD & PUB/SUB (Redis)"));
  console.log(chalk.blue.bold("═════════════════════════════════════════════"));

  // ── Leaderboard ────────────────────────────────────────────────────────────
  console.log(chalk.yellow("\n🏆 [1] Restaurant Leaderboard (Sorted Set):"));

  const restaurants = [
    { id: "rest_001", name: "Phở Hà Nội Ngon",  score: 4.8 },
    { id: "rest_002", name: "Cơm Tấm Sài Gòn",  score: 4.5 },
    { id: "rest_003", name: "Bánh Mì 37",        score: 4.3 },
    { id: "rest_004", name: "Trà Sữa Gong Cha",  score: 4.7 },
    { id: "rest_005", name: "Gà Rán KFC Clone",  score: 4.1 },
    { id: "rest_006", name: "Pizza 4P's Local",  score: 4.6 },
  ];

  let t = Date.now();
  for (const r of restaurants) {
    await Leaderboard.updateScore(r.id, r.name, r.score);
  }
  console.log(chalk.green(`  ⏱ Cập nhật ${restaurants.length} điểm: ${Date.now() - t}ms`));

  t = Date.now();
  const top = await Leaderboard.getTop(5);
  console.log(chalk.green(`  ⏱ Lấy top 5: ${Date.now() - t}ms`));
  top.forEach(r =>
    console.log(`  ${r.rank}. ${"⭐".repeat(Math.round(r.score))} ${r.name.padEnd(25)} Score: ${r.score}`)
  );

  // Tăng điểm sau khi có đơn mới
  await Leaderboard.incrementScore("rest_003", 0.2);
  const newRank = await Leaderboard.getRank("rest_003");
  console.log(`  rest_003 sau khi tăng 0.2 điểm: hạng ${newRank.rank} | ${newRank.score}`);

  // ── HyperLogLog ───────────────────────────────────────────────────────────
  console.log(chalk.yellow("\n👁  [2] Unique Viewers (HyperLogLog):"));
  const restId = "rest_001";
  const users  = ["u1","u2","u3","u1","u4","u2","u5","u1"]; // u1, u2 trùng

  t = Date.now();
  for (const u of users) await ViewCounter.addView(restId, u);
  const uniqueCount = await ViewCounter.getUniqueCount(restId);
  console.log(chalk.green(`  ⏱ ${Date.now() - t}ms`));
  console.log(`  Tổng request: ${users.length} | Unique viewers: ${uniqueCount} (chính xác)`);

  // ── Pub/Sub ───────────────────────────────────────────────────────────────
  console.log(chalk.yellow("\n📡 [3] Real-time Order Updates (Pub/Sub):"));
  console.log(chalk.gray("  Mô phỏng luồng cập nhật trạng thái đơn ORD_0001234:"));
  const msgCount = await demoRealtimePubSub();
  console.log(`  Tổng messages nhận được: ${msgCount}`);

  await client.quit();
}

main().catch(console.error);
