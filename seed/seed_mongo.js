/**
 * SEED MONGODB
 * Sinh dữ liệu mẫu: Customers, Restaurants, Orders, Reviews
 */

require("dotenv").config();
const { MongoClient, ObjectId } = require("mongodb");

const URI = process.env.MONGO_URI || "mongodb://localhost:27017";
const DB  = process.env.MONGO_DB  || "food_delivery";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const rand      = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt   = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randFloat = (min, max) => parseFloat((Math.random() * (max - min) + min).toFixed(1));
const randDate  = (daysAgo) => new Date(Date.now() - Math.random() * daysAgo * 86400000);

// ─── Data Templates ───────────────────────────────────────────────────────────
const FIRST_NAMES = ["Nguyễn Văn","Trần Thị","Lê Văn","Phạm Thị","Hoàng Văn","Vũ Thị","Đặng Văn","Bùi Thị","Đỗ Văn","Ngô Thị"];
const LAST_NAMES  = ["An","Bình","Chi","Dung","Em","Phong","Giang","Hoa","Khánh","Linh","Minh","Nam","Oanh","Phúc","Quân"];
const DISTRICTS   = ["Quận 1","Quận 3","Quận 5","Quận 7","Quận Bình Thạnh","Quận Tân Bình","Quận Gò Vấp","Thủ Đức"];
const STREETS     = ["Lê Lợi","Nguyễn Huệ","Trần Hưng Đạo","Điện Biên Phủ","Cách Mạng Tháng 8","Võ Văn Tần","Lý Tự Trọng"];
const PAY_METHODS = ["momo","vnpay","zalopay","cash","visa"];
const ORDER_STATUSES = ["placed","confirmed","preparing","picked_up","delivered","cancelled"];
const ITEM_CATEGORIES = ["Cơm","Phở","Bún","Bánh mì","Pizza","Burger","Gà rán","Trà sữa","Nước ép","Tráng miệng"];

const RESTAURANTS_DATA = [
  { name: "Phở Hà Nội Ngon", categories: ["Phở","Bún","Cháo"] },
  { name: "Cơm Tấm Sài Gòn", categories: ["Cơm","Thịt nướng"] },
  { name: "Bánh Mì 37", categories: ["Bánh mì","Ăn vặt"] },
  { name: "Trà Sữa Gong Cha", categories: ["Trà sữa","Nước uống"] },
  { name: "Gà Rán KFC Clone", categories: ["Gà rán","Burger","Khoai tây"] },
  { name: "Pizza 4P's Local", categories: ["Pizza","Pasta","Salad"] },
  { name: "Bún Bò Huế Cô Ba", categories: ["Bún","Miền Trung"] },
  { name: "Dimsum House", categories: ["Dimsum","Hải sản"] },
  { name: "Sushi Sài Gòn", categories: ["Sushi","Nhật Bản"] },
  { name: "Cháo Lòng Bà Tư", categories: ["Cháo","Ăn sáng"] },
  { name: "Hủ Tiếu Nam Vang", categories: ["Hủ tiếu","Canh"] },
  { name: "Lẩu 28", categories: ["Lẩu","Nướng","Hải sản"] },
  { name: "Bánh Cuốn Thanh Trì", categories: ["Bánh cuốn","Miền Bắc"] },
  { name: "Bếp Việt Home", categories: ["Cơm nhà","Canh","Xào"] },
  { name: "The Burger Lab", categories: ["Burger","Hotdog","Khoai tây chiên"] },
];

const MENU_ITEMS_BY_CATEGORY = {
  "Phở":    [{ name:"Phở Bò Tái",price:65000},{ name:"Phở Bò Chín",price:65000},{ name:"Phở Gà",price:55000},{ name:"Phở Đặc Biệt",price:80000}],
  "Bún":    [{ name:"Bún Bò Huế",price:60000},{ name:"Bún Riêu",price:55000},{ name:"Bún Chả",price:65000}],
  "Cháo":   [{ name:"Cháo Lòng",price:40000},{ name:"Cháo Gà",price:45000},{ name:"Cháo Trắng",price:25000}],
  "Cơm":    [{ name:"Cơm Tấm Sườn",price:55000},{ name:"Cơm Gà Xối Mỡ",price:50000},{ name:"Cơm Bì Chả",price:50000},{ name:"Cơm Đặc Biệt",price:75000}],
  "Bánh mì":[{ name:"Bánh Mì Thịt",price:25000},{ name:"Bánh Mì Trứng",price:20000},{ name:"Bánh Mì Đặc Biệt",price:35000}],
  "Pizza":  [{ name:"Pizza Hải Sản",price:185000},{ name:"Pizza 4 Phô Mai",price:175000},{ name:"Pizza Bò BBQ",price:170000}],
  "Burger": [{ name:"Double Cheese Burger",price:95000},{ name:"Crispy Chicken Burger",price:85000},{ name:"Veggie Burger",price:75000}],
  "Gà rán": [{ name:"Gà Rán 2 Miếng",price:75000},{ name:"Gà Rán 4 Miếng",price:130000},{ name:"Cánh Gà Cay",price:65000}],
  "Trà sữa":[{ name:"Trà Sữa Trân Châu",price:45000},{ name:"Matcha Latte",price:55000},{ name:"Trà Đào",price:45000}],
  "Lẩu":   [{ name:"Lẩu Thái Hải Sản",price:280000},{ name:"Lẩu Bò",price:250000},{ name:"Lẩu Nấm",price:200000}],
  "Sushi":  [{ name:"Set Sashimi 10 miếng",price:150000},{ name:"Set Maki 8 cuộn",price:120000},{ name:"Sushi Cá Hồi",price:85000}],
  "Dimsum": [{ name:"Há Cảo 4 miếng",price:55000},{ name:"Xíu Mại",price:50000},{ name:"Bánh Cuốn Tôm",price:60000}],
};

// ─── Generators ───────────────────────────────────────────────────────────────
function generateCustomers(n) {
  return Array.from({ length: n }, (_, i) => {
    const firstName = rand(FIRST_NAMES);
    const lastName  = rand(LAST_NAMES);
    return {
      _id: new ObjectId(),
      customer_code: `CUST_${String(i + 1).padStart(5, "0")}`,
      name:  `${firstName} ${lastName}`,
      phone: `09${String(randInt(10000000, 99999999))}`,
      email: `user${i + 1}@email.com`,
      avatar_url: `https://api.dicebear.com/7.x/avataaars/svg?seed=${i}`,
      addresses: [
        {
          label:       "Nhà",
          street:      `${randInt(1, 200)} ${rand(STREETS)}`,
          district:    rand(DISTRICTS),
          city:        "TP.HCM",
          coordinates: { type: "Point", coordinates: [randFloat(106.62, 106.78), randFloat(10.72, 10.85)] },
          is_default:  true,
        },
        {
          label:       "Cơ quan",
          street:      `${randInt(1, 200)} ${rand(STREETS)}`,
          district:    rand(DISTRICTS),
          city:        "TP.HCM",
          coordinates: { type: "Point", coordinates: [randFloat(106.62, 106.78), randFloat(10.72, 10.85)] },
          is_default:  false,
        },
      ],
      preferences: {
        favorite_categories: [rand(ITEM_CATEGORIES), rand(ITEM_CATEGORIES)],
        dietary: rand(["none","vegetarian","halal","none","none"]),
      },
      total_orders:  0,
      total_spent:   0,
      status:        rand(["active","active","active","inactive"]),
      created_at:    randDate(365),
      last_login_at: randDate(7),
    };
  });
}

function generateRestaurants() {
  return RESTAURANTS_DATA.map((r, i) => {
    // Build menu from categories
    const menu = [];
    r.categories.forEach(cat => {
      const items = MENU_ITEMS_BY_CATEGORY[cat] || [];
      items.forEach(item => {
        menu.push({
          item_id:     `item_${String(menu.length + 1).padStart(4,"0")}_r${i}`,
          name:        item.name,
          price:       item.price,
          category:    cat,
          status:      rand(["available","available","available","sold_out"]),
          description: `${item.name} thơm ngon, tươi mới mỗi ngày`,
          image_url:   `https://source.unsplash.com/300x200/?${encodeURIComponent(item.name)},food`,
          tags:        [cat, "Ngon"],
          created_at:  randDate(365),
        });
      });
    });

    return {
      _id:              new ObjectId(),
      restaurant_code:  `REST_${String(i + 1).padStart(3,"0")}`,
      name:             r.name,
      categories:       r.categories,
      description:      `${r.name} - Hương vị đặc trưng, phục vụ tận tâm`,
      address: {
        street:      `${randInt(1, 500)} ${rand(STREETS)}`,
        district:    rand(DISTRICTS),
        city:        "TP.HCM",
        coordinates: { type: "Point", coordinates: [randFloat(106.62, 106.78), randFloat(10.72, 10.85)] },
      },
      phone:         `02838${randInt(100000, 999999)}`,
      logo_url:      `https://api.dicebear.com/7.x/identicon/svg?seed=rest${i}`,
      opening_hours: {
        mon_fri: { open: "07:00", close: "22:00" },
        weekend: { open: "07:00", close: "23:00" },
      },
      is_open:          rand([true, true, true, false]),
      rating:           randFloat(3.5, 5.0),
      total_reviews:    randInt(20, 500),
      total_orders:     randInt(100, 5000),
      menu,
      delivery_radius_km: randInt(3, 10),
      min_order_value:    randInt(30000, 80000),
      estimated_delivery_min: randInt(20, 45),
      status:          "active",
      created_at:      randDate(730),
    };
  });
}

function generateOrders(customers, restaurants, n) {
  return Array.from({ length: n }, (_, i) => {
    const customer    = rand(customers);
    const restaurant  = rand(restaurants);
    const menuItems   = restaurant.menu.filter(m => m.status === "available");
    if (menuItems.length === 0) return null;

    // Pick 1–4 random items
    const numItems = randInt(1, Math.min(4, menuItems.length));
    const picked   = [];
    const used     = new Set();
    while (picked.length < numItems) {
      const item = rand(menuItems);
      if (!used.has(item.item_id)) {
        used.add(item.item_id);
        const qty = randInt(1, 3);
        picked.push({
          item_id:   item.item_id,
          name:      item.name,
          price:     item.price,
          qty,
          subtotal:  item.price * qty,
          category:  item.category,
        });
      }
    }

    const subtotal     = picked.reduce((s, x) => s + x.subtotal, 0);
    const delivery_fee = randInt(10000, 30000);
    const discount     = rand([0, 0, 0, 10000, 15000, 20000]);
    const total        = subtotal + delivery_fee - discount;

    const createdAt = randDate(90);

    // Status history (progressive timestamps)
    const finalStatus = rand(["delivered","delivered","delivered","delivered","cancelled"]);
    const statusHistory = [{ status: "placed", timestamp: createdAt }];

    let t = new Date(createdAt.getTime() + randInt(1,3) * 60000);
    if (finalStatus !== "cancelled") {
      statusHistory.push({ status: "confirmed",  timestamp: new Date(t) });
      t = new Date(t.getTime() + randInt(5,15) * 60000);
      statusHistory.push({ status: "preparing",  timestamp: new Date(t) });
      t = new Date(t.getTime() + randInt(10,25) * 60000);
      statusHistory.push({ status: "picked_up",  timestamp: new Date(t) });
      t = new Date(t.getTime() + randInt(10,30) * 60000);
      statusHistory.push({ status: "delivered",  timestamp: new Date(t) });
    } else {
      t = new Date(t.getTime() + randInt(1,5) * 60000);
      statusHistory.push({ status: "cancelled",  timestamp: new Date(t) });
    }

    return {
      _id:            new ObjectId(),
      order_code:     `ORD_${String(i + 1).padStart(7,"0")}`,
      customer_id:    customer._id,
      customer_name:  customer.name,
      restaurant_id:  restaurant._id,
      restaurant_name:restaurant.name,
      items:          picked,
      status:         finalStatus,
      status_history: statusHistory,
      payment: {
        method:         rand(PAY_METHODS),
        amount:         total,
        status:         finalStatus === "cancelled" ? "refunded" : "paid",
        transaction_id: `TXN_${Math.random().toString(36).substr(2,10).toUpperCase()}`,
        paid_at:        finalStatus !== "cancelled" ? t : null,
      },
      delivery_address: rand(customer.addresses),
      driver_id:  `DRV_${String(randInt(1,50)).padStart(3,"0")}`,
      subtotal,
      delivery_fee,
      discount,
      total,
      note:       rand(["","","Không cay","Thêm tương ớt","Giao nhanh giúp mình","Không hành"]),
      created_at: createdAt,
      delivered_at: finalStatus === "delivered" ? statusHistory.at(-1).timestamp : null,
    };
  }).filter(Boolean);
}

function generateReviews(orders) {
  return orders
    .filter(o => o.status === "delivered")
    .filter(() => Math.random() > 0.3)  // 70% đơn giao xong có review
    .map(order => ({
      _id:           new ObjectId(),
      order_id:      order._id,
      customer_id:   order.customer_id,
      customer_name: order.customer_name,
      restaurant_id: order.restaurant_id,
      rating_overall:    randInt(3, 5),
      rating_food:       randInt(3, 5),
      rating_delivery:   randInt(3, 5),
      comment: rand([
        "Món ăn ngon, giao hàng nhanh!",
        "Tuyệt vời, sẽ ủng hộ tiếp.",
        "Đồ ăn còn nóng khi nhận được.",
        "Hơi mặn nhưng vẫn ngon.",
        "Giao hơi chậm nhưng chất lượng ok.",
        "Đóng gói cẩn thận, rất hài lòng.",
        "Sẽ giới thiệu cho bạn bè.",
        "Phần ăn hơi ít so với giá tiền.",
        "Nhân viên thân thiện, giao hàng đúng giờ.",
        "Ngon như quảng cáo!",
      ]),
      item_ratings: order.items.map(item => ({
        item_id: item.item_id,
        name:    item.name,
        rating:  randInt(3, 5),
      })),
      images:    [],
      is_visible: true,
      created_at: new Date(order.delivered_at.getTime() + randInt(10,120) * 60000),
    }));
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const client = new MongoClient(URI);
  try {
    await client.connect();
    console.log("✅ Kết nối MongoDB thành công");
    const db = client.db(DB);

    // Drop & recreate collections
    const colls = ["customers","restaurants","orders","reviews"];
    for (const c of colls) {
      await db.collection(c).drop().catch(() => {});
    }
    console.log("🗑  Đã xóa collections cũ");

    // Customers
    console.log("👤 Đang tạo 200 customers...");
    const customers = generateCustomers(200);
    await db.collection("customers").insertMany(customers);

    // Restaurants
    console.log("🍜 Đang tạo 15 restaurants...");
    const restaurants = generateRestaurants();
    await db.collection("restaurants").insertMany(restaurants);

    // Orders
    console.log("📦 Đang tạo 5,000 orders...");
    const orders = generateOrders(customers, restaurants, 5000);
    await db.collection("orders").insertMany(orders);

    // Reviews
    console.log("⭐ Đang tạo reviews...");
    const reviews = generateReviews(orders);
    await db.collection("reviews").insertMany(reviews);

    // ── Indexes ──────────────────────────────────────────────────────────────
    console.log("📌 Tạo indexes...");

    await db.collection("customers").createIndex({ email: 1 },  { unique: true });
    await db.collection("customers").createIndex({ phone: 1 });
    await db.collection("customers").createIndex({ status: 1 });

    await db.collection("restaurants").createIndex({ "address.coordinates": "2dsphere" });
    await db.collection("restaurants").createIndex({ categories: 1 });
    await db.collection("restaurants").createIndex({ rating: -1 });
    await db.collection("restaurants").createIndex({ is_open: 1, rating: -1 });

    await db.collection("orders").createIndex({ customer_id: 1, created_at: -1 });
    await db.collection("orders").createIndex({ restaurant_id: 1, created_at: -1 });
    await db.collection("orders").createIndex({ status: 1, created_at: -1 });
    await db.collection("orders").createIndex({ created_at: -1 });

    await db.collection("reviews").createIndex({ restaurant_id: 1, created_at: -1 });
    await db.collection("reviews").createIndex({ customer_id: 1 });

    console.log("\n🎉 SEED MONGODB HOÀN TẤT!");
    console.log(`   customers  : ${customers.length}`);
    console.log(`   restaurants: ${restaurants.length}`);
    console.log(`   orders     : ${orders.length}`);
    console.log(`   reviews    : ${reviews.length}`);

  } finally {
    await client.close();
  }
}

main().catch(console.error);
