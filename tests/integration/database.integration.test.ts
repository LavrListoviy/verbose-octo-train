import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";
import { asc, eq, sql } from "drizzle-orm";
import pino from "pino";

import { AuditService } from "../../src/audit/service.js";
import { createDatabase, type Database } from "../../src/db/client.js";
import { migrateDatabase } from "../../src/db/migrations.js";
import {
  auditLogs,
  permissions,
  rolePermissions,
  roles,
  userRoles,
  users,
} from "../../src/db/schema.js";
import { seedDatabase } from "../../src/db/seeder.js";
import { runWithRequestContext } from "../../src/observability/context.js";
import { RegistrationRepository } from "../../src/registration/repository.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required for integration tests");

const adminTelegramId = 120484366n;
const logger = pino({ level: "silent" });
let db: Database;
let closeDatabase: () => Promise<void>;

beforeAll(async () => {
  const connection = createDatabase(databaseUrl, 2);
  db = connection.db;
  closeDatabase = connection.close;
  await migrateDatabase(db, path.resolve(process.cwd(), "drizzle"));
});

beforeEach(async () => {
  await db.execute(sql`
    TRUNCATE TABLE
      audit_logs,
      registration_drafts,
      role_permissions,
      user_roles,
      permissions,
      roles,
      users
    RESTART IDENTITY CASCADE
  `);
});

afterAll(async () => {
  await closeDatabase();
});

describe("database migrations", () => {
  it("create the expected tables and can be applied repeatedly", async () => {
    await migrateDatabase(db, path.resolve(process.cwd(), "drizzle"));
    const result = await db.execute<{ table_name: string }>(sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('users', 'roles', 'permissions', 'registration_drafts', 'audit_logs')
      ORDER BY table_name
    `);

    expect(result.map((row) => row.table_name)).toEqual([
      "audit_logs",
      "permissions",
      "registration_drafts",
      "roles",
      "users",
    ]);
  });
});

describe("database seed", () => {
  it("is idempotent and preserves an existing administrator profile", async () => {
    await seedDatabase(db, adminTelegramId);
    await db
      .update(users)
      .set({ displayName: "Existing administrator" })
      .where(eq(users.telegramId, adminTelegramId));
    await seedDatabase(db, adminTelegramId);

    expect(await db.select().from(roles)).toHaveLength(2);
    expect(await db.select().from(permissions)).toHaveLength(4);
    expect(await db.select().from(rolePermissions)).toHaveLength(6);
    expect(await db.select().from(userRoles)).toHaveLength(1);

    const admin = await db.query.users.findFirst({
      where: eq(users.telegramId, adminTelegramId),
    });
    expect(admin).toMatchObject({
      telegramId: adminTelegramId,
      displayName: "Existing administrator",
      status: "pending",
    });

    const [assignedRole] = await db
      .select({ code: roles.code })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id));
    expect(assignedRole?.code).toBe("super_admin");
  });
});

describe("audit retention", () => {
  it("deletes only records older than three full calendar years", async () => {
    const now = new Date("2026-08-11T12:00:00.000Z");
    await db.insert(auditLogs).values([
      auditEvent("expired", new Date("2023-08-11T11:59:59.999Z")),
      auditEvent("boundary", new Date("2023-08-11T12:00:00.000Z")),
      auditEvent("fresh", new Date("2026-08-11T11:00:00.000Z")),
    ]);

    const deleted = await new AuditService(db, logger).cleanup(3, now);
    const remaining = await db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .orderBy(asc(auditLogs.occurredAt));

    expect(deleted).toBe(1);
    expect(remaining.map((row) => row.action)).toEqual(["boundary", "fresh"]);
  });
});

describe("registration transactions", () => {
  it("persists the account, role and complete audit history atomically", async () => {
    await seedDatabase(db, adminTelegramId);
    const telegramId = 99887766n;
    const repository = new RegistrationRepository(db, logger);

    await runWithRequestContext(
      {
        correlationId: "3455d17f-35a5-4f75-938b-1cc7ec96309a",
        telegramUpdateId: 700n,
        actorTelegramId: telegramId,
      },
      async () => {
        let draft = await repository.start(telegramId);
        draft = await repository.update(telegramId, {
          displayName: "Integration User",
          step: "birth_date",
        });
        draft = await repository.update(telegramId, {
          birthDate: "2000-01-02",
          bio: "Database-backed profile",
          city: "Moscow",
          country: "Russia",
          step: "confirmation",
        });
        await repository.complete({ id: telegramId, username: "integration_user" }, draft);
      },
    );

    const user = await db.query.users.findFirst({ where: eq(users.telegramId, telegramId) });
    expect(user).toMatchObject({
      displayName: "Integration User",
      birthDate: "2000-01-02",
      status: "active",
    });

    const [assignedRole] = await db
      .select({ code: roles.code })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(userRoles.userId, user!.id));
    expect(assignedRole?.code).toBe("user");

    const events = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.actorTelegramId, telegramId))
      .orderBy(asc(auditLogs.occurredAt));
    expect(events.map((event) => event.action)).toEqual([
      "registration.started",
      "registration.updated",
      "registration.updated",
      "account.created",
    ]);
    expect(events.every((event) => event.correlationId === "3455d17f-35a5-4f75-938b-1cc7ec96309a")).toBe(true);
    expect(events[1]?.diff).toMatchObject({
      displayName: { before: null, after: "Integration User" },
      step: { before: "display_name", after: "birth_date" },
    });
  });

  it("rolls back profile state when its audit record cannot be inserted", async () => {
    const telegramId = 11223344n;
    const repository = new RegistrationRepository(db, logger);

    await expect(
      runWithRequestContext(
        { correlationId: "not-a-uuid", actorTelegramId: telegramId },
        () => repository.start(telegramId),
      ),
    ).rejects.toThrow();

    expect(await repository.getDraft(telegramId)).toBeUndefined();
    expect(await db.select().from(auditLogs)).toHaveLength(0);
  });
});

function auditEvent(action: string, occurredAt: Date): typeof auditLogs.$inferInsert {
  return {
    action,
    entityType: "integration_test",
    correlationId: "4d0be33d-7ac5-49e9-bfeb-798b6bc6bcef",
    occurredAt,
  };
}
