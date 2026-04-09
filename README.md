# 🍜 Food Delivery NoSQL – Demo System

Hệ thống quản lý ứng dụng giao đồ ăn trực tuyến, demo **Polyglot Persistence** với MongoDB, Redis, Neo4j và Cassandra.

---

## 📁 Cấu trúc thư mục

```
food-delivery-nosql/
├── docker-compose.yml          ← Khởi động 4 CSDL cùng lúc
├── package.json
├── .env                        ← Cấu hình kết nối
├── index.js                    ← Menu chạy demo tương tác
│
├── seed/
│   ├── seed_mongo.js           ← Sinh dữ liệu mẫu cho MongoDB
│   ├── seed_neo4j.js           ← Tạo Graph từ dữ liệu MongoDB
│   └── seed_cassandra.js       ← Tạo bảng & dữ liệu Cassandra
│
├── src/
│   ├── mongo/
│   │   ├── connection.js
│   │   ├── order_history.js    ← Demo 1: Lịch sử đơn hàng
│   │   ├── top_items.js        ← Demo 2: Thống kê món bán chạy
│   │   └── restaurant_query.js ← Demo 3: Tìm kiếm nhà hàng
│   ├── redis/
│   │   ├── cart_cache.js       ← Demo 4: Giỏ hàng, OTP, Rate Limit
│   │   └── session_manager.js  ← Demo 5: Leaderboard & Pub/Sub
│   ├── neo4j/
│   │   ├── recommend.js        ← Demo 6: Gợi ý món (Collaborative Filtering)
│   │   └── user_restaurant_graph.js ← Demo 7: Phân tích Graph
│   └── cassandra/
│       └── order_log.js        ← Demo 8: Order Log & Behavior
│
├── benchmark/
│   └── run_benchmark.js        ← So sánh hiệu năng các CSDL
│
└── scripts/
    └── wait-for-services.sh    ← Chờ services khởi động
```

---

## 🚀 Hướng dẫn cài đặt & chạy

### Bước 1 – Yêu cầu

| Công cụ | Phiên bản |
|---|---|
| Node.js | ≥ 18 |
| Docker & Docker Compose | ≥ 24 |
| npm | ≥ 9 |

### Bước 2 – Khởi động các CSDL

```bash
# Clone hoặc giải nén project
cd food-delivery-nosql

# Cài dependencies
npm install

# Khởi động MongoDB, Redis, Neo4j, Cassandra
docker-compose up -d

# Kiểm tra trạng thái (chờ tất cả Healthy)
docker-compose ps
```

> ⚠️ **Lưu ý:** Cassandra cần ~60 giây để khởi động hoàn toàn.
> Chờ `food_cassandra` status `healthy` rồi mới chạy seed.

### Bước 3 – Seed dữ liệu

```bash
# Seed MongoDB trước (Neo4j và Cassandra đọc từ MongoDB)
npm run seed:mongo

# Sau khi MongoDB xong, seed Neo4j và Cassandra
npm run seed:neo4j
npm run seed:cassandra

# Hoặc chạy tất cả tuần tự
npm run seed:all
```

**Dữ liệu được sinh ra:**

| Collection/Table | Số lượng |
|---|---|
| MongoDB customers | 200 |
| MongoDB restaurants | 15 (với đầy đủ menu) |
| MongoDB orders | 5,000 |
| MongoDB reviews | ~2,500 |
| Neo4j nodes (Customer + Restaurant + MenuItem) | ~350 |
| Neo4j relationships | ~20,000+ |
| Cassandra order_status_log | ~15,000 events |
| Cassandra user_behavior_log | ~5,000–10,000 events |

### Bước 4 – Chạy Demo

```bash
# Menu tương tác (khuyến nghị)
node index.js

# Hoặc chạy từng demo riêng lẻ:
npm run demo:order-history   # Lịch sử đơn hàng
npm run demo:top-items       # Thống kê bán chạy
npm run demo:restaurant      # Tìm kiếm nhà hàng
npm run demo:cart            # Giỏ hàng Redis
npm run demo:session         # Leaderboard & Pub/Sub
npm run demo:recommend       # Gợi ý món (Neo4j)
npm run demo:graph           # Phân tích Graph
npm run demo:cassandra       # Order Log Cassandra
npm run benchmark            # Benchmark so sánh
```

---

## 🗃️ Mô hình dữ liệu

### MongoDB – Document Schema

#### Customer
```json
{
  "_id": "ObjectId",
  "customer_code": "CUST_00001",
  "name": "Nguyễn Văn A",
  "phone": "0901234567",
  "email": "user1@email.com",
  "addresses": [
    {
      "label": "Nhà",
      "street": "123 Lê Lợi",
      "district": "Quận 1",
      "city": "TP.HCM",
      "coordinates": { "lat": 10.7769, "lng": 106.7009 },
      "is_default": true
    }
  ],
  "preferences": {
    "favorite_categories": ["Phở", "Cơm"],
    "dietary": "none"
  },
  "status": "active",
  "created_at": "ISODate"
}
```

#### Restaurant (kèm Menu nhúng)
```json
{
  "_id": "ObjectId",
  "name": "Phở Hà Nội Ngon",
  "categories": ["Phở", "Bún"],
  "address": {
    "street": "...",
    "district": "Quận 1",
    "coordinates": { "lat": 10.77, "lng": 106.70 }
  },
  "rating": 4.5,
  "is_open": true,
  "menu": [
    {
      "item_id": "item_0001_r0",
      "name": "Phở Bò Tái",
      "price": 65000,
      "category": "Phở",
      "status": "available"
    }
  ],
  "estimated_delivery_min": 25
}
```

#### Order (nhúng items + status_history + payment)
```json
{
  "_id": "ObjectId",
  "order_code": "ORD_0000001",
  "customer_id": "ObjectId",
  "restaurant_id": "ObjectId",
  "items": [
    { "item_id": "...", "name": "Phở Bò Tái", "price": 65000, "qty": 2, "subtotal": 130000 }
  ],
  "status": "delivered",
  "status_history": [
    { "status": "placed",    "timestamp": "ISODate" },
    { "status": "confirmed", "timestamp": "ISODate" },
    { "status": "delivered", "timestamp": "ISODate" }
  ],
  "payment": {
    "method": "momo",
    "amount": 145000,
    "status": "paid",
    "transaction_id": "TXN_ABC123"
  },
  "subtotal": 130000,
  "delivery_fee": 15000,
  "total": 145000,
  "created_at": "ISODate"
}
```

---

### Neo4j – Graph Schema

```
(:Customer)-[:ORDERED {count, last_at}]->(:MenuItem)
(:Customer)-[:VISITED {times, total_spent}]->(:Restaurant)
(:Customer)-[:RATED   {rating, comment}]->(:Restaurant)
(:MenuItem)-[:BELONGS_TO]->(:Restaurant)
```

**Cypher queries mẫu:**
```cypher
-- Gợi ý món chưa thử
MATCH (me:Customer {id: $id})-[:ORDERED]->(i:MenuItem)
WITH me, collect(i.id) AS tried
MATCH (me)-[:ORDERED]->(:MenuItem)<-[:ORDERED]-(sim:Customer)
MATCH (sim)-[o:ORDERED]->(rec:MenuItem)
WHERE NOT rec.id IN tried
RETURN rec.name, sum(o.count) AS score ORDER BY score DESC LIMIT 5

-- Users ghé cùng nhà hàng
MATCH (c1:Customer)-[:VISITED]->(r:Restaurant)<-[:VISITED]-(c2:Customer)
WHERE c1.id <> c2.id
RETURN c1.name, c2.name, r.name
```

---

### Cassandra – Table Schema

```sql
-- Order status events (time-series)
CREATE TABLE order_status_log (
  order_id    TEXT,
  event_time  TIMESTAMP,
  status      TEXT,
  note        TEXT,
  actor       TEXT,
  actor_id    TEXT,
  PRIMARY KEY (order_id, event_time)
) WITH CLUSTERING ORDER BY (event_time ASC);

-- User behavior log
CREATE TABLE user_behavior_log (
  customer_id TEXT,
  event_time  TIMESTAMP,
  event_type  TEXT,   -- view_restaurant, view_item, add_to_cart, ...
  item_id     TEXT,
  item_name   TEXT,
  platform    TEXT,   -- ios, android, web
  PRIMARY KEY (customer_id, event_time)
) WITH CLUSTERING ORDER BY (event_time DESC);

-- Daily revenue per restaurant
CREATE TABLE restaurant_revenue_daily (
  restaurant_id   TEXT,
  date            DATE,
  total_orders    INT,
  total_revenue   BIGINT,
  avg_order_value DOUBLE,
  PRIMARY KEY (restaurant_id, date)
) WITH CLUSTERING ORDER BY (date DESC);
```

---

### Redis – Key Conventions

| Pattern | Kiểu | TTL | Mục đích |
|---|---|---|---|
| `cart:{userId}` | String (JSON) | 2h | Giỏ hàng tạm |
| `session:{sessionId}` | String (JSON) | 24h | Session user |
| `otp:{phone}` | String (JSON) | 5m | Xác thực OTP |
| `rl:{identifier}` | String (counter) | 1m | Rate limiting |
| `menu:{restaurantId}` | String (JSON) | 30m | Cache menu |
| `top_restaurants` | String (JSON) | 5m | Cache top nhà hàng |
| `leaderboard:restaurants` | Sorted Set | ∞ | Xếp hạng theo điểm |
| `restaurant:names` | Hash | ∞ | Tên nhà hàng |
| `views:unique:{restId}` | HyperLogLog | ∞ | Đếm unique viewers |

---

## 📊 Phân tích lựa chọn NoSQL

### Tại sao dùng kết hợp (Polyglot Persistence)?

```
┌──────────────────┬─────────────────────────────────────────────┐
│   CSDL           │ Dùng cho                                    │
├──────────────────┼─────────────────────────────────────────────┤
│ MongoDB          │ Customer, Restaurant+Menu, Order, Review    │
│                  │ → Schema linh hoạt, aggregation mạnh        │
├──────────────────┼─────────────────────────────────────────────┤
│ Redis            │ Cart, Session, OTP, Cache, Rate Limit       │
│                  │ → Tốc độ < 1ms, TTL tự động                 │
├──────────────────┼─────────────────────────────────────────────┤
│ Neo4j            │ Gợi ý món, phân tích quan hệ User–Restaurant│
│                  │ → Graph traversal, Collaborative Filtering  │
├──────────────────┼─────────────────────────────────────────────┤
│ Cassandra        │ Order status log, User behavior (time-series│
│                  │ → Write-heavy, append-only, scale tốt       │
└──────────────────┴─────────────────────────────────────────────┘
```

### Bảng so sánh ưu–nhược điểm

| Tiêu chí | MongoDB | Redis | Cassandra | Neo4j |
|---|---|---|---|---|
| Mô hình dữ liệu | Document | Key-Value | Wide-column | Graph |
| Tốc độ đọc | Nhanh | Cực nhanh | Nhanh | Trung bình |
| Tốc độ ghi | Nhanh | Cực nhanh | Rất nhanh | Trung bình |
| Query phức tạp | Tốt | Hạn chế | Hạn chế | Rất tốt |
| Scale ngang | Tốt | Tốt | Rất tốt | Hạn chế |
| Schema linh hoạt | Rất tốt | N/A | Khá | Tốt |
| Persistence | Có | Tuỳ chọn | Có | Có |
| Phù hợp với | CRUD, Agg | Cache, RT | Time-series | Relationship |

---

## 🔗 Truy cập giao diện

Sau khi chạy `docker-compose up -d`:

| Service | URL | Thông tin đăng nhập |
|---|---|---|
| **Neo4j Browser** | http://localhost:7474 | neo4j / password123 |
| **MongoDB** | mongodb://localhost:27017 | (không cần auth) |
| **Redis** | localhost:6379 | (không cần auth) |
| **Cassandra** | localhost:9042 | (không cần auth) |

**Kết nối MongoDB Compass:**
```
mongodb://localhost:27017/food_delivery
```

**Neo4j Browser – Cypher nhanh:**
```cypher
MATCH (c:Customer)-[:ORDERED]->(i:MenuItem) RETURN c, i LIMIT 25
```

---

## 🧩 Phân công demo (gợi ý nhóm 4 SV)

| Thành viên | Demo | Script |
|---|---|---|
| SV 1 | MongoDB: Lịch sử đơn + Thống kê + Tìm nhà hàng | `src/mongo/` |
| SV 2 | Redis: Giỏ hàng + Session + Leaderboard + Pub/Sub | `src/redis/` |
| SV 3 | Neo4j: Gợi ý món + Phân tích Graph | `src/neo4j/` |
| SV 4 | Cassandra: Order Log + Benchmark | `src/cassandra/` + `benchmark/` |

---

## ❓ Troubleshooting

**Cassandra chưa sẵn sàng:**
```bash
docker logs food_cassandra | tail -20
# Chờ xuất hiện "Starting listening for CQL clients"
```

**Neo4j seed chậm:**
```bash
# Neo4j cần seed MongoDB xong trước
npm run seed:mongo && npm run seed:neo4j
```

**Lỗi kết nối Redis `ECONNREFUSED`:**
```bash
docker-compose restart redis
```

**Xóa toàn bộ dữ liệu và bắt đầu lại:**
```bash
docker-compose down -v   # Xóa cả volumes
docker-compose up -d
npm run seed:all
```
