import {
  bigint,
  bigserial,
  date,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const accountStatusEnum = pgEnum("account_status", ["pending", "active"]);
export const registrationStepEnum = pgEnum("registration_step", [
  "display_name",
  "birth_date",
  "avatar",
  "bio",
  "city",
  "country",
  "confirmation",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    telegramId: bigint("telegram_id", { mode: "bigint" }).notNull(),
    telegramUsername: text("telegram_username"),
    displayName: text("display_name"),
    birthDate: date("birth_date", { mode: "string" }),
    avatarFileId: text("avatar_file_id"),
    bio: text("bio"),
    city: text("city"),
    country: text("country"),
    status: accountStatusEnum("status").notNull().default("pending"),
    registeredAt: timestamp("registered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("users_telegram_id_uidx").on(table.telegramId)],
);

export const roles = pgTable(
  "roles",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("roles_code_uidx").on(table.code)],
);

export const permissions = pgTable(
  "permissions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    code: text("code").notNull(),
    description: text("description"),
  },
  (table) => [uniqueIndex("permissions_code_uidx").on(table.code)],
);

export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: bigint("role_id", { mode: "number" })
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.roleId] })],
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: bigint("role_id", { mode: "number" })
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionId: bigint("permission_id", { mode: "number" })
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.roleId, table.permissionId] })],
);

export const registrationDrafts = pgTable(
  "registration_drafts",
  {
    telegramId: bigint("telegram_id", { mode: "bigint" }).primaryKey(),
    step: registrationStepEnum("step").notNull().default("display_name"),
    displayName: text("display_name"),
    birthDate: date("birth_date", { mode: "string" }),
    avatarFileId: text("avatar_file_id"),
    bio: text("bio"),
    city: text("city"),
    country: text("country"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("registration_drafts_step_idx").on(table.step)],
);

export type RegistrationDraft = typeof registrationDrafts.$inferSelect;

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    correlationId: uuid("correlation_id").notNull(),
    telegramUpdateId: bigint("telegram_update_id", { mode: "bigint" }),
    actorTelegramId: bigint("actor_telegram_id", { mode: "bigint" }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    diff: jsonb("diff"),
    metadata: jsonb("metadata"),
  },
  (table) => [
    index("audit_logs_occurred_at_idx").on(table.occurredAt),
    index("audit_logs_actor_occurred_at_idx").on(table.actorTelegramId, table.occurredAt),
    index("audit_logs_action_occurred_at_idx").on(table.action, table.occurredAt),
  ],
);
