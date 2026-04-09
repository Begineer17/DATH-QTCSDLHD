# Sample Queries – Tài liệu tham khảo

## MongoDB Queries

### Lịch sử đơn hàng của user
```javascript
db.orders.find(
  { customer_id: ObjectId("..."), status: "delivered" },
  { order_code:1, restaurant_name:1, items:1, total:1, created_at:1 }
).sort({ created_at: -1 }).limit(10)
```

### Top 10 món bán chạy trong tháng
```javascript
db.orders.aggregate([
  { $match: {
    status: "delivered",
    created_at: { $gte: ISODate("2025-01-01"), $lt: ISODate("2025-02-01") }
  }},
  { $unwind: "$items" },
  { $group: {
    _id: "$items.item_id",
    name: { $first: "$items.name" },
    total_sold: { $sum: "$items.qty" },
    revenue: { $sum: { $multiply: ["$items.price", "$items.qty"] } }
  }},
  { $sort: { total_sold: -1 } },
  { $limit: 10 }
])
```

### Doanh thu theo tháng của nhà hàng
```javascript
db.orders.aggregate([
  { $match: { restaurant_id: ObjectId("..."), status: "delivered" }},
  { $group: {
    _id: { year: { $year: "$created_at" }, month: { $month: "$created_at" }},
    total_orders: { $sum: 1 },
    total_revenue: { $sum: "$total" }
  }},
  { $sort: { "_id.year": 1, "_id.month": 1 }}
])
```

### Tìm nhà hàng gần vị trí (Geospatial)
```javascript
db.restaurants.find({
  is_open: true,
  "address.coordinates": {
    $near: {
      $geometry: { type: "Point", coordinates: [106.70, 10.78] },
      $maxDistance: 3000   // 3km
    }
  }
}).limit(10)
```

### Thống kê đánh giá theo nhà hàng
```javascript
db.reviews.aggregate([
  { $match: { restaurant_id: ObjectId("...") }},
  { $group: {
    _id: null,
    avg_overall: { $avg: "$rating_overall" },
    avg_food: { $avg: "$rating_food" },
    avg_delivery: { $avg: "$rating_delivery" },
    total: { $sum: 1 }
  }}
])
```

---

## Neo4j Cypher Queries

### Gợi ý món (Collaborative Filtering)
```cypher
MATCH (me:Customer {id: $customerId})-[:ORDERED]->(item:MenuItem)
WITH me, collect(item.id) AS myItems

MATCH (me)-[:ORDERED]->(:MenuItem)<-[:ORDERED]-(similar:Customer)
WHERE similar.id <> $customerId
WITH me, myItems, similar, count(*) AS commonItems
ORDER BY commonItems DESC LIMIT 15

MATCH (similar)-[o:ORDERED]->(rec:MenuItem)
WHERE NOT rec.id IN myItems
WITH rec, sum(o.count) AS score
RETURN rec.name, rec.price, rec.category, score
ORDER BY score DESC LIMIT 8
```

### Nhà hàng phổ biến nhất
```cypher
MATCH (c:Customer)-[v:VISITED]->(r:Restaurant)
WITH r, count(distinct c) AS uniqueVisitors, sum(v.times) AS totalVisits
RETURN r.name, r.rating, uniqueVisitors, totalVisits
ORDER BY uniqueVisitors DESC LIMIT 10
```

### Tìm kết nối giữa 2 user qua nhà hàng
```cypher
MATCH path = shortestPath(
  (u1:Customer {id: $userId1})-[*..6]-(u2:Customer {id: $userId2})
)
RETURN [n IN nodes(path) | coalesce(n.name, n.id)] AS path, length(path)
```

### Users đã ghé cả 2 nhà hàng
```cypher
MATCH (r1:Restaurant {name: "Phở Hà Nội Ngon"})<-[:VISITED]-(c:Customer)
      -[:VISITED]->(r2:Restaurant {name: "Cơm Tấm Sài Gòn"})
RETURN c.name, c.district
```

### Món "viral" – nhiều user đặt nhất
```cypher
MATCH (c:Customer)-[o:ORDERED]->(i:MenuItem)-[:BELONGS_TO]->(r:Restaurant)
WITH i, r, count(distinct c) AS uniqueUsers, sum(o.count) AS totalOrders
RETURN i.name, r.name, i.category, uniqueUsers, totalOrders
ORDER BY uniqueUsers DESC LIMIT 10
```

---

## Cassandra CQL Queries

### Lịch sử trạng thái đơn hàng
```sql
SELECT order_id, event_time, status, actor, note
FROM order_status_log
WHERE order_id = 'abc123'
ORDER BY event_time ASC;
```

### Hành vi user trong 7 ngày
```sql
SELECT customer_id, event_time, event_type, item_name, platform
FROM user_behavior_log
WHERE customer_id = 'user_001'
  AND event_time >= '2025-01-01 00:00:00'
  AND event_time <= '2025-01-07 23:59:59'
ORDER BY event_time DESC
LIMIT 100;
```

### Doanh thu nhà hàng theo ngày
```sql
SELECT date, total_orders, total_revenue, avg_order_value
FROM restaurant_revenue_daily
WHERE restaurant_id = 'rest_001'
  AND date >= '2025-01-01'
  AND date <= '2025-01-31'
ORDER BY date DESC;
```

---

## Redis Commands

### Giỏ hàng
```bash
# Lưu giỏ hàng (TTL 2h)
SET cart:user_001 '{"items":[...],"total":145000}' EX 7200

# Đọc giỏ hàng
GET cart:user_001

# Kiểm tra TTL còn lại
TTL cart:user_001

# Xóa giỏ hàng sau khi đặt đơn
DEL cart:user_001
```

### Leaderboard
```bash
# Thêm/cập nhật điểm
ZADD leaderboard:restaurants 4.8 rest_001
ZADD leaderboard:restaurants 4.5 rest_002

# Top 10 nhà hàng (score cao nhất)
ZREVRANGE leaderboard:restaurants 0 9 WITHSCORES

# Xếp hạng của nhà hàng cụ thể
ZREVRANK leaderboard:restaurants rest_001

# Tăng điểm
ZINCRBY leaderboard:restaurants 0.1 rest_001
```

### HyperLogLog – Unique viewers
```bash
# Ghi nhận 1 unique view
PFADD views:unique:rest_001 user_123
PFADD views:unique:rest_001 user_456
PFADD views:unique:rest_001 user_123   # trùng, không đếm

# Đếm unique viewers
PFCOUNT views:unique:rest_001   # → 2
```

### Rate Limiting
```bash
# Tăng counter + set TTL (nếu là lần đầu)
INCR rl:api:user_001
EXPIRE rl:api:user_001 60

# Kiểm tra hiện tại
GET rl:api:user_001
TTL rl:api:user_001
```
