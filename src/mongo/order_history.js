/**
 * DEMO 1 – Lịch sử đơn hàng (MongoDB)
 * =====================================
 * Các chức năng:
 *  1. getOrderHistory      – Lịch sử đơn hàng của 1 user (phân trang)
 *  2. getOrderDetail       – Chi tiết 1 đơn hàng
 *  3. getOrdersByStatus    – Lọc đơn hàng theo trạng thái
 *  4. getCustomerStats     – Thống kê tổng hợp của 1 user
 */

require("dotenv").config();
const { connect, close } = require("./connection");
const chalk = require("chalk");

// ─── 1. Lấy lịch sử đơn hàng (có phân trang) ─────────────────────────────────
async function getOrderHistory(customerId, { page = 1, limit = 5, status } = {}) {
  const db = await connect();
  const filter = { customer_id: customerId };
  if (status) filter.status = status;

  const [orders, total] = await Promise.all([
    db.collection("orders")
      .find(filter)
      .sort({ created_at: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .project({
        order_code: 1, restaurant_name: 1, items: 1,
        total: 1, status: 1, created_at: 1, payment: 1,
      })
      .toArray(),
    db.collection("orders").countDocuments(filter),
  ]);

  return {
    data: orders,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

// ─── 2. Chi tiết đơn hàng ─────────────────────────────────────────────────────
async function getOrderDetail(orderCode) {
  const db = await connect();
  return db.collection("orders").findOne({ order_code: orderCode });
}

// ─── 3. Thống kê của 1 customer ───────────────────────────────────────────────
async function getCustomerStats(customerId) {
  const db = await connect();
  const pipeline = [
    { $match: { customer_id: customerId } },
    {
      $group: {
        _id: "$status",
        count:        { $sum: 1 },
        total_spent:  { $sum: "$total" },
        avg_order:    { $avg: "$total" },
      },
    },
  ];

  const byStatus = await db.collection("orders").aggregate(pipeline).toArray();

  const overall = await db.collection("orders").aggregate([
    { $match: { customer_id: customerId, status: "delivered" } },
    {
      $group: {
        _id:         null,
        total_orders:{ $sum: 1 },
        total_spent: { $sum: "$total" },
        avg_order:   { $avg: "$total" },
        first_order: { $min: "$created_at" },
        last_order:  { $max: "$created_at" },
      },
    },
  ]).toArray();

  return { byStatus, overall: overall[0] };
}

// ─── 4. Tìm đơn hàng gần nhất theo địa chỉ nhà hàng ──────────────────────────
async function getRecentOrdersForRestaurant(restaurantId, days = 7) {
  const db  = await connect();
  const since = new Date(Date.now() - days * 86400000);
  return db.collection("orders")
    .find({ restaurant_id: restaurantId, created_at: { $gte: since } })
    .sort({ created_at: -1 })
    .limit(20)
    .toArray();
}

// ─── MAIN: Chạy demo ──────────────────────────────────────────────────────────
async function main() {
  try {
    const db = await connect();

    // Lấy 1 customer để demo
    const customer = await db.collection("customers").findOne({ status: "active" });
    if (!customer) { console.log("Không có customer!"); return; }

    console.log(chalk.blue.bold("\n════════════════════════════════════════"));
    console.log(chalk.blue.bold("  DEMO 1 – LỊCH SỬ ĐƠN HÀNG (MongoDB)"));
    console.log(chalk.blue.bold("════════════════════════════════════════"));
    console.log(chalk.gray(`Customer: ${customer.name} (${customer.email})\n`));

    // 1. Lịch sử đơn hàng trang 1
    console.log(chalk.yellow("📋 [1] Lịch sử đơn hàng (page 1, limit 5):"));
    const t1 = Date.now();
    const history = await getOrderHistory(customer._id, { page: 1, limit: 5 });
    console.log(chalk.green(`  ⏱ Query time: ${Date.now() - t1}ms`));
    console.log(`  Tổng đơn: ${history.pagination.total} | Trang ${history.pagination.page}/${history.pagination.totalPages}`);
    history.data.forEach(o => {
      console.log(`  - [${o.status.padEnd(10)}] ${o.order_code}  ${o.restaurant_name.padEnd(20)} ${o.total.toLocaleString("vi")}đ  ${o.created_at.toLocaleDateString("vi")}`);
    });

    // 2. Chỉ lấy đơn đã giao
    console.log(chalk.yellow("\n📋 [2] Chỉ đơn đã giao (delivered):"));
    const t2 = Date.now();
    const delivered = await getOrderHistory(customer._id, { limit: 3, status: "delivered" });
    console.log(chalk.green(`  ⏱ Query time: ${Date.now() - t2}ms`));
    console.log(`  Số đơn đã giao: ${delivered.pagination.total}`);

    // 3. Chi tiết 1 đơn
    if (history.data.length > 0) {
      console.log(chalk.yellow(`\n📋 [3] Chi tiết đơn: ${history.data[0].order_code}`));
      const t3 = Date.now();
      const detail = await getOrderDetail(history.data[0].order_code);
      console.log(chalk.green(`  ⏱ Query time: ${Date.now() - t3}ms`));
      if (detail) {
        console.log(`  Nhà hàng   : ${detail.restaurant_name}`);
        console.log(`  Trạng thái : ${detail.status}`);
        console.log(`  Món ăn     :`);
        detail.items.forEach(item =>
          console.log(`    • ${item.name.padEnd(25)} x${item.qty}  ${item.subtotal.toLocaleString("vi")}đ`)
        );
        console.log(`  Thanh toán : ${detail.payment.method.toUpperCase()} - ${detail.payment.status}`);
        console.log(`  Tổng cộng  : ${detail.total.toLocaleString("vi")}đ`);
        console.log(`  Lịch sử trạng thái:`);
        detail.status_history.forEach(s =>
          console.log(`    [${new Date(s.timestamp).toLocaleTimeString("vi")}] ${s.status}`)
        );
      }
    }

    // 4. Thống kê customer
    console.log(chalk.yellow("\n📊 [4] Thống kê tổng hợp customer:"));
    const t4 = Date.now();
    const stats = await getCustomerStats(customer._id);
    console.log(chalk.green(`  ⏱ Query time: ${Date.now() - t4}ms`));
    console.log("  Theo trạng thái:");
    stats.byStatus.forEach(s =>
      console.log(`    ${s._id.padEnd(12)}: ${s.count} đơn | Tổng: ${s.total_spent.toLocaleString("vi")}đ | TB: ${Math.round(s.avg_order).toLocaleString("vi")}đ`)
    );
    if (stats.overall) {
      console.log(`  Tổng đã giao: ${stats.overall.total_orders} đơn`);
      console.log(`  Tổng chi:     ${stats.overall.total_spent.toLocaleString("vi")}đ`);
      console.log(`  Trung bình:   ${Math.round(stats.overall.avg_order).toLocaleString("vi")}đ/đơn`);
    }

  } finally {
    await close();
  }
}

main().catch(console.error);
