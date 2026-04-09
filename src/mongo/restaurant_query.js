/**
 * DEMO 3 – Truy vấn nhà hàng nâng cao (MongoDB)
 * ===============================================
 * Các chức năng:
 *  1. findNearbyRestaurants  – Tìm nhà hàng gần vị trí (Geospatial)
 *  2. searchRestaurants      – Tìm kiếm theo tên, danh mục, rating
 *  3. getRestaurantDashboard – Dashboard tổng hợp của nhà hàng
 *  4. getMenuWithFilter      – Lấy menu với bộ lọc
 */

require("dotenv").config();
const { connect, close } = require("./connection");
const chalk = require("chalk");

// ─── 1. Tìm nhà hàng gần vị trí ──────────────────────────────────────────────
async function findNearbyRestaurants(lat, lng, maxDistanceKm = 5, limit = 10) {
  const db = await connect();
  return db.collection("restaurants").find({
    is_open: true,
    "address.coordinates": {
      $near: {
        $geometry:    { type: "Point", coordinates: [lng, lat] },
        $maxDistance: maxDistanceKm * 1000,
      },
    },
  })
  .limit(limit)
  .project({ name: 1, categories: 1, rating: 1, "address.district": 1, estimated_delivery_min: 1 })
  .toArray();
}

// ─── 2. Tìm kiếm theo nhiều tiêu chí ─────────────────────────────────────────
async function searchRestaurants({ keyword, category, minRating = 0, isOpen, page = 1, limit = 5 } = {}) {
  const db = await connect();
  const filter = { rating: { $gte: minRating } };

  if (keyword) {
    filter.$or = [
      { name:        { $regex: keyword, $options: "i" } },
      { categories:  { $regex: keyword, $options: "i" } },
      { description: { $regex: keyword, $options: "i" } },
    ];
  }
  if (category) filter.categories = category;
  if (isOpen !== undefined) filter.is_open = isOpen;

  const [results, total] = await Promise.all([
    db.collection("restaurants")
      .find(filter)
      .sort({ rating: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .project({ name:1, categories:1, rating:1, total_reviews:1, is_open:1, estimated_delivery_min:1, "address.district":1 })
      .toArray(),
    db.collection("restaurants").countDocuments(filter),
  ]);

  return { data: results, total, page, totalPages: Math.ceil(total / limit) };
}

// ─── 3. Dashboard nhà hàng ────────────────────────────────────────────────────
async function getRestaurantDashboard(restaurantId) {
  const db = await connect();

  const [restaurant, orderStats, recentReviews] = await Promise.all([
    // Thông tin nhà hàng
    db.collection("restaurants").findOne({ _id: restaurantId }, {
      projection: { name:1, rating:1, total_reviews:1, is_open:1, categories:1 }
    }),

    // Thống kê đơn hàng 30 ngày qua
    db.collection("orders").aggregate([
      {
        $match: {
          restaurant_id: restaurantId,
          created_at: { $gte: new Date(Date.now() - 30 * 86400000) },
        },
      },
      {
        $group: {
          _id:             "$status",
          count:           { $sum: 1 },
          total_revenue:   { $sum: "$total" },
        },
      },
    ]).toArray(),

    // 5 đánh giá gần nhất
    db.collection("reviews")
      .find({ restaurant_id: restaurantId })
      .sort({ created_at: -1 })
      .limit(5)
      .project({ customer_name:1, rating_overall:1, comment:1, created_at:1 })
      .toArray(),
  ]);

  return { restaurant, orderStats, recentReviews };
}

// ─── 4. Menu với filter ───────────────────────────────────────────────────────
async function getMenuWithFilter(restaurantId, { category, maxPrice, onlyAvailable = true } = {}) {
  const db = await connect();
  const restaurant = await db.collection("restaurants").findOne({ _id: restaurantId });
  if (!restaurant) return null;

  let menu = restaurant.menu;
  if (onlyAvailable) menu = menu.filter(item => item.status === "available");
  if (category)      menu = menu.filter(item => item.category === category);
  if (maxPrice)      menu = menu.filter(item => item.price <= maxPrice);

  return { restaurant_name: restaurant.name, menu_count: menu.length, menu };
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  try {
    const db = await connect();
    const sampleRestaurant = await db.collection("restaurants").findOne();

    console.log(chalk.blue.bold("\n══════════════════════════════════════════════"));
    console.log(chalk.blue.bold("  DEMO 3 – TRUY VẤN NHÀ HÀNG (MongoDB)"));
    console.log(chalk.blue.bold("══════════════════════════════════════════════"));

    // 1. Tìm nhà hàng theo keyword
    console.log(chalk.yellow('\n🔍 [1] Tìm nhà hàng có "Phở" hoặc "Bún":'));
    let t = Date.now();
    const searchResult = await searchRestaurants({ keyword: "Phở", minRating: 3.5 });
    console.log(chalk.green(`  ⏱ ${Date.now() - t}ms | Tìm thấy: ${searchResult.total}`));
    searchResult.data.forEach(r =>
      console.log(`  ${r.is_open ? "🟢" : "🔴"} ${r.name.padEnd(25)} ⭐${r.rating} | ${r.categories.join(", ")} | ${r.address.district}`)
    );

    // 2. Tìm nhà hàng đang mở, rating cao
    console.log(chalk.yellow('\n🏪 [2] Nhà hàng đang mở, rating ≥ 4.0 (trang 1):'));
    t = Date.now();
    const openResult = await searchRestaurants({ isOpen: true, minRating: 4.0, limit: 5 });
    console.log(chalk.green(`  ⏱ ${Date.now() - t}ms | Tổng: ${openResult.total}`));
    openResult.data.forEach(r =>
      console.log(`  ⭐${r.rating} ${r.name} | Giao khoảng ${r.estimated_delivery_min} phút`)
    );

    // 3. Dashboard nhà hàng
    if (sampleRestaurant) {
      console.log(chalk.yellow(`\n📊 [3] Dashboard: ${sampleRestaurant.name}`));
      t = Date.now();
      const dashboard = await getRestaurantDashboard(sampleRestaurant._id);
      console.log(chalk.green(`  ⏱ ${Date.now() - t}ms`));

      if (dashboard.restaurant) {
        console.log(`  ⭐ Rating: ${dashboard.restaurant.rating} (${dashboard.restaurant.total_reviews} đánh giá)`);
        console.log(`  📦 Đơn hàng 30 ngày qua:`);
        dashboard.orderStats.forEach(s =>
          console.log(`    ${s._id.padEnd(12)}: ${s.count} đơn | ${s.total_revenue.toLocaleString("vi")}đ`)
        );
        if (dashboard.recentReviews.length > 0) {
          console.log(`  💬 Đánh giá gần nhất:`);
          dashboard.recentReviews.slice(0, 2).forEach(r =>
            console.log(`    ⭐${r.rating_overall} "${r.comment}" – ${r.customer_name}`)
          );
        }
      }

      // 4. Menu filter
      console.log(chalk.yellow(`\n🍽  [4] Menu ${sampleRestaurant.name} (dưới 70,000đ):`));
      t = Date.now();
      const menuResult = await getMenuWithFilter(sampleRestaurant._id, { maxPrice: 70000 });
      console.log(chalk.green(`  ⏱ ${Date.now() - t}ms`));
      if (menuResult) {
        console.log(`  Số món: ${menuResult.menu_count}`);
        menuResult.menu.slice(0, 5).forEach(item =>
          console.log(`  • ${item.name.padEnd(25)} ${item.price.toLocaleString("vi")}đ  [${item.category}]`)
        );
      }
    }

    // 5. Tìm theo danh mục Pizza
    console.log(chalk.yellow('\n🍕 [5] Nhà hàng danh mục "Pizza":'));
    t = Date.now();
    const pizza = await searchRestaurants({ category: "Pizza" });
    console.log(chalk.green(`  ⏱ ${Date.now() - t}ms | Tìm thấy: ${pizza.total}`));
    pizza.data.forEach(r => console.log(`  • ${r.name} | ⭐${r.rating}`));

  } finally {
    await close();
  }
}

main().catch(console.error);
