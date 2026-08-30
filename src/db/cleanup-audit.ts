import { AuditService } from "../audit/service.js";
import { loadOperationalConfig } from "../config.js";
import { createLogger } from "../observability/logger.js";
import { createDatabase } from "./client.js";

const config = loadOperationalConfig();
const logger = createLogger(config);
const { db, close } = createDatabase(config.DATABASE_URL, 1);

try {
  const deleted = await new AuditService(db, logger).cleanup(config.AUDIT_RETENTION_YEARS);
  logger.info({ deletedAuditRecords: deleted }, "Manual audit cleanup finished");
} catch (error) {
  logger.fatal({ err: error }, "Manual audit cleanup failed");
  process.exitCode = 1;
} finally {
  await close();
  logger.flush();
}
