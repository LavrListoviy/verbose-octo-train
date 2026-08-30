CREATE TYPE "account_status" AS ENUM ('pending', 'active');
--> statement-breakpoint
CREATE TYPE "registration_step" AS ENUM ('display_name', 'birth_date', 'avatar', 'bio', 'city', 'country', 'confirmation');
--> statement-breakpoint
CREATE TABLE "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "telegram_id" bigint NOT NULL,
  "telegram_username" text,
  "display_name" text,
  "birth_date" date,
  "avatar_file_id" text,
  "bio" text,
  "city" text,
  "country" text,
  "status" "account_status" DEFAULT 'pending' NOT NULL,
  "registered_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "users_active_profile_check" CHECK (
    "status" <> 'active' OR ("display_name" IS NOT NULL AND "birth_date" IS NOT NULL AND "registered_at" IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE TABLE "roles" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permissions" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "code" text NOT NULL,
  "description" text
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
  "user_id" uuid NOT NULL,
  "role_id" bigint NOT NULL,
  "assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "user_roles_user_id_role_id_pk" PRIMARY KEY("user_id", "role_id")
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
  "role_id" bigint NOT NULL,
  "permission_id" bigint NOT NULL,
  CONSTRAINT "role_permissions_role_id_permission_id_pk" PRIMARY KEY("role_id", "permission_id")
);
--> statement-breakpoint
CREATE TABLE "registration_drafts" (
  "telegram_id" bigint PRIMARY KEY NOT NULL,
  "step" "registration_step" DEFAULT 'display_name' NOT NULL,
  "display_name" text,
  "birth_date" date,
  "avatar_file_id" text,
  "bio" text,
  "city" text,
  "country" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade;
--> statement-breakpoint
CREATE UNIQUE INDEX "users_telegram_id_uidx" ON "users" USING btree ("telegram_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "roles_code_uidx" ON "roles" USING btree ("code");
--> statement-breakpoint
CREATE UNIQUE INDEX "permissions_code_uidx" ON "permissions" USING btree ("code");
--> statement-breakpoint
CREATE INDEX "registration_drafts_step_idx" ON "registration_drafts" USING btree ("step");
