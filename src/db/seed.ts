import { loadDatabaseConfig } from "../config.js";
import { createDatabase } from "./client.js";
import { seedDatabase } from "./seeder.js";

const config = loadDatabaseConfig();
const { db, close } = createDatabase(config.DATABASE_URL, 1);

try {
  await seedDatabase(db, config.ADMIN_TELEGRAM_ID);
  console.info(`Database seed completed for administrator ${config.ADMIN_TELEGRAM_ID}`);
} finally {
  await close();
}
