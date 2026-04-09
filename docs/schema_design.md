# Tài liệu Thiết kế CSDL – Food Delivery NoSQL

## 1. Quy trình nghiệp vụ

### 1.1 Đặt món – Thanh toán – Giao hàng

```
Customer          App (API)           Restaurant           Driver
   │                 │                     │                  │
   │─── Xem menu ───▶│                     │                  │
   │◀── Danh sách ───│  [Cache Redis 30m]  │                  │
   │                 │                     │                  │
   │─── Thêm giỏ ───▶│  [Redis cart TTL2h] │                  │
   │─── Đặt đơn ────▶│                     │                  │
   │                 │─── Tạo Order ──────▶│  [MongoDB write] │
   │                 │  status: "placed"   │                  │
   │                 │─── Notify ─────────▶│  [Redis Pub/Sub] │
   │                 │                     │─── Xác nhận ────▶│
   │                 │◀── "confirmed" ─────│  [Cass. log]     │
   │◀── Thông báo ───│                     │─── Chuẩn bị ──▶  │
   │                 │◀────────────── "picked_up" ────────────│
   │◀── Đang giao ───│                     │                  │
   │                 │◀────────────── "delivered" ────────────│
   │◀── Hoàn tất ────│                     │                  │
   │─── Review ─────▶│  [MongoDB write]    │                  │
```

### 1.2 Luồng dữ liệu qua các CSDL

```
Request đặt đơn:
  1. Kiểm tra cart → Redis (GET cart:{userId})
  2. Kiểm tra session → Redis (GET session:{sessionId})
  3. Đọc thông tin nhà hàng → MongoDB (findOne restaurants)
  4. Tạo đơn hàng → MongoDB (insertOne orders)
  5. Ghi log trạng thái → Cassandra (INSERT order_status_log)
  6. Notify realtime → Redis Pub/Sub
  7. Xóa cart → Redis (DEL cart:{userId})

Request gợi ý món:
  1. Kiểm tra cache → Redis (GET recommend:{userId})
  2. Cache miss → Neo4j (Collaborative Filtering query)
  3. Lưu cache → Redis (SETEX recommend:{userId} 1800)
  4. Trả kết quả
```

---

## 2. Thiết kế MongoDB

### 2.1 Lý do nhúng (Embed) vs Tham chiếu (Reference)

| Quyết định | Lý do |
|---|---|
| **Nhúng menu vào Restaurant** | Menu luôn được đọc cùng nhà hàng; ít khi update độc lập |
| **Nhúng items vào Order** | Giá tại thời điểm đặt có thể thay đổi → cần snapshot |
| **Nhúng status_history vào Order** | Luôn đọc cùng đơn hàng; ít records (≤ 6 trạng thái) |
| **Nhúng payment vào Order** | 1-1 relationship, luôn truy vấn cùng nhau |
| **Reference customer_id, restaurant_id trong Order** | Dữ liệu lớn, cần query độc lập |

### 2.2 Indexes và lý do

```javascript
// Tìm nhà hàng gần vị trí → Geospatial query
{ "address.coordinates": "2dsphere" }

// Lịch sử đơn hàng của user, sắp xếp mới nhất → phân trang hiệu quả
{ customer_id: 1, created_at: -1 }

// Dashboard nhà hàng + filter theo status
{ restaurant_id: 1, created_at: -1, status: 1 }

// Thống kê tổng hợp theo ngày
{ created_at: -1 }

// Tìm nhà hàng đang mở, sort theo rating
{ is_open: 1, rating: -1 }
```

---

## 3. Thiết kế Cassandra

### 3.1 Access Pattern trước, schema sau

**Query 1:** Lấy toàn bộ lịch sử trạng thái 1 đơn hàng
```sql
SELECT * FROM order_status_log WHERE order_id = ? ORDER BY event_time ASC
-- → Partition key: order_id; Clustering key: event_time ASC
```

**Query 2:** Hành vi user trong khoảng thời gian
```sql
SELECT * FROM user_behavior_log WHERE customer_id = ?
  AND event_time >= ? AND event_time <= ?
-- → Partition key: customer_id; Clustering key: event_time DESC (mới nhất trước)
```

**Query 3:** Doanh thu nhà hàng theo ngày
```sql
SELECT * FROM restaurant_revenue_daily WHERE restaurant_id = ?
  AND date >= ? AND date <= ?
-- → Partition key: restaurant_id; Clustering key: date DESC
```

### 3.2 Tại sao KHÔNG dùng Cassandra cho tất cả?

- Cassandra không hỗ trợ JOIN, GROUP BY linh hoạt
- Query phải biết trước partition key (không thể query tự do như MongoDB)
- Không phù hợp cho dữ liệu cần update nhiều (order details)
- → Chỉ dùng cho **write-heavy, append-only, time-series**

---

## 4. Thiết kế Neo4j

### 4.1 Thuật toán gợi ý (Collaborative Filtering)

```
Bước 1: Tìm món user A đã đặt
  (A)-[:ORDERED]->(item)

Bước 2: Tìm users B có hành vi tương tự
  (A)-[:ORDERED]->(item)<-[:ORDERED]-(B)
  → đếm số món chung, lấy top 15 users tương tự

Bước 3: Lấy món mà B đã đặt, A chưa thử
  (B)-[:ORDERED]->(rec) WHERE rec NOT IN A's items

Bước 4: Score = tổng lượt đặt × category_boost
  category_boost = 1.5 nếu cùng danh mục yêu thích, else 1.0

Bước 5: Sort by score DESC, limit N
```

### 4.2 Tại sao Graph DB cho recommendation?

Trong SQL:
```sql
-- Cần 3-4 JOIN phức tạp, chậm khi scale
SELECT rec.name, COUNT(*) AS score
FROM orders o1
JOIN order_items oi1 ON o1.id = oi1.order_id
JOIN order_items oi2 ON oi1.item_id = oi2.item_id
JOIN orders o2 ON oi2.order_id = o2.id AND o2.customer_id != o1.customer_id
JOIN order_items oi3 ON o2.id = oi3.order_id
WHERE o1.customer_id = ? AND oi3.item_id NOT IN (...)
GROUP BY rec.name ORDER BY score DESC
```

Trong Neo4j:
```cypher
-- Tự nhiên, đọc hiểu dễ, traverse graph nhanh
MATCH (me)-[:ORDERED]->(i)<-[:ORDERED]-(sim)-[:ORDERED]->(rec)
WHERE NOT (me)-[:ORDERED]->(rec)
RETURN rec.name, count(*) AS score ORDER BY score DESC
```

---

## 5. Thiết kế Redis

### 5.1 Chiến lược Cache (Cache-Aside Pattern)

```
Client request:
  1. Check Redis cache
  2. HIT  → return cached data (microseconds)
  3. MISS → query MongoDB → cache result → return data

TTL strategy:
  - Menu nhà hàng: 30 phút (ít thay đổi)
  - Top restaurants: 5 phút (cập nhật thường xuyên hơn)
  - Cart: 2 giờ (user activity session)
  - Session: 24 giờ
  - OTP: 5 phút (security)
  - Rate limit: 1 phút (sliding window)
```

### 5.2 Các cấu trúc dữ liệu Redis sử dụng

| Structure | Use case | Command |
|---|---|---|
| **String** | Cart, Session, OTP, Cache | GET/SET/SETEX |
| **Sorted Set** | Leaderboard nhà hàng | ZADD/ZRANGE/ZREVRANK |
| **Hash** | Mapping id → name | HSET/HGET/HGETALL |
| **HyperLogLog** | Unique viewers | PFADD/PFCOUNT |
| **Pub/Sub** | Realtime order updates | PUBLISH/SUBSCRIBE |
| **Counter** | Rate limiting | INCR/EXPIRE |
