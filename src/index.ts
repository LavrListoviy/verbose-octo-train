import { API_CONSTANTS } from "grammy";

import { AuditRetentionWorker, AuditService } from "./audit/service.js";
import { createBot } from "./bot.js";
import { loadConfig } from "./config.js";
import { createDatabase } from "./db/client.js";
import { createLogger } from "./observability/logger.js";
import { RegistrationRepository } from "./registration/repository.js";
import { NominatimGeocoder } from "./registration/geocoder.js";

const config = loadConfig();
const logger = createLogger(config);
const { db, close } = createDatabase(config.DATABASE_URL);
const geocoder = new NominatimGeocoder({
  baseUrl: config.NOMINATIM_BASE_URL,
  userAgent: "telegram-account-bot/0.1 (+https://github.com/LavrListoviy/verbose-octo-train)",
});
const audit = new AuditService(db, logger);
const retention = new AuditRetentionWorker(audit, config.AUDIT_RETENTION_YEARS, logger);
const bot = createBot(config.BOT_TOKEN, new RegistrationRepository(db, logger), audit, logger, geocoder);
let shuttingDown = false;

const shutdown = async (reason: string, error?: unknown) => {
  if (shuttingDown) return;
  shuttingDown = true;
  const exitCode = error === undefined ? 0 : 1;

  if (error === undefined) {
    logger.info({ reason }, "Stopping application");
  } else {
    logger.fatal({ err: error, reason }, "Application is stopping after a fatal error");
  }

  await retention.stop();
  try {
    await bot.stop();
  } catch (shutdownError) {
    logger.error({ err: shutdownError }, "Telegram bot shutdown failed");
  }
  try {
    await close();
  } catch (shutdownError) {
    logger.error({ err: shutdownError }, "Database shutdown failed");
  }
  logger.flush();
  process.exit(exitCode);
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("uncaughtException", (error) => void shutdown("uncaughtException", error));
process.once("unhandledRejection", (error) => void shutdown("unhandledRejection", error));

await retention.start();
logger.info(
  { auditRetentionYears: config.AUDIT_RETENTION_YEARS },
  "Starting Telegram bot",
);
await bot.start({
  allowed_updates: API_CONSTANTS.ALL_UPDATE_TYPES,
  onStart: (botInfo) => logger.info({ botUsername: botInfo.username }, "Telegram bot is running"),
});
