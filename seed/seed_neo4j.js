/**
 * SEED NEO4J
 * Tạo nodes: Customer, Restaurant, MenuItem
 * Tạo relationships: ORDERED, VISITED, BELONGS_TO, RATED
 */

require("dotenv").config();
const neo4j = require("neo4j-driver");
const { MongoClient } = require("mongodb");

const driver = neo4j.driver(
  process.env.NEO4J_URI      || "bolt://localhost:7687",
  neo4j.auth.basic(
    process.env.NEO4J_USER     || "neo4j",
    process.env.NEO4J_PASSWORD || "password123"
  )
);

const mongoClient = new MongoClient(process.env.MONGO_URI || "mongodb://localhost:27017");

async function clearGraph(session) {
  console.log("🗑  Xóa graph cũ...");
  await session.run("MATCH (n) DETACH DELETE n");
}

async function seedCustomers(session, customers) {
  console.log(`👤 Tạo ${customers.length} Customer nodes...`);
  for (const c of customers) {
    await session.run(
      `CREATE (:Customer {
        id: $id, name: $name, email: $email, phone: $phone,
        district: $district, status: $status
      })`,
      {
        id:       c._id.toString(),
        name:     c.name,
        email:    c.email,
        phone:    c.phone,
        district: c.addresses[0]?.district || "Unknown",
        status:   c.status,
      }
    );
  }
}

async function seedRestaurantsAndMenuItems(session, restaurants) {
  console.log(`🍜 Tạo ${restaurants.length} Restaurant nodes + MenuItem nodes...`);
  for (const r of restaurants) {
    await session.run(
      `CREATE (:Restaurant {
        id: $id, name: $name, rating: $rating,
        categories: $categories, district: $district
      })`,
      {
        id:         r._id.toString(),
        name:       r.name,
        rating:     r.rating,
        categories: r.categories,
        district:   r.address.district,
      }
    );

    for (const item of r.menu) {
      await session.run(
        `MERGE (i:MenuItem { id: $itemId })
         ON CREATE SET i.name = $name, i.price = $price, i.category = $category
         WITH i
         MATCH (r:Restaurant { id: $restId })
         MERGE (i)-[:BELONGS_TO]->(r)`,
        {
          itemId:   item.item_id,
          name:     item.name,
          price:    item.price,
          category: item.category,
          restId:   r._id.toString(),
        }
      );
    }
  }
}

async function seedOrderRelationships(session, orders) {
  console.log(`📦 Tạo relationships từ ${orders.length} orders...`);
  let count = 0;

  for (const order of orders) {
    if (order.status !== "delivered") continue;

    const custId = order.customer_id.toString();
    const restId = order.restaurant_id.toString();

    // VISITED relationship (Customer → Restaurant)
    await session.run(
      `MATCH (c:Customer {id: $custId}), (r:Restaurant {id: $restId})
       MERGE (c)-[v:VISITED]->(r)
       ON CREATE SET v.times = 1, v.last_at = $date, v.total_spent = $total
       ON MATCH  SET v.times = v.times + 1,
                     v.last_at = CASE WHEN $date > v.last_at THEN $date ELSE v.last_at END,
                     v.total_spent = v.total_spent + $total`,
      { custId, restId, date: order.created_at.toISOString(), total: order.total }
    );

    // ORDERED relationship (Customer → MenuItem)
    for (const item of order.items) {
      await session.run(
        `MATCH (c:Customer {id: $custId}), (i:MenuItem {id: $itemId})
         MERGE (c)-[o:ORDERED]->(i)
         ON CREATE SET o.count = $qty, o.last_at = $date
         ON MATCH  SET o.count = o.count + $qty,
                       o.last_at = CASE WHEN $date > o.last_at THEN $date ELSE o.last_at END`,
        { custId, itemId: item.item_id, qty: item.qty, date: order.created_at.toISOString() }
      );
    }

    count++;
    if (count % 200 === 0) process.stdout.write(`  → ${count} orders xử lý...\r`);
  }
  console.log(`\n  ✅ Đã tạo relationships từ ${count} delivered orders`);
}

async function seedReviewRelationships(session, reviews) {
  console.log(`⭐ Tạo RATED relationships từ ${reviews.length} reviews...`);
  for (const rev of reviews) {
    await session.run(
      `MATCH (c:Customer {id: $custId}), (r:Restaurant {id: $restId})
       MERGE (c)-[rt:RATED]->(r)
       ON CREATE SET rt.rating = $rating, rt.comment = $comment, rt.at = $at
       ON MATCH  SET rt.rating = $rating`,
      {
        custId:  rev.customer_id.toString(),
        restId:  rev.restaurant_id.toString(),
        rating:  rev.rating_overall,
        comment: rev.comment.substring(0, 100),
        at:      rev.created_at.toISOString(),
      }
    );
  }
}

async function createIndexes(session) {
  console.log("📌 Tạo Neo4j indexes...");
  const queries = [
    "CREATE INDEX customer_id IF NOT EXISTS FOR (c:Customer) ON (c.id)",
    "CREATE INDEX restaurant_id IF NOT EXISTS FOR (r:Restaurant) ON (r.id)",
    "CREATE INDEX menuitem_id IF NOT EXISTS FOR (i:MenuItem) ON (i.id)",
    "CREATE INDEX menuitem_category IF NOT EXISTS FOR (i:MenuItem) ON (i.category)",
  ];
  for (const q of queries) {
    await session.run(q).catch(() => {});
  }
}

async function main() {
  const session = driver.session();

  try {
    await mongoClient.connect();
    const db = mongoClient.db(process.env.MONGO_DB || "food_delivery");

    console.log("📡 Đọc dữ liệu từ MongoDB...");
    const customers   = await db.collection("customers").find().toArray();
    const restaurants = await db.collection("restaurants").find().toArray();
    const orders      = await db.collection("orders").find().toArray();
    const reviews     = await db.collection("reviews").find().toArray();

    await clearGraph(session);
    await createIndexes(session);
    await seedCustomers(session, customers);
    await seedRestaurantsAndMenuItems(session, restaurants);
    await seedOrderRelationships(session, orders);
    await seedReviewRelationships(session, reviews);

    // Thống kê
    const stats = await session.run(`
      MATCH (c:Customer) WITH count(c) AS customers
      MATCH (r:Restaurant) WITH customers, count(r) AS restaurants
      MATCH (i:MenuItem) WITH customers, restaurants, count(i) AS items
      MATCH ()-[rel]->() WITH customers, restaurants, items, count(rel) AS rels
      RETURN customers, restaurants, items, rels
    `);
    const rec = stats.records[0];
    console.log("\n🎉 SEED NEO4J HOÀN TẤT!");
    console.log(`   Customer nodes : ${rec.get("customers")}`);
    console.log(`   Restaurant nodes: ${rec.get("restaurants")}`);
    console.log(`   MenuItem nodes : ${rec.get("items")}`);
    console.log(`   Relationships  : ${rec.get("rels")}`);

  } finally {
    await session.close();
    await driver.close();
    await mongoClient.close();
  }
}

main().catch(console.error);
