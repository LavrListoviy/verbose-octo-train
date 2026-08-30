import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import type { Logger } from "pino";

import type { Database } from "../db/client.js";
import { auditLogs } from "../db/schema.js";
import { getRequestContext } from "../observability/context.js";
import { requestLogger } from "../observability/logger.js";
import { createDiff } from "./diff.js";
import { getRetentionCutoff } from "./retention.js";

export interface AuditEvent {
  action: string;
  entityType: string;
  entityId?: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
}

export function createAuditRow(event: AuditEvent) {
  const context = getRequestContext();
  const before = event.before ?? null;
  const after = event.after ?? null;

  return {
    correlationId: context?.correlationId ?? randomUUID(),
    telegramUpdateId: context?.telegramUpdateId ?? null,
    actorTelegramId: context?.actorTelegramId ?? null,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId ?? null,
    before,
    after,
    diff: createDiff(before, after),
    metadata: event.metadata ?? null,
  };
}

export class AuditService {
  public constructor(
    private readonly db: Database,
    private readonly logger: Logger,
  ) {}

  public async record(event: AuditEvent): Promise<void> {
    await this.db.insert(auditLogs).values(createAuditRow(event));
  }

  public async cleanup(retentionYears: number, now = new Date()): Promise<number> {
    const cutoff = getRetentionCutoff(retentionYears, now);
    let total = 0;

    while (true) {
      const deleted = await this.db.execute<{ id: string }>(sql`
        WITH expired AS (
          SELECT ${auditLogs.id}
          FROM ${auditLogs}
          WHERE ${auditLogs.occurredAt} < ${cutoff.toISOString()}::timestamptz
          ORDER BY ${auditLogs.occurredAt}
          LIMIT 10000
        )
        DELETE FROM ${auditLogs}
        USING expired
        WHERE ${auditLogs.id} = expired.id
        RETURNING ${auditLogs.id}
      `);
      total += deleted.length;
      if (deleted.length < 10000) break;
    }

    requestLogger(this.logger).info(
      { deletedAuditRecords: total, cutoff: cutoff.toISOString() },
      "Audit retention cleanup completed",
    );
    return total;
  }
}

export class AuditRetentionWorker {
  private timer?: NodeJS.Timeout;
  private currentRun: Promise<void> = Promise.resolve();

  public constructor(
    private readonly audit: AuditService,
    private readonly retentionYears: number,
    private readonly logger: Logger,
  ) {}

  public async start(): Promise<void> {
    this.enqueue();
    await this.currentRun;
    this.timer = setInterval(() => this.enqueue(), 24 * 60 * 60 * 1000);
    this.timer.unref();
  }

  public async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.currentRun;
  }

  private enqueue(): void {
    this.currentRun = this.currentRun.then(() => this.run());
  }

  private async run(): Promise<void> {
    try {
      await this.audit.cleanup(this.retentionYears);
    } catch (error) {
      this.logger.error({ err: error }, "Audit retention cleanup failed");
    }
  }
}
