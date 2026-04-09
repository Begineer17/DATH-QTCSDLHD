/**
 * DEMO 2 – Thống kê món bán chạy (MongoDB Aggregation)
 * ======================================================
 * Các chức năng:
 *  1. getTopItemsByMonth         – Top N món bán chạy trong tháng
 *  2. getTopItemsByRestaurant    – Top món của 1 nhà hàng
 *  3. getMonthlyRevenue          – Doanh thu theo tháng của nhà hàng
 *  4. getCategoryStats           – Thống kê theo danh mục
 *  5. getPeakOrderHours          – Giờ cao điểm đặt đơn
 */

require("dotenv").config();
const { connect, close } = require("./connection");
const chalk = require("chalk");

// ─── 1. Top N món bán chạy trong tháng ───────────────────────────────────────
async function getTopItemsByMonth(year, month, limit = 10) {
  const db = await connect();
  const from = new Date(`${year}-${String(month).padStart(2,"0")}-01`);
  const to   = month < 12
    ? new Date(`${year}-${String(month + 1).padStart(2,"0")}-01`)
    : new Date(`${year + 1}-01-01`);

  return db.collection("orders").aggregate([
    { $match: { status: "delivered", created_at: { $gte: from, $lt: to } } },
    { $unwind: "$items" },
    {
      $group: {
        _id:         "$items.item_id",
        name:        { $first: "$items.name" },
        category:    { $first: "$items.category" },
        total_sold:  { $sum: "$items.qty" },
        revenue:     { $sum: { $multiply: ["$items.price", "$items.qty"] } },
        order_count: { $sum: 1 },
        avg_price:   { $avg: "$items.price" },
      },
    },
    { $sort: { total_sold: -1 } },
    { $limit: limit },
    {
      $project: {
        _id: 0, name: 1, category: 1, total_sold: 1, revenue: 1,
        order_count: 1, avg_price: { $round: ["$avg_price", 0] },
      },
    },
  ]).toArray();
}

// ─── 2. Top món của 1 nhà hàng (toàn thời gian) ──────────────────────────────
async function getTopItemsByRestaurant(restaurantId, limit = 5) {
  const db = await connect();
  return db.collection("orders").aggregate([
    { $match: { restaurant_id: restaurantId, status: "delivered" } },
    { $unwind: "$items" },
    {
      $group: {
        _id:        "$items.item_id",
        name:       { $first: "$items.name" },
        total_sold: { $sum: "$items.qty" },
        revenue:    { $sum: { $multiply: ["$items.price","$items.qty"] } },
      },
    },
    { $sort: { total_sold: -1 } },
    { $limit: limit },
  ]).toArray();
}

// ─── 3. Doanh thu theo tháng của nhà hàng ────────────────────────────────────
async function getMonthlyRevenue(restaurantId, numMonths = 6) {
  const db = await connect();
  const since = new Date(Date.now() - numMonths * 30 * 86400000);

  return db.collection("orders").aggregate([
    {
      $match: {
        restaurant_id: restaurantId,
        status:        "delivered",
        created_at:    { $gte: since },
      },
    },
    {
      $group: {
        _id: {
          year:  { $year: "$created_at" },
          month: { $month: "$created_at" },
        },
        total_orders:  { $sum: 1 },
        total_revenue: { $sum: "$total" },
        avg_order:     { $avg: "$total" },
      },
    },
    { $sort: { "_id.year": 1, "_id.month": 1 } },
    {
      $project: {
        _id:           0,
        month:         { $concat: [{ $toString: "$_id.year" }, "-", { $toString: "$_id.month" }] },
        total_orders:  1,
        total_revenue: 1,
        avg_order:     { $round: ["$avg_order", 0] },
      },
    },
  ]).toArray();
}

// ─── 4. Thống kê theo danh mục món ───────────────────────────────────────────
async function getCategoryStats(year, month) {
  const db = await connect();
  const from = new Date(`${year}-${String(month).padStart(2,"0")}-01`);
  const to   = month < 12
    ? new Date(`${year}-${String(month + 1).padStart(2,"0")}-01`)
    : new Date(`${year + 1}-01-01`);

  return db.collection("orders").aggregate([
    { $match: { status: "delivered", created_at: { $gte: from, $lt: to } } },
    { $unwind: "$items" },
    {
      $group: {
        _id:        "$items.category",
        total_sold: { $sum: "$items.qty" },
        revenue:    { $sum: { $multiply: ["$items.price","$items.qty"] } },
      },
    },
    { $sort: { revenue: -1 } },
  ]).toArray();
}

// ─── 5. Giờ cao điểm đặt đơn ─────────────────────────────────────────────────
async function getPeakOrderHours() {
  const db = await connect();
  return db.collection("orders").aggregate([
    { $match: { status: { $ne: "cancelled" } } },
    {
      $group: {
        _id:   { $hour: "$created_at" },
        count: { $sum: 1 },
        revenue: { $sum: "$total" },
      },
    },
    { $sort: { "_id": 1 } },
    { $project: { _id: 0, hour: "$_id", count: 1, revenue: 1 } },
  ]).toArray();
}

// ─── MAIN: Chạy demo ──────────────────────────────────────────────────────────
async function main() {
  try {
    const db = await connect();

    // Lấy ngày hiện tại để xác định tháng demo
    const now   = new Date();
    const year  = now.getFullYear();
    const month = now.getMonth() + 1;

    console.log(chalk.blue.bold("\n══════════════════════════════════════════════"));
    console.log(chalk.blue.bold("  DEMO 2 – THỐNG KÊ MÓN BÁN CHẠY (MongoDB)"));
    console.log(chalk.blue.bold("══════════════════════════════════════════════"));

    // 1. Top 10 món bán chạy tháng này (hoặc tháng có nhiều data nhất)
    console.log(chalk.yellow(`\n🏆 [1] Top 10 món bán chạy tháng ${month}/${year}:`));
    let t = Date.now();
    let items = await getTopItemsByMonth(year, month);

    // Nếu tháng hiện tại không có data, lùi về tháng trước
    if (items.length === 0) {
      const prevMonth = month === 1 ? 12 : month - 1;
      const prevYear  = month === 1 ? year - 1 : year;
      console.log(chalk.gray(`  (Không có data tháng ${month}, dùng tháng ${prevMonth}/${prevYear})`));
      items = await getTopItemsByMonth(prevYear, prevMonth);
    }

    console.log(chalk.green(`  ⏱ Query time: ${Date.now() - t}ms`));
    console.log(`  ${"Tên món".padEnd(28)} ${"Danh mục".padEnd(12)} ${"Bán".padStart(6)} ${"Doanh thu".padStart(14)}`);
    console.log(`  ${"-".repeat(68)}`);
    items.forEach((item, i) => {
      console.log(`  ${String(i+1).padStart(2)}. ${item.name.padEnd(26)} ${item.category.padEnd(12)} ${String(item.total_sold).padStart(6)} ${item.revenue.toLocaleString("vi").padStart(12)}đ`);
    });

    // 2. Thống kê theo danh mục
    console.log(chalk.yellow(`\n📊 [2] Doanh thu theo danh mục:`));
    t = Date.now();
    const m = items.length > 0 ? month : (month === 1 ? 12 : month - 1);
    const y = items.length > 0 ? year  : (month === 1 ? year - 1 : year);
    const cats = await getCategoryStats(y, m);
    console.log(chalk.green(`  ⏱ Query time: ${Date.now() - t}ms`));
    cats.slice(0, 6).forEach(c =>
      console.log(`  ${c._id.padEnd(15)} Bán: ${String(c.total_sold).padStart(5)}  DT: ${c.revenue.toLocaleString("vi").padStart(12)}đ`)
    );

    // 3. Top món của nhà hàng đầu tiên
    const restaurant = await db.collection("restaurants").findOne();
    if (restaurant) {
      console.log(chalk.yellow(`\n🍜 [3] Top 5 món của "${restaurant.name}":`));
      t = Date.now();
      const restItems = await getTopItemsByRestaurant(restaurant._id);
      console.log(chalk.green(`  ⏱ Query time: ${Date.now() - t}ms`));
      restItems.forEach((item, i) =>
        console.log(`  ${i+1}. ${item.name.padEnd(25)} Bán: ${item.total_sold}  DT: ${item.revenue.toLocaleString("vi")}đ`)
      );

      // 4. Doanh thu 6 tháng gần nhất
      console.log(chalk.yellow(`\n📈 [4] Doanh thu 6 tháng gần nhất (${restaurant.name}):`));
      t = Date.now();
      const monthly = await getMonthlyRevenue(restaurant._id, 6);
      console.log(chalk.green(`  ⏱ Query time: ${Date.now() - t}ms`));
      monthly.forEach(m =>
        console.log(`  Tháng ${m.month.padEnd(8)} | ${String(m.total_orders).padStart(4)} đơn | DT: ${m.total_revenue.toLocaleString("vi").padStart(12)}đ | TB: ${m.avg_order.toLocaleString("vi")}đ`)
      );
    }

    // 5. Giờ cao điểm
    console.log(chalk.yellow("\n⏰ [5] Giờ cao điểm đặt đơn (top 5):"));
    t = Date.now();
    const hours = await getPeakOrderHours();
    console.log(chalk.green(`  ⏱ Query time: ${Date.now() - t}ms`));
    const maxCount = Math.max(...hours.map(h => h.count));
    hours
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .forEach(h => {
        const bar = "█".repeat(Math.round(h.count / maxCount * 20));
        console.log(`  ${String(h.hour).padStart(2)}h  ${bar.padEnd(21)} ${h.count} đơn`);
      });

  } finally {
    await close();
  }
}

main().catch(console.error);
