/**
 * BENCHMARK – So sánh MongoDB vs Cassandra vs Redis
 * ===================================================
 * Các kịch bản:
 *  1. Write throughput: Insert hàng loạt
 *  2. Read latency: Query đơn hàng theo user
 *  3. Aggregation: Thống kê top món bán chạy
 *  4. Schema flexibility: Thêm thuộc tính mới
 *  5. Concurrent reads: Nhiều request đồng thời
 */

require("dotenv").config();
const { MongoClient, ObjectId } = require("mongodb");
const cassandra = require("cassandra-driver");
const redis     = require("redis");
const chalk     = require("chalk");

const mongoClient = new MongoClient(process.env.MONGO_URI || "mongodb://localhost:27017");
const cassClient  = new cassandra.Client({
  contactPoints: [process.env.CASSANDRA_CONTACT_POINTS || "localhost"],
  localDataCenter: process.env.CASSANDRA_DATACENTER    || "datacenter1",
  keyspace: process.env.CASSANDRA_KEYSPACE             || "food_delivery",
});
const redisClient = redis.createClient({ url: process.env.REDIS_URL || "redis://localhost:6379" });

const BENCH_COUNT   = 1000;   // Số records cho write test
const REPEAT        = 5;      // Lặp mỗi test bao nhiêu lần để lấy trung bình

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function avg(fn, repeat = REPEAT) {
  const times = [];
  for (let i = 0; i < repeat; i++) {
    const t = Date.now();
    await fn();
    times.push(Date.now() - t);
  }
  return {
    avg: parseFloat((times.reduce((a, b) => a + b, 0) / repeat).toFixed(1)),
    min: Math.min(...times),
    max: Math.max(...times),
  };
}

function printResult(label, result, unit = "ms") {
  const bar = "▓".repeat(Math.min(30, Math.round(result.avg / 10)));
  console.log(`  ${label.padEnd(35)} avg:${String(result.avg).padStart(7)}${unit}  min:${result.min}${unit}  max:${result.max}${unit}  ${bar}`);
}

// ─── 1. Write Throughput ──────────────────────────────────────────────────────
async function benchmarkWrite(db) {
  console.log(chalk.yellow(`\n📝 [1] Write Throughput – Insert ${BENCH_COUNT} records`));

  const docs = Array.from({ length: BENCH_COUNT }, (_, i) => ({
    _id:         new ObjectId(),
    order_code:  `BENCH_${i}`,
    customer_id: new ObjectId(),
    total:       50000 + i * 100,
    status:      "placed",
    created_at:  new Date(),
    items:       [{ item_id: "item_1", name: "Phở Bò", price: 65000, qty: 1, subtotal: 65000 }],
    payload_extra: { tag: `bench_${i}`, note: "benchmark record" },
  }));

  // MongoDB insertMany
  const mongoColl = db.collection("benchmark_orders");
  await mongoColl.drop().catch(() => {});

  const mongoResult = await avg(async () => {
    await mongoColl.drop().catch(() => {});
    await mongoColl.insertMany(docs.slice(0, BENCH_COUNT));
  }, 3);
  printResult(`MongoDB insertMany(${BENCH_COUNT})`, mongoResult);

  // Redis SET (serialized)
  const redisResult = await avg(async () => {
    const pipeline = redisClient.multi();
    docs.slice(0, 100).forEach(d => pipeline.setEx(`bench:${d._id}`, 300, JSON.stringify(d)));
    await pipeline.exec();
  }, REPEAT);
  printResult(`Redis pipeline SET(100)`, redisResult);

  // Cassandra batch insert
  const cassInsert = `INSERT INTO order_status_log (order_id, event_time, status, note, actor, actor_id) VALUES (?,?,?,?,?,?)`;
  const cassResult = await avg(async () => {
    const batch = docs.slice(0, 100).map(d => ({
      query: cassInsert,
      params: [d._id.toString(), new Date(), "placed", "bench", "customer", "user_1"],
    }));
    await cassClient.batch(batch, { prepare: true });
  }, REPEAT);
  printResult(`Cassandra batch(100)`, cassResult);

  // Cleanup
  await mongoColl.drop().catch(() => {});
}

// ─── 2. Read Latency ──────────────────────────────────────────────────────────
async function benchmarkRead(db) {
  console.log(chalk.yellow("\n📖 [2] Read Latency – Query đơn hàng theo user"));

  const sampleOrder    = await db.collection("orders").findOne({ status: "delivered" });
  const sampleCustomer = await db.collection("customers").findOne({ status: "active" });

  if (!sampleOrder || !sampleCustomer) {
    console.log("  (Không có data – chạy seed:mongo trước)");
    return;
  }

  // MongoDB: findOne by ID (indexed)
  const mongoById = await avg(() =>
    db.collection("orders").findOne({ _id: sampleOrder._id })
  );
  printResult("MongoDB findOne by _id (indexed)", mongoById);

  // MongoDB: find by customer (indexed)
  const mongoByCust = await avg(() =>
    db.collection("orders").find({ customer_id: sampleCustomer._id }).limit(10).toArray()
  );
  printResult("MongoDB find by customer_id", mongoByCust);

  // Redis: GET by key (cache hit simulation)
  await redisClient.set("bench:order:1", JSON.stringify(sampleOrder));
  const redisGet = await avg(() => redisClient.get("bench:order:1"));
  printResult("Redis GET (in-memory cache)", redisGet);

  // Cassandra: query by order_id
  const cassQuery = await avg(() =>
    cassClient.execute(
      "SELECT * FROM order_status_log WHERE order_id = ? LIMIT 10",
      [sampleOrder._id.toString()],
      { prepare: true }
    )
  );
  printResult("Cassandra query by order_id", cassQuery);
}

// ─── 3. Aggregation ───────────────────────────────────────────────────────────
async function benchmarkAggregation(db) {
  console.log(chalk.yellow("\n🔢 [3] Aggregation – Top 10 món bán chạy"));

  const now  = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const to   = new Date(now.getFullYear(), now.getMonth(), 1);

  const pipeline = [
    { $match: { status: "delivered", created_at: { $gte: from, $lt: to } } },
    { $unwind: "$items" },
    { $group: { _id: "$items.item_id", name: { $first: "$items.name" }, total_sold: { $sum: "$items.qty" } } },
    { $sort: { total_sold: -1 } },
    { $limit: 10 },
  ];

  // MongoDB Aggregation
  const mongoAgg = await avg(() =>
    db.collection("orders").aggregate(pipeline).toArray()
  );
  printResult("MongoDB aggregate (top items)", mongoAgg);

  // MongoDB với explain (kiểm tra index usage)
  const explain = await db.collection("orders").aggregate(pipeline).explain("executionStats");
  console.log(chalk.gray(`  → Stages: ${explain.stages?.length || "N/A"} | executionTimeMillis hint thực tế`));

  // So sánh không có index
  const noIdxPipeline = [
    { $match: { status: "delivered" } },
    { $unwind: "$items" },
    { $group: { _id: "$items.category", total: { $sum: "$items.qty" } } },
    { $sort: { total: -1 } },
  ];
  const mongoNoIdx = await avg(() =>
    db.collection("orders").aggregate(noIdxPipeline).toArray()
  );
  printResult("MongoDB aggregate (by category, no date filter)", mongoNoIdx);
}

// ─── 4. Schema Flexibility ────────────────────────────────────────────────────
async function benchmarkSchemaFlexibility(db) {
  console.log(chalk.yellow("\n🏗  [4] Schema Flexibility – Thêm thuộc tính mới"));

  // MongoDB: thêm field mới cho toàn bộ collection
  const mongoColl = db.collection("orders");
  const count     = await mongoColl.countDocuments();

  console.log(`  MongoDB updateMany: thêm field "loyalty_points" vào ${count} documents`);
  let t = Date.now();
  const updateResult = await mongoColl.updateMany(
    { loyalty_points: { $exists: false } },
    { $set: { loyalty_points: 0 } }
  );
  console.log(chalk.green(`  ⏱ ${Date.now() - t}ms | Modified: ${updateResult.modifiedCount}`));
  console.log("  → MongoDB: schema-less, thêm field không cần migrate");

  // Cassandra: ALTER TABLE (thêm cột mới)
  console.log("  Cassandra: ALTER TABLE thêm cột 'extra_note TEXT'");
  t = Date.now();
  await cassClient.execute("ALTER TABLE order_status_log ADD extra_note TEXT").catch(() => {
    console.log("  (Column đã tồn tại hoặc không hỗ trợ)");
  });
  console.log(chalk.green(`  ⏱ ${Date.now() - t}ms`));
  console.log("  → Cassandra: cần ALTER TABLE nhưng không lock table");

  console.log("  PostgreSQL (mô phỏng): ALTER TABLE hàng triệu records = lock → downtime");
  console.log(chalk.gray("  → SQL: ALTER TABLE có thể mất vài phút đến vài giờ trên dữ liệu lớn"));

  // Cleanup
  await mongoColl.updateMany({}, { $unset: { loyalty_points: "" } });
}

// ─── 5. Concurrent Reads ──────────────────────────────────────────────────────
async function benchmarkConcurrentReads(db) {
  console.log(chalk.yellow("\n⚡ [5] Concurrent Reads – 50 requests đồng thời"));

  const customers = await db.collection("customers").find({ status: "active" }).limit(50).toArray();
  if (customers.length < 5) {
    console.log("  (Không đủ data)");
    return;
  }

  // Tạo cache trong Redis
  for (const c of customers.slice(0, 10)) {
    const orders = await db.collection("orders")
      .find({ customer_id: c._id }).limit(5).toArray();
    await redisClient.setEx(`orders:${c._id}`, 300, JSON.stringify(orders));
  }

  // Concurrent MongoDB reads
  const t1 = Date.now();
  await Promise.all(
    customers.slice(0, 50).map(c =>
      db.collection("orders")
        .find({ customer_id: c._id })
        .sort({ created_at: -1 })
        .limit(5)
        .toArray()
    )
  );
  const mongoConc = Date.now() - t1;

  // Concurrent Redis reads (cache layer)
  const t2 = Date.now();
  await Promise.all(
    customers.slice(0, 10).map(c =>
      redisClient.get(`orders:${c._id}`)
    )
  );
  const redisConc = Date.now() - t2;

  console.log(`  MongoDB 50 concurrent queries: ${mongoConc}ms (${(mongoConc/50).toFixed(1)}ms/req)`);
  console.log(`  Redis   10 concurrent GET    : ${redisConc}ms (${(redisConc/10).toFixed(1)}ms/req)`);
  console.log(chalk.gray("  → Redis ~10-100x nhanh hơn cho read đơn giản, MongoDB cho query phức tạp"));
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  await mongoClient.connect();
  await cassClient.connect();
  await redisClient.connect();

  const db = mongoClient.db(process.env.MONGO_DB || "food_delivery");

  console.log(chalk.blue.bold("\n╔════════════════════════════════════════════════════╗"));
  console.log(chalk.blue.bold("║       BENCHMARK: MongoDB vs Cassandra vs Redis     ║"));
  console.log(chalk.blue.bold("╚════════════════════════════════════════════════════╝"));
  console.log(chalk.gray(`  Mỗi test lặp ${REPEAT} lần, lấy trung bình\n`));

  try {
    await benchmarkWrite(db);
    await benchmarkRead(db);
    await benchmarkAggregation(db);
    await benchmarkSchemaFlexibility(db);
    await benchmarkConcurrentReads(db);

    console.log(chalk.green.bold("\n✅ BENCHMARK HOÀN TẤT"));
    console.log(chalk.gray("─────────────────────────────────────────────────────"));
    console.log(chalk.white.bold("📋 KẾT LUẬN:"));
    console.log("  • Redis     → Tốt nhất cho cache, session, counter (<1ms)");
    console.log("  • MongoDB   → Tốt nhất cho CRUD phức tạp, aggregation, flexible schema");
    console.log("  • Cassandra → Tốt nhất cho write-heavy time-series, append-only log");
    console.log("  → Kết hợp cả 3 (Polyglot) là tối ưu cho hệ thống food delivery thực tế");

  } finally {
    await mongoClient.close();
    await cassClient.shutdown();
    await redisClient.quit();
  }
}

main().catch(console.error);
