/**
 * SEED CASSANDRA
 * Tạo keyspace, tables, và sinh dữ liệu order_status_log & user_behavior_log
 */

require("dotenv").config();
const cassandra = require("cassandra-driver");
const { MongoClient } = require("mongodb");

const cassClient = new cassandra.Client({
  contactPoints: [process.env.CASSANDRA_CONTACT_POINTS || "localhost"],
  localDataCenter: process.env.CASSANDRA_DATACENTER || "datacenter1",
  socketOptions: { connectTimeout: 30000 },
});

const mongoClient = new MongoClient(process.env.MONGO_URI || "mongodb://localhost:27017");
const KEYSPACE = process.env.CASSANDRA_KEYSPACE || "food_delivery";

const rand     = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt  = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

const SETUP_CQL = `
CREATE KEYSPACE IF NOT EXISTS ${KEYSPACE}
  WITH replication = {'class':'SimpleStrategy','replication_factor':1};

USE ${KEYSPACE};

-- Bảng 1: Order status log (time-series)
CREATE TABLE IF NOT EXISTS order_status_log (
  order_id    TEXT,
  event_time  TIMESTAMP,
  status      TEXT,
  note        TEXT,
  actor       TEXT,
  actor_id    TEXT,
  PRIMARY KEY (order_id, event_time)
) WITH CLUSTERING ORDER BY (event_time ASC);

-- Bảng 2: User behavior log (click, view, add_to_cart)
CREATE TABLE IF NOT EXISTS user_behavior_log (
  customer_id TEXT,
  event_time  TIMESTAMP,
  event_type  TEXT,
  item_id     TEXT,
  item_name   TEXT,
  restaurant_id TEXT,
  session_id  TEXT,
  platform    TEXT,
  PRIMARY KEY (customer_id, event_time)
) WITH CLUSTERING ORDER BY (event_time DESC);

-- Bảng 3: Restaurant revenue (time-series per day)
CREATE TABLE IF NOT EXISTS restaurant_revenue_daily (
  restaurant_id   TEXT,
  date            DATE,
  total_orders    INT,
  total_revenue   BIGINT,
  avg_order_value DOUBLE,
  PRIMARY KEY (restaurant_id, date)
) WITH CLUSTERING ORDER BY (date DESC);

-- Bảng 4: Item popularity (per restaurant per month)
CREATE TABLE IF NOT EXISTS item_popularity_monthly (
  restaurant_id TEXT,
  year_month    TEXT,
  item_id       TEXT,
  item_name     TEXT,
  sold_count    INT,
  PRIMARY KEY ((restaurant_id, year_month), item_id)
);
`;

async function setupSchema(client) {
  console.log("🏗  Tạo Keyspace và Tables...");
  const statements = SETUP_CQL.split(";").map(s => s.trim()).filter(s => s.length > 0);
  for (const stmt of statements) {
    await client.execute(stmt).catch(e => {
      if (!e.message.includes("already exists")) console.error("CQL error:", e.message);
    });
  }
  await client.execute(`USE ${KEYSPACE}`);
  console.log("  ✅ Schema OK");
}

async function seedOrderStatusLog(client, orders) {
  console.log(`📋 Inserting order_status_log từ ${orders.length} orders...`);
  const INSERT = `INSERT INTO order_status_log
    (order_id, event_time, status, note, actor, actor_id) VALUES (?,?,?,?,?,?)`;

  const actorMap = {
    placed:    ["customer",  (o) => o.customer_id.toString()],
    confirmed: ["restaurant",(o) => o.restaurant_id.toString()],
    preparing: ["restaurant",(o) => o.restaurant_id.toString()],
    picked_up: ["driver",    (o) => o.driver_id],
    delivered: ["driver",    (o) => o.driver_id],
    cancelled: ["system",    () => "SYSTEM"],
  };

  let count = 0;
  const batch = [];

  for (const order of orders) {
    for (const evt of order.status_history) {
      const [actor, getActorId] = actorMap[evt.status] || ["system", () => "SYSTEM"];
      batch.push({
        query: INSERT,
        params: [
          order._id.toString(),
          evt.timestamp,
          evt.status,
          `Đơn hàng ${evt.status}`,
          actor,
          getActorId(order),
        ],
      });

      if (batch.length >= 100) {
        await client.batch(batch, { prepare: true });
        batch.length = 0;
      }
    }
    count++;
    if (count % 500 === 0) process.stdout.write(`  → ${count}/${orders.length}\r`);
  }

  if (batch.length > 0) await client.batch(batch, { prepare: true });
  console.log(`\n  ✅ Đã insert ${count} orders vào order_status_log`);
}

async function seedUserBehaviorLog(client, customers, restaurants) {
  console.log("🖱  Sinh user_behavior_log (hành vi người dùng)...");
  const INSERT = `INSERT INTO user_behavior_log
    (customer_id, event_time, event_type, item_id, item_name, restaurant_id, session_id, platform)
    VALUES (?,?,?,?,?,?,?,?)`;

  const EVENT_TYPES = ["view_restaurant","view_item","add_to_cart","remove_from_cart","search"];
  const PLATFORMS   = ["ios","android","web"];

  const allItems = restaurants.flatMap(r =>
    r.menu.map(item => ({ ...item, restaurant_id: r._id.toString() }))
  );

  const batch = [];
  let total = 0;

  for (const customer of customers) {
    const numEvents = randInt(10, 50);
    const baseTime  = Date.now() - 30 * 86400000;

    for (let i = 0; i < numEvents; i++) {
      const item    = rand(allItems);
      const evtTime = new Date(baseTime + Math.random() * 30 * 86400000);

      batch.push({
        query: INSERT,
        params: [
          customer._id.toString(),
          evtTime,
          rand(EVENT_TYPES),
          item.item_id,
          item.name,
          item.restaurant_id,
          `sess_${Math.random().toString(36).substr(2,8)}`,
          rand(PLATFORMS),
        ],
      });

      if (batch.length >= 200) {
        await client.batch(batch, { prepare: true });
        total += batch.length;
        batch.length = 0;
      }
    }
  }

  if (batch.length > 0) {
    await client.batch(batch, { prepare: true });
    total += batch.length;
  }
  console.log(`  ✅ Đã insert ${total} behavior events`);
}

async function seedRestaurantRevenue(client, orders, restaurants) {
  console.log("💰 Tính revenue theo ngày...");

  // Aggregate in JS
  const revenueMap = {};
  for (const order of orders) {
    if (order.status !== "delivered") continue;
    const date = order.created_at.toISOString().split("T")[0];
    const key  = `${order.restaurant_id}_${date}`;
    if (!revenueMap[key]) {
      revenueMap[key] = { restaurant_id: order.restaurant_id.toString(), date, total_orders: 0, total_revenue: 0 };
    }
    revenueMap[key].total_orders++;
    revenueMap[key].total_revenue += order.total;
  }

  const INSERT = `INSERT INTO restaurant_revenue_daily
    (restaurant_id, date, total_orders, total_revenue, avg_order_value) VALUES (?,?,?,?,?)`;

  const entries = Object.values(revenueMap);
  const batch   = [];
  for (const e of entries) {
    batch.push({
      query: INSERT,
      params: [
        e.restaurant_id,
        e.date,
        e.total_orders,
        e.total_revenue,
        e.total_revenue / e.total_orders,
      ],
    });
    if (batch.length >= 100) {
      await client.batch(batch, { prepare: true });
      batch.length = 0;
    }
  }
  if (batch.length > 0) await client.batch(batch, { prepare: true });
  console.log(`  ✅ Đã insert ${entries.length} revenue records`);
}

async function main() {
  try {
    await cassClient.connect();
    console.log("✅ Kết nối Cassandra thành công");

    await mongoClient.connect();
    const db = mongoClient.db(process.env.MONGO_DB || "food_delivery");

    console.log("📡 Đọc dữ liệu từ MongoDB...");
    const customers   = await db.collection("customers").find().toArray();
    const restaurants = await db.collection("restaurants").find().toArray();
    const orders      = await db.collection("orders").find().toArray();

    await setupSchema(cassClient);
    await seedOrderStatusLog(cassClient, orders);
    await seedUserBehaviorLog(cassClient, customers, restaurants);
    await seedRestaurantRevenue(cassClient, orders, restaurants);

    console.log("\n🎉 SEED CASSANDRA HOÀN TẤT!");

  } finally {
    await cassClient.shutdown();
    await mongoClient.close();
  }
}

main().catch(console.error);
