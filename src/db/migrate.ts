import path from "node:path";

import "dotenv/config";

import { createDatabase } from "./client.js";
import { migrateDatabase } from "./migrations.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to run migrations");
}

const { db, close } = createDatabase(databaseUrl, 1);

try {
  await migrateDatabase(db, path.resolve(process.cwd(), "drizzle"));
  console.info("Database migrations completed");
} finally {
  await close();
}
