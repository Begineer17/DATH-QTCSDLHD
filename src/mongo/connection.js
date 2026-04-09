require("dotenv").config();
const { MongoClient } = require("mongodb");

let client;
let db;

async function connect() {
  if (db) return db;
  client = new MongoClient(process.env.MONGO_URI || "mongodb://localhost:27017");
  await client.connect();
  db = client.db(process.env.MONGO_DB || "food_delivery");
  return db;
}

async function close() {
  if (client) await client.close();
}

module.exports = { connect, close };
