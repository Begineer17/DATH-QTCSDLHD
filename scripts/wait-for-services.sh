#!/bin/bash
# Chờ tất cả services khởi động trước khi chạy seed

echo "⏳ Đang chờ MongoDB..."
until mongosh --quiet --eval "db.runCommand({ping:1})" mongodb://localhost:27017/test &>/dev/null; do
  sleep 2; echo "  Chờ MongoDB...";
done
echo "✅ MongoDB sẵn sàng"

echo "⏳ Đang chờ Redis..."
until redis-cli ping &>/dev/null; do
  sleep 2; echo "  Chờ Redis...";
done
echo "✅ Redis sẵn sàng"

echo "⏳ Đang chờ Neo4j..."
until curl -s http://localhost:7474 &>/dev/null; do
  sleep 3; echo "  Chờ Neo4j...";
done
echo "✅ Neo4j sẵn sàng"

echo "⏳ Đang chờ Cassandra..."
until docker exec food_cassandra cqlsh -e "describe keyspaces" &>/dev/null; do
  sleep 5; echo "  Chờ Cassandra (có thể mất ~60s)...";
done
echo "✅ Cassandra sẵn sàng"

echo ""
echo "🎉 Tất cả services đã sẵn sàng! Chạy: npm run seed:all"
