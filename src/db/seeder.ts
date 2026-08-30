import { eq } from "drizzle-orm";

import type { Database } from "./client.js";
import { permissions, rolePermissions, roles, userRoles, users } from "./schema.js";

const roleSeeds = [
  { code: "user", name: "User", description: "Default registered user" },
  { code: "super_admin", name: "Super administrator", description: "Full system access" },
] as const;

const permissionSeeds = [
  { code: "profile.read_self", description: "Read own profile" },
  { code: "profile.update_self", description: "Update own profile" },
  { code: "users.manage", description: "Manage users" },
  { code: "roles.manage", description: "Manage roles and permissions" },
] as const;

export async function seedDatabase(db: Database, adminTelegramId: bigint): Promise<void> {
  await db.transaction(async (tx) => {
    for (const role of roleSeeds) {
      await tx.insert(roles).values(role).onConflictDoUpdate({
        target: roles.code,
        set: { name: role.name, description: role.description },
      });
    }

    for (const permission of permissionSeeds) {
      await tx.insert(permissions).values(permission).onConflictDoUpdate({
        target: permissions.code,
        set: { description: permission.description },
      });
    }

    const allRoles = await tx.select().from(roles);
    const allPermissions = await tx.select().from(permissions);
    const userRole = allRoles.find((role) => role.code === "user");
    const adminRole = allRoles.find((role) => role.code === "super_admin");
    if (!userRole || !adminRole) throw new Error("Failed to seed roles");

    const userPermissionCodes = new Set(["profile.read_self", "profile.update_self"]);
    for (const permission of allPermissions) {
      if (userPermissionCodes.has(permission.code)) {
        await tx
          .insert(rolePermissions)
          .values({ roleId: userRole.id, permissionId: permission.id })
          .onConflictDoNothing();
      }
      await tx
        .insert(rolePermissions)
        .values({ roleId: adminRole.id, permissionId: permission.id })
        .onConflictDoNothing();
    }

    await tx
      .insert(users)
      .values({ telegramId: adminTelegramId, status: "pending" })
      .onConflictDoNothing({ target: users.telegramId });
    const admin = await tx.query.users.findFirst({
      where: eq(users.telegramId, adminTelegramId),
      columns: { id: true },
    });
    if (!admin) throw new Error("Failed to seed administrator user");

    await tx
      .insert(userRoles)
      .values({ userId: admin.id, roleId: adminRole.id })
      .onConflictDoNothing();
  });
}
