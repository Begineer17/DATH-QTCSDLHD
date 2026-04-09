/**
 * DEMO 6 – Gợi ý món ăn (Neo4j Graph)
 * =====================================
 * Thuật toán: Collaborative Filtering
 *  - Tìm user có hành vi tương tự (đã đặt nhiều món giống nhau)
 *  - Gợi ý món mà user tương tự đã đặt nhưng user hiện tại chưa thử
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

// ─── 1. Gợi ý món dựa trên Collaborative Filtering ───────────────────────────
async function getRecommendedItems(customerId, limit = 8) {
  const session = driver.session();
  try {
    const result = await session.run(`
      // Bước 1: Lấy danh sách món user đã đặt
      MATCH (me:Customer {id: $customerId})-[:ORDERED]->(item:MenuItem)
      WITH me, collect(item.id) AS myItems, collect(item.category) AS myCategories

      // Bước 2: Tìm user tương tự (đã đặt nhiều món giống tôi)
      MATCH (me)-[:ORDERED]->(:MenuItem)<-[:ORDERED]-(similar:Customer)
      WHERE similar.id <> $customerId
      WITH me, myItems, myCategories, similar, count(*) AS commonItems
      ORDER BY commonItems DESC
      LIMIT 15

      // Bước 3: Lấy món mà user tương tự đã đặt nhiều
      MATCH (similar)-[o:ORDERED]->(rec:MenuItem)
      WHERE NOT rec.id IN myItems

      // Ưu tiên cùng danh mục sở thích
      WITH rec, sum(o.count) AS totalOrdered,
           count(distinct similar) AS fromUsers,
           CASE WHEN rec.category IN myCategories THEN 1.5 ELSE 1.0 END AS categoryBoost
      WITH rec, totalOrdered, fromUsers,
           toFloat(totalOrdered) * categoryBoost AS score

      RETURN rec.id      AS item_id,
             rec.name    AS name,
             rec.price   AS price,
             rec.category AS category,
             totalOrdered,
             fromUsers,
             score
      ORDER BY score DESC
      LIMIT $limit
    `, { customerId, limit: neo4j.int(limit) });

    return result.records.map(r => ({
      item_id:       r.get("item_id"),
      name:          r.get("name"),
      price:         r.get("price").toNumber(),
      category:      r.get("category"),
      total_ordered: r.get("totalOrdered").toNumber(),
      from_users:    r.get("fromUsers").toNumber(),
      score:         parseFloat(r.get("score").toFixed(2)),
    }));
  } finally {
    await session.close();
  }
}

// ─── 2. Gợi ý nhà hàng chưa thử ──────────────────────────────────────────────
async function getRecommendedRestaurants(customerId, limit = 5) {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (me:Customer {id: $customerId})-[:VISITED]->(visited:Restaurant)
      WITH me, collect(visited.id) AS visitedIds

      MATCH (me)-[:VISITED]->(:Restaurant)<-[:VISITED]-(similar:Customer)
      WHERE similar.id <> $customerId
      WITH me, visitedIds, similar, count(*) AS commonVisits
      ORDER BY commonVisits DESC LIMIT 10

      MATCH (similar)-[v:VISITED]->(rec:Restaurant)
      WHERE NOT rec.id IN visitedIds

      WITH rec, sum(v.times) AS totalVisits, count(distinct similar) AS fromUsers
      RETURN rec.id         AS restaurant_id,
             rec.name       AS name,
             rec.rating     AS rating,
             rec.categories AS categories,
             totalVisits,
             fromUsers
      ORDER BY totalVisits DESC
      LIMIT $limit
    `, { customerId, limit: neo4j.int(limit) });

    return result.records.map(r => ({
      restaurant_id: r.get("restaurant_id"),
      name:          r.get("name"),
      rating:        r.get("rating"),
      categories:    r.get("categories"),
      total_visits:  r.get("totalVisits").toNumber(),
      from_users:    r.get("fromUsers").toNumber(),
    }));
  } finally {
    await session.close();
  }
}

// ─── 3. Tìm user "ăn giống mình nhất" ────────────────────────────────────────
async function getSimilarUsers(customerId, limit = 5) {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (me:Customer {id: $customerId})-[:ORDERED]->(item:MenuItem)
      WITH me, collect(item.id) AS myItems, count(item) AS myCount

      MATCH (other:Customer)-[:ORDERED]->(item:MenuItem)
      WHERE other.id <> $customerId AND item.id IN myItems
      WITH me, myItems, myCount, other, count(item) AS sharedCount

      RETURN other.id    AS customer_id,
             other.name  AS name,
             sharedCount,
             myCount,
             toFloat(sharedCount) / myCount AS similarity
      ORDER BY similarity DESC
      LIMIT $limit
    `, { customerId, limit: neo4j.int(limit) });

    return result.records.map(r => ({
      customer_id: r.get("customer_id"),
      name:        r.get("name"),
      shared:      r.get("sharedCount").toNumber(),
      similarity:  parseFloat(r.get("similarity").toFixed(3)),
    }));
  } finally {
    await session.close();
  }
}

// ─── 4. Lấy profile ẩm thực của user ─────────────────────────────────────────
async function getFoodProfile(customerId) {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (me:Customer {id: $customerId})-[o:ORDERED]->(item:MenuItem)
      WITH me, item.category AS cat, sum(o.count) AS cnt
      ORDER BY cnt DESC
      RETURN collect({ category: cat, count: cnt }) AS profile
    `, { customerId });

    const visitResult = await session.run(`
      MATCH (me:Customer {id: $customerId})-[v:VISITED]->(r:Restaurant)
      RETURN r.name AS name, v.times AS times, v.total_spent AS spent
      ORDER BY v.times DESC LIMIT 5
    `, { customerId });

    return {
      favorite_categories: result.records[0]?.get("profile") || [],
      top_restaurants:     visitResult.records.map(r => ({
        name:   r.get("name"),
        visits: r.get("times").toNumber(),
        spent:  r.get("spent"),
      })),
    };
  } finally {
    await session.close();
  }
}

// ─── 5. Lấy path ngắn nhất giữa 2 users qua nhà hàng ─────────────────────────
async function getUserConnectionPath(userId1, userId2) {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH path = shortestPath(
        (u1:Customer {id: $userId1})-[*..6]-(u2:Customer {id: $userId2})
      )
      RETURN [n IN nodes(path) | coalesce(n.name, n.id)] AS nodePath,
             length(path) AS hops
    `, { userId1, userId2 });

    if (result.records.length === 0) return null;
    const r = result.records[0];
    return { path: r.get("nodePath"), hops: r.get("hops").toNumber() };
  } finally {
    await session.close();
  }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  try {
    // Lấy customer bất kỳ có nhiều quan hệ
    const session = driver.session();
    const res = await session.run(`
      MATCH (c:Customer)-[o:ORDERED]->(:MenuItem)
      WITH c, sum(o.count) AS total ORDER BY total DESC LIMIT 1
      RETURN c.id AS id, c.name AS name
    `);
    await session.close();

    if (res.records.length === 0) {
      console.log("❌ Không có dữ liệu trong Neo4j. Chạy 'npm run seed:neo4j' trước.");
      return;
    }

    const customerId   = res.records[0].get("id");
    const customerName = res.records[0].get("name");

    console.log(chalk.blue.bold("\n════════════════════════════════════════════"));
    console.log(chalk.blue.bold("  DEMO 6 – GỢI Ý MÓN ĂN (Neo4j Graph)"));
    console.log(chalk.blue.bold("════════════════════════════════════════════"));
    console.log(chalk.gray(`Customer: ${customerName} (${customerId})\n`));

    // 1. Profile ẩm thực
    console.log(chalk.yellow("🍽  [1] Sở thích ẩm thực:"));
    let t = Date.now();
    const profile = await getFoodProfile(customerId);
    console.log(chalk.green(`  ⏱ ${Date.now() - t}ms`));
    if (profile.favorite_categories.length > 0) {
      profile.favorite_categories.slice(0, 5).forEach(c =>
        console.log(`    ${c.category.padEnd(15)} đã đặt: ${c.count} lần`)
      );
    }
    if (profile.top_restaurants.length > 0) {
      console.log("  Nhà hàng hay ghé:");
      profile.top_restaurants.forEach(r =>
        console.log(`    ${r.name.padEnd(25)} ${r.visits} lần`)
      );
    }

    // 2. Gợi ý món
    console.log(chalk.yellow("\n🤖 [2] Gợi ý món (Collaborative Filtering):"));
    t = Date.now();
    const recs = await getRecommendedItems(customerId, 6);
    console.log(chalk.green(`  ⏱ ${Date.now() - t}ms`));
    if (recs.length === 0) {
      console.log("  (Chưa đủ dữ liệu để gợi ý)");
    } else {
      console.log(`  ${"Tên món".padEnd(27)} ${"Danh mục".padEnd(12)} ${"Giá".padStart(8)} ${"Score".padStart(7)}`);
      console.log(`  ${"-".repeat(60)}`);
      recs.forEach((item, i) =>
        console.log(`  ${i+1}. ${item.name.padEnd(25)} ${item.category.padEnd(12)} ${item.price.toLocaleString("vi").padStart(7)}đ  ${String(item.score).padStart(6)}`)
      );
    }

    // 3. Gợi ý nhà hàng
    console.log(chalk.yellow("\n🏪 [3] Nhà hàng gợi ý (chưa từng ghé):"));
    t = Date.now();
    const restRecs = await getRecommendedRestaurants(customerId, 4);
    console.log(chalk.green(`  ⏱ ${Date.now() - t}ms`));
    if (restRecs.length === 0) {
      console.log("  (Chưa đủ dữ liệu)");
    } else {
      restRecs.forEach(r =>
        console.log(`  ⭐${r.rating} ${r.name.padEnd(25)} [${r.categories.slice(0,2).join(", ")}]  ${r.from_users} users đề xuất`)
      );
    }

    // 4. Users tương tự
    console.log(chalk.yellow("\n👥 [4] Users có gu ăn tương tự:"));
    t = Date.now();
    const similar = await getSimilarUsers(customerId, 4);
    console.log(chalk.green(`  ⏱ ${Date.now() - t}ms`));
    similar.forEach(u =>
      console.log(`  ${u.name.padEnd(25)} ${u.shared} món chung | similarity: ${u.similarity}`)
    );

    // 5. Kết nối giữa 2 users
    if (similar.length >= 1) {
      const otherId = similar[0].customer_id;
      console.log(chalk.yellow(`\n🔗 [5] Kết nối giữa 2 users qua nhà hàng:`));
      t = Date.now();
      const path = await getUserConnectionPath(customerId, otherId);
      console.log(chalk.green(`  ⏱ ${Date.now() - t}ms`));
      if (path) {
        console.log(`  Chuỗi kết nối (${path.hops} bước): ${path.path.join(" → ")}`);
      } else {
        console.log("  Không tìm thấy kết nối trong 6 bước");
      }
    }

  } finally {
    await driver.close();
  }
}

main().catch(console.error);
