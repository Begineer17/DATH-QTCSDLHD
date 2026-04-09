/**
 * FOOD DELIVERY NOSQL – Interactive Menu
 * Chạy: node index.js
 */

require("dotenv").config();
const { execSync } = require("child_process");
const readline = require("readline");
const chalk    = require("chalk");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(res => rl.question(q, res));

function run(script) {
  try {
    execSync(`node ${script}`, { stdio: "inherit" });
  } catch (e) {
    console.error(chalk.red(`\n❌ Lỗi khi chạy ${script}:`), e.message);
  }
}

async function main() {
  console.clear();
  console.log(chalk.blue.bold(`
╔══════════════════════════════════════════════════════════════╗
║     🍜 FOOD DELIVERY NOSQL – DEMO SYSTEM                    ║
║     Hệ thống quản lý giao đồ ăn trực tuyến                  ║
╚══════════════════════════════════════════════════════════════╝`));
  console.log(chalk.white(`
  ─── SEED DATA ────────────────────────────────────────────────
  [1]  Seed MongoDB (customers, restaurants, orders, reviews)
  [2]  Seed Neo4j   (graph nodes & relationships)
  [3]  Seed Cassandra (order logs, behavior, revenue)
  [all] Seed tất cả

  ─── MONGODB DEMOS ─────────────────────────────────────────────
  [4]  Demo: Lịch sử đơn hàng (MongoDB)
  [5]  Demo: Thống kê món bán chạy (MongoDB Aggregation)
  [6]  Demo: Tìm kiếm nhà hàng (MongoDB Geospatial)

  ─── REDIS DEMOS ───────────────────────────────────────────────
  [7]  Demo: Giỏ hàng, OTP, Rate Limit (Redis)
  [8]  Demo: Leaderboard & Pub/Sub (Redis)

  ─── NEO4J DEMOS ───────────────────────────────────────────────
  [9]  Demo: Gợi ý món ăn - Collaborative Filtering (Neo4j)
  [10] Demo: Phân tích Graph User–Restaurant (Neo4j)

  ─── CASSANDRA DEMOS ───────────────────────────────────────────
  [11] Demo: Order Status Log & User Behavior (Cassandra)

  ─── BENCHMARK ─────────────────────────────────────────────────
  [12] Benchmark: MongoDB vs Cassandra vs Redis

  [q]  Thoát
`));

  const choice = await ask(chalk.yellow("  Nhập lựa chọn: "));

  switch (choice.trim()) {
    case "1":   run("seed/seed_mongo.js");      break;
    case "2":   run("seed/seed_neo4j.js");      break;
    case "3":   run("seed/seed_cassandra.js");  break;
    case "all":
      run("seed/seed_mongo.js");
      run("seed/seed_neo4j.js");
      run("seed/seed_cassandra.js");
      break;
    case "4":   run("src/mongo/order_history.js");    break;
    case "5":   run("src/mongo/top_items.js");         break;
    case "6":   run("src/mongo/restaurant_query.js");  break;
    case "7":   run("src/redis/cart_cache.js");        break;
    case "8":   run("src/redis/session_manager.js");   break;
    case "9":   run("src/neo4j/recommend.js");         break;
    case "10":  run("src/neo4j/user_restaurant_graph.js"); break;
    case "11":  run("src/cassandra/order_log.js");     break;
    case "12":  run("benchmark/run_benchmark.js");     break;
    case "q":   console.log(chalk.green("Tạm biệt! 👋")); rl.close(); return;
    default:    console.log(chalk.red("Lựa chọn không hợp lệ."));
  }

  rl.close();
  console.log(chalk.gray("\n  Chạy lại 'node index.js' để tiếp tục."));
}

main().catch(console.error);
