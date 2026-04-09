/**
 * DEMO 8 – Order Log & User Behavior (Cassandra)
 * ================================================
 * Các chức năng:
 *  1. queryOrderStatusLog       – Lịch sử trạng thái 1 đơn hàng
 *  2. queryUserBehaviorLog      – Hành vi người dùng theo thời gian
 *  3. queryRestaurantRevenue    – Doanh thu nhà hàng theo ngày
 *  4. getTopBehaviorByEventType – Thống kê hành vi theo loại event
 */

require("dotenv").config();
const cassandra = require("cassandra-driver");
const chalk     = require("chalk");
const { MongoClient } = require("mongodb");

const cassClient = new cassandra.Client({
  contactPoints: [process.env.CASSANDRA_CONTACT_POINTS || "localhost"],
  localDataCenter: process.env.CASSANDRA_DATACENTER || "datacenter1",
  keyspace: process.env.CASSANDRA_KEYSPACE || "food_delivery",
});

const mongoClient = new MongoClient(process.env.MONGO_URI || "mongodb://localhost:27017");

// ─── 1. Lịch sử trạng thái 1 đơn hàng ───────────────────────────────────────
async function getOrderStatusTimeline(orderId) {
  const result = await cassClient.execute(
    `SELECT order_id, event_time, status, actor, actor_id, note
     FROM order_status_log
     WHERE order_id = ?
     ORDER BY event_time ASC`,
    [orderId],
    { prepare: true }
  );
  return result.rows;
}

// ─── 2. Hành vi user trong khoảng thời gian ──────────────────────────────────
async function getUserBehavior(customerId, fromDate, toDate) {
  const result = await cassClient.execute(
    `SELECT customer_id, event_time, event_type, item_name, restaurant_id, platform
     FROM user_behavior_log
     WHERE customer_id = ?
       AND event_time >= ?
       AND event_time <= ?
     ORDER BY event_time DESC`,
    [customerId, fromDate, toDate],
    { prepare: true }
  );
  return result.rows;
}

// ─── 3. Doanh thu nhà hàng theo khoảng ngày ──────────────────────────────────
async function getRestaurantRevenue(restaurantId, fromDate, toDate) {
  const result = await cassClient.execute(
    `SELECT restaurant_id, date, total_orders, total_revenue, avg_order_value
     FROM restaurant_revenue_daily
     WHERE restaurant_id = ?
       AND date >= ?
       AND date <= ?
     ORDER BY date DESC`,
    [restaurantId, fromDate, toDate],
    { prepare: true }
  );
  return result.rows;
}

// ─── 4. Thống kê hành vi user theo loại event ────────────────────────────────
async function aggregateUserBehavior(customerId) {
  const result = await cassClient.execute(
    `SELECT event_type, item_name, restaurant_id
     FROM user_behavior_log
     WHERE customer_id = ?
     LIMIT 1000`,
    [customerId],
    { prepare: true }
  );

  // Tổng hợp phía client (Cassandra không hỗ trợ GROUP BY trên clustering column)
  const stats = {};
  for (const row of result.rows) {
    const type = row.event_type;
    stats[type] = (stats[type] || 0) + 1;
  }

  const topItems = {};
  for (const row of result.rows) {
    if (row.event_type === "view_item" || row.event_type === "add_to_cart") {
      topItems[row.item_name] = (topItems[row.item_name] || 0) + 1;
    }
  }

  return {
    byEventType: Object.entries(stats).sort((a, b) => b[1] - a[1]),
    topViewedItems: Object.entries(topItems).sort((a, b) => b[1] - a[1]).slice(0, 5),
    total: result.rows.length,
  };
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  try {
    await cassClient.connect();
    console.log("✅ Kết nối Cassandra thành công");

    await mongoClient.connect();
    const db = mongoClient.db(process.env.MONGO_DB || "food_delivery");

    console.log(chalk.blue.bold("\n══════════════════════════════════════════════════"));
    console.log(chalk.blue.bold("  DEMO 8 – ORDER LOG & BEHAVIOR (Cassandra)"));
    console.log(chalk.blue.bold("══════════════════════════════════════════════════"));

    // Lấy 1 order_id để demo
    const sampleOrder = await db.collection("orders").findOne({ status: "delivered" });

    if (sampleOrder) {
      // 1. Status timeline của đơn hàng
      console.log(chalk.yellow(`\n📋 [1] Timeline đơn hàng: ${sampleOrder.order_code}`));
      let t = Date.now();
      const timeline = await getOrderStatusTimeline(sampleOrder._id.toString());
      console.log(chalk.green(`  ⏱ Query time: ${Date.now() - t}ms`));

      if (timeline.length > 0) {
        timeline.forEach(row => {
          const time = new Date(row.event_time).toLocaleTimeString("vi");
          const icon = { placed:"📥", confirmed:"✅", preparing:"👨‍🍳", picked_up:"🛵", delivered:"🎉", cancelled:"❌" }[row.status] || "📌";
          console.log(`  ${icon} [${time}] ${row.status.padEnd(12)} | ${row.actor.padEnd(10)} | ${row.note}`);
        });
      } else {
        console.log("  (Không có data - chạy seed:cassandra trước)");
      }
    }

    // 2. Hành vi user
    const sampleCustomer = await db.collection("customers").findOne({ status: "active" });
    if (sampleCustomer) {
      const from = new Date(Date.now() - 7 * 86400000);  // 7 ngày qua
      const to   = new Date();

      console.log(chalk.yellow(`\n🖱  [2] Hành vi user "${sampleCustomer.name}" (7 ngày qua):`));
      let t = Date.now();
      const behaviors = await getUserBehavior(sampleCustomer._id.toString(), from, to);
      console.log(chalk.green(`  ⏱ Query time: ${Date.now() - t}ms | ${behaviors.length} events`));
      behaviors.slice(0, 6).forEach(row =>
        console.log(`  [${new Date(row.event_time).toLocaleDateString("vi")}] ${row.event_type.padEnd(20)} ${(row.item_name || "").padEnd(25)} [${row.platform}]`)
      );

      // 3. Tổng hợp hành vi
      console.log(chalk.yellow(`\n📊 [3] Thống kê hành vi user tổng hợp:`));
      t = Date.now();
      const aggr = await aggregateUserBehavior(sampleCustomer._id.toString());
      console.log(chalk.green(`  ⏱ ${Date.now() - t}ms | Tổng: ${aggr.total} events`));
      console.log("  Theo loại event:");
      aggr.byEventType.forEach(([type, count]) =>
        console.log(`    ${type.padEnd(22)} ${count} lần`)
      );
      if (aggr.topViewedItems.length > 0) {
        console.log("  Top món được xem/thêm vào giỏ:");
        aggr.topViewedItems.forEach(([name, count]) =>
          console.log(`    ${name.padEnd(25)} ${count} lần`)
        );
      }
    }

    // 4. Doanh thu nhà hàng
    const sampleRestaurant = await db.collection("restaurants").findOne();
    if (sampleRestaurant) {
      const fromDate = cassandra.types.LocalDate.fromDate(new Date(Date.now() - 30 * 86400000));
      const toDate   = cassandra.types.LocalDate.fromDate(new Date());

      console.log(chalk.yellow(`\n💰 [4] Doanh thu "${sampleRestaurant.name}" (30 ngày qua):`));
      let t = Date.now();
      const revenue = await getRestaurantRevenue(sampleRestaurant._id.toString(), fromDate, toDate);
      console.log(chalk.green(`  ⏱ Query time: ${Date.now() - t}ms`));

      if (revenue.length > 0) {
        let totalOrders = 0, totalRevenue = 0;
        revenue.slice(0, 7).forEach(row => {
          console.log(`  ${String(row.date).padEnd(12)} ${String(row.total_orders).padStart(4)} đơn | ${row.total_revenue.toLocaleString("vi").padStart(12)}đ | TB: ${Math.round(row.avg_order_value).toLocaleString("vi")}đ`);
          totalOrders  += row.total_orders;
          totalRevenue += parseInt(row.total_revenue);
        });
        if (revenue.length > 7) console.log(`  ... và ${revenue.length - 7} ngày khác`);
        console.log(`  ─────────────────────────────────────────────────`);
        console.log(`  Tổng 30 ngày: ${totalOrders} đơn | ${totalRevenue.toLocaleString("vi")}đ`);
      } else {
        console.log("  (Không có data - chạy seed:cassandra trước)");
      }
    }

    // 5. So sánh tốc độ đọc Cassandra vs MongoDB (cùng query timeline)
    if (sampleOrder) {
      console.log(chalk.yellow("\n⚡ [5] So sánh tốc độ: Cassandra vs MongoDB (order timeline):"));

      // Cassandra
      let t = Date.now();
      for (let i = 0; i < 10; i++) {
        await getOrderStatusTimeline(sampleOrder._id.toString());
      }
      const cassTime = (Date.now() - t) / 10;

      // MongoDB
      t = Date.now();
      for (let i = 0; i < 10; i++) {
        await db.collection("orders").findOne(
          { _id: sampleOrder._id },
          { projection: { status_history: 1 } }
        );
      }
      const mongoTime = (Date.now() - t) / 10;

      console.log(`  Cassandra (avg 10 queries): ${cassTime.toFixed(1)}ms`);
      console.log(`  MongoDB   (avg 10 queries): ${mongoTime.toFixed(1)}ms`);
      console.log(chalk.gray("  (Cassandra tối ưu cho append-only time-series, MongoDB linh hoạt hơn)"));
    }

  } finally {
    await cassClient.shutdown();
    await mongoClient.close();
  }
}

main().catch(console.error);
