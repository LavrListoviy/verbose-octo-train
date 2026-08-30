import { and, eq } from "drizzle-orm";
import type { Logger } from "pino";

import { createAuditRow } from "../audit/service.js";
import type { Database } from "../db/client.js";
import {
  auditLogs,
  registrationDrafts,
  roles,
  userRoles,
  users,
  type RegistrationDraft,
} from "../db/schema.js";
import { requestLogger } from "../observability/logger.js";
import { validateRequiredProfile } from "./validation.js";

type DraftUpdate = Partial<
  Pick<
    RegistrationDraft,
    | "step"
    | "displayName"
    | "birthDate"
    | "avatarFileId"
    | "bio"
    | "city"
    | "cityOsmType"
    | "cityOsmId"
    | "country"
    | "countryCode"
    | "locationCandidates"
  >
>;

interface TelegramIdentity {
  id: bigint;
  username?: string;
}

export class RegistrationRepository {
  public constructor(
    private readonly db: Database,
    private readonly logger: Logger,
  ) {}

  public async isRegistered(telegramId: bigint): Promise<boolean> {
    const user = await this.db.query.users.findFirst({
      where: and(eq(users.telegramId, telegramId), eq(users.status, "active")),
      columns: { id: true },
    });
    return user !== undefined;
  }

  public async getDraft(telegramId: bigint): Promise<RegistrationDraft | undefined> {
    return this.db.query.registrationDrafts.findFirst({
      where: eq(registrationDrafts.telegramId, telegramId),
    });
  }

  public async start(telegramId: bigint): Promise<RegistrationDraft> {
    const draft = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(registrationDrafts)
        .values({ telegramId })
        .onConflictDoNothing()
        .returning();
      const draft =
        created ??
        (await tx.query.registrationDrafts.findFirst({
          where: eq(registrationDrafts.telegramId, telegramId),
        }));
      if (!draft) throw new Error("Failed to create registration draft");

      if (created) {
        await tx.insert(auditLogs).values(
          createAuditRow({
            action: "registration.started",
            entityType: "registration_draft",
            entityId: telegramId.toString(),
            before: null,
            after: draftSnapshot(draft),
          }),
        );
      }
      return draft;
    });
    requestLogger(this.logger).debug({ registrationStep: draft.step }, "Registration loaded");
    return draft;
  }

  public async restart(telegramId: bigint): Promise<RegistrationDraft> {
    const draft = await this.db.transaction(async (tx) => {
      const previous = await tx.query.registrationDrafts.findFirst({
        where: eq(registrationDrafts.telegramId, telegramId),
      });
      await tx.delete(registrationDrafts).where(eq(registrationDrafts.telegramId, telegramId));
      const [draft] = await tx.insert(registrationDrafts).values({ telegramId }).returning();
      if (!draft) throw new Error("Failed to restart registration draft");

      await tx.insert(auditLogs).values(
        createAuditRow({
          action: "registration.restarted",
          entityType: "registration_draft",
          entityId: telegramId.toString(),
          before: previous ? draftSnapshot(previous) : null,
          after: draftSnapshot(draft),
        }),
      );
      return draft;
    });
    requestLogger(this.logger).info("Registration restarted");
    return draft;
  }

  public async update(telegramId: bigint, values: DraftUpdate): Promise<RegistrationDraft> {
    const draft = await this.db.transaction(async (tx) => {
      const previous = await tx.query.registrationDrafts.findFirst({
        where: eq(registrationDrafts.telegramId, telegramId),
      });
      if (!previous) throw new Error("Registration draft does not exist");

      const [draft] = await tx
        .update(registrationDrafts)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(registrationDrafts.telegramId, telegramId))
        .returning();
      if (!draft) throw new Error("Registration draft does not exist");

      await tx.insert(auditLogs).values(
        createAuditRow({
          action: "registration.updated",
          entityType: "registration_draft",
          entityId: telegramId.toString(),
          before: draftSnapshot(previous),
          after: draftSnapshot(draft),
          metadata: { previousStep: previous.step, currentStep: draft.step },
        }),
      );
      return draft;
    });
    requestLogger(this.logger).debug(
      { changedFields: Object.keys(values), registrationStep: draft.step },
      "Registration updated",
    );
    return draft;
  }

  public async complete(identity: TelegramIdentity, draft: RegistrationDraft): Promise<void> {
    const requiredProfile = validateRequiredProfile(draft);

    await this.db.transaction(async (tx) => {
      const previousUser = await tx.query.users.findFirst({
        where: eq(users.telegramId, identity.id),
      });
      const [user] = await tx
        .insert(users)
        .values({
          telegramId: identity.id,
          telegramUsername: identity.username ?? null,
          displayName: requiredProfile.displayName,
          birthDate: requiredProfile.birthDate,
          avatarFileId: draft.avatarFileId,
          bio: draft.bio,
          city: draft.city,
          cityOsmType: draft.cityOsmType,
          cityOsmId: draft.cityOsmId,
          country: draft.country,
          countryCode: draft.countryCode,
          status: "active",
          registeredAt: new Date(),
        })
        .onConflictDoUpdate({
          target: users.telegramId,
          set: {
            telegramUsername: identity.username ?? null,
            displayName: requiredProfile.displayName,
            birthDate: requiredProfile.birthDate,
            avatarFileId: draft.avatarFileId,
            bio: draft.bio,
            city: draft.city,
            cityOsmType: draft.cityOsmType,
            cityOsmId: draft.cityOsmId,
            country: draft.country,
            countryCode: draft.countryCode,
            status: "active",
            registeredAt: new Date(),
            updatedAt: new Date(),
          },
        })
        .returning({ id: users.id });

      const userRole = await tx.query.roles.findFirst({
        where: eq(roles.code, "user"),
        columns: { id: true },
      });
      if (!user || !userRole) {
        throw new Error("Required user role is not seeded");
      }

      await tx
        .insert(userRoles)
        .values({ userId: user.id, roleId: userRole.id })
        .onConflictDoNothing();
      await tx.insert(auditLogs).values(
        createAuditRow({
          action: "account.created",
          entityType: "user",
          entityId: user.id,
          before: previousUser ? userSnapshot(previousUser) : null,
          after: {
            id: user.id,
            telegramId: identity.id.toString(),
            telegramUsername: identity.username ?? null,
            displayName: requiredProfile.displayName,
            birthDate: requiredProfile.birthDate,
            avatarFileId: draft.avatarFileId,
            bio: draft.bio,
            city: draft.city,
            cityOsmType: draft.cityOsmType,
            cityOsmId: draft.cityOsmId,
            country: draft.country,
            countryCode: draft.countryCode,
            status: "active",
          },
        }),
      );
      await tx.delete(registrationDrafts).where(eq(registrationDrafts.telegramId, identity.id));
    });
    requestLogger(this.logger).info("Account created");
  }
}

function draftSnapshot(draft: RegistrationDraft): Record<string, unknown> {
  return {
    telegramId: draft.telegramId.toString(),
    step: draft.step,
    displayName: draft.displayName,
    birthDate: draft.birthDate,
    avatarFileId: draft.avatarFileId,
    bio: draft.bio,
    city: draft.city,
    cityOsmType: draft.cityOsmType,
    cityOsmId: draft.cityOsmId,
    country: draft.country,
    countryCode: draft.countryCode,
    locationCandidates: draft.locationCandidates,
  };
}

function userSnapshot(user: typeof users.$inferSelect): Record<string, unknown> {
  return {
    id: user.id,
    telegramId: user.telegramId.toString(),
    telegramUsername: user.telegramUsername,
    displayName: user.displayName,
    birthDate: user.birthDate,
    avatarFileId: user.avatarFileId,
    bio: user.bio,
    city: user.city,
    cityOsmType: user.cityOsmType,
    cityOsmId: user.cityOsmId,
    country: user.country,
    countryCode: user.countryCode,
    status: user.status,
  };
}
