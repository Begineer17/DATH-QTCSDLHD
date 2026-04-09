/**
 * DEMO 7 – Truy vấn Graph User–Restaurant (Neo4j)
 * =================================================
 * Phân tích quan hệ sâu trong graph:
 *  1. Tìm nhà hàng được nhiều người recommend nhất
 *  2. Phân tích "influencer" – user đã thử nhiều nhà hàng nhất
 *  3. Cluster: nhóm user theo sở thích danh mục
 *  4. Thống kê graph tổng hợp
 */

require("dotenv").config();
const neo4j = require("neo4j-driver");
const chalk = require("chalk");

const driver = neo4j.driver(
  process.env.NEO4J_URI      || "bolt://localhost:7687",
  neo4j.auth.basic(
    process.env.NEO4J_USER     || "neo4j",
    process.env.NEO4J_PASSWORD || "password123"
  )
);

async function run(cypher, params = {}) {
  const session = driver.session();
  try {
    const result = await session.run(cypher, params);
    return result.records;
  } finally {
    await session.close();
  }
}

async function main() {
  console.log(chalk.blue.bold("\n═══════════════════════════════════════════════════"));
  console.log(chalk.blue.bold("  DEMO 7 – PHÂN TÍCH GRAPH USER–RESTAURANT (Neo4j)"));
  console.log(chalk.blue.bold("═══════════════════════════════════════════════════"));

  // ── Graph Statistics ───────────────────────────────────────────────────────
  console.log(chalk.yellow("\n📊 [1] Thống kê tổng hợp Graph:"));
  let t = Date.now();
  const statsRec = await run(`
    MATCH (c:Customer) WITH count(c) AS customers
    MATCH (r:Restaurant) WITH customers, count(r) AS restaurants
    MATCH (i:MenuItem) WITH customers, restaurants, count(i) AS items
    MATCH ()-[rel]->() WITH customers, restaurants, items, count(rel) AS rels
    RETURN customers, restaurants, items, rels
  `);
  console.log(chalk.green(`  ⏱ ${Date.now() - t}ms`));
  if (statsRec.length > 0) {
    const s = statsRec[0];
    console.log(`  Customer nodes  : ${s.get("customers")}`);
    console.log(`  Restaurant nodes: ${s.get("restaurants")}`);
    console.log(`  MenuItem nodes  : ${s.get("items")}`);
    console.log(`  Relationships   : ${s.get("rels")}`);
  }

  // ── Top nhà hàng được nhiều user ghé nhất ─────────────────────────────────
  console.log(chalk.yellow("\n🏆 [2] Top 5 nhà hàng có nhiều khách nhất:"));
  t = Date.now();
  const topRest = await run(`
    MATCH (c:Customer)-[v:VISITED]->(r:Restaurant)
    WITH r, count(distinct c) AS uniqueCustomers, sum(v.times) AS totalVisits
    RETURN r.name AS name, r.rating AS rating, uniqueCustomers, totalVisits
    ORDER BY uniqueCustomers DESC LIMIT 5
  `);
  console.log(chalk.green(`  ⏱ ${Date.now() - t}ms`));
  topRest.forEach((r, i) =>
    console.log(`  ${i+1}. ${r.get("name").padEnd(25)} ⭐${r.get("rating")} | ${r.get("uniqueCustomers")} khách | ${r.get("totalVisits")} lần`)
  );

  // ── Influencers: User đã thử nhiều nhà hàng nhất ──────────────────────────
  console.log(chalk.yellow("\n🌟 [3] Top 5 Food Explorers (đã thử nhiều nơi nhất):"));
  t = Date.now();
  const explorers = await run(`
    MATCH (c:Customer)-[:VISITED]->(r:Restaurant)
    WITH c, count(distinct r) AS restaurantCount
    RETURN c.name AS name, restaurantCount
    ORDER BY restaurantCount DESC LIMIT 5
  `);
  console.log(chalk.green(`  ⏱ ${Date.now() - t}ms`));
  explorers.forEach((r, i) =>
    console.log(`  ${i+1}. ${r.get("name").padEnd(25)} đã thử ${r.get("restaurantCount")} nhà hàng`)
  );

  // ── Món ăn "viral" – được đặt bởi nhiều user nhất ─────────────────────────
  console.log(chalk.yellow("\n🔥 [4] Top 5 món ăn 'viral' (nhiều user đặt nhất):"));
  t = Date.now();
  const viral = await run(`
    MATCH (c:Customer)-[o:ORDERED]->(i:MenuItem)-[:BELONGS_TO]->(r:Restaurant)
    WITH i, r, count(distinct c) AS uniqueCustomers, sum(o.count) AS totalOrders
    RETURN i.name AS item, r.name AS restaurant, i.category AS category,
           uniqueCustomers, totalOrders
    ORDER BY uniqueCustomers DESC LIMIT 5
  `);
  console.log(chalk.green(`  ⏱ ${Date.now() - t}ms`));
  viral.forEach((r, i) =>
    console.log(`  ${i+1}. ${r.get("item").padEnd(25)} [${r.get("category")}] @ ${r.get("restaurant")} | ${r.get("uniqueCustomers")} users`)
  );

  // ── Users đã thử cả 2 nhà hàng cụ thể ────────────────────────────────────
  const restNames = topRest.slice(0, 2).map(r => r.get("name"));
  if (restNames.length === 2) {
    console.log(chalk.yellow(`\n🔗 [5] Users đã ghé CẢ 2 nhà hàng "${restNames[0]}" và "${restNames[1]}":"`));
    t = Date.now();
    const both = await run(`
      MATCH (r1:Restaurant {name: $r1})<-[:VISITED]-(c:Customer)-[:VISITED]->(r2:Restaurant {name: $r2})
      RETURN c.name AS name LIMIT 10
    `, { r1: restNames[0], r2: restNames[1] });
    console.log(chalk.green(`  ⏱ ${Date.now() - t}ms | Tìm thấy: ${both.length} users`));
    both.slice(0, 5).forEach(r => console.log(`  • ${r.get("name")}`));
  }

  // ── Danh mục phổ biến nhất theo quận ──────────────────────────────────────
  console.log(chalk.yellow("\n📍 [6] Danh mục món phổ biến theo quận:"));
  t = Date.now();
  const byDistrict = await run(`
    MATCH (c:Customer)-[:ORDERED]->(i:MenuItem)
    WITH c.district AS district, i.category AS category, count(*) AS orders
    ORDER BY district, orders DESC
    WITH district, collect({category: category, orders: orders})[0] AS top
    RETURN district, top.category AS topCategory, top.orders AS orders
    ORDER BY orders DESC LIMIT 6
  `);
  console.log(chalk.green(`  ⏱ ${Date.now() - t}ms`));
  byDistrict.forEach(r =>
    console.log(`  ${r.get("district").padEnd(20)} Top: ${r.get("topCategory").padEnd(15)} (${r.get("orders")} orders)`)
  );

  // ── Rating của nhà hàng theo review từ graph ──────────────────────────────
  console.log(chalk.yellow("\n⭐ [7] Average rating từ RATED relationships:"));
  t = Date.now();
  const ratings = await run(`
    MATCH (c:Customer)-[rt:RATED]->(r:Restaurant)
    WITH r, avg(rt.rating) AS avgRating, count(rt) AS reviewCount
    WHERE reviewCount >= 3
    RETURN r.name AS name, round(avgRating * 10) / 10 AS avgRating, reviewCount
    ORDER BY avgRating DESC LIMIT 5
  `);
  console.log(chalk.green(`  ⏱ ${Date.now() - t}ms`));
  ratings.forEach((r, i) =>
    console.log(`  ${i+1}. ${r.get("name").padEnd(25)} ⭐${r.get("avgRating")} (${r.get("reviewCount")} reviews)`)
  );

  await driver.close();
}

main().catch(console.error);
