ALTER TABLE "users" ADD COLUMN "country_code" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "city_osm_type" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "city_osm_id" text;
--> statement-breakpoint
ALTER TABLE "registration_drafts" ADD COLUMN "country_code" text;
--> statement-breakpoint
ALTER TABLE "registration_drafts" ADD COLUMN "city_osm_type" text;
--> statement-breakpoint
ALTER TABLE "registration_drafts" ADD COLUMN "city_osm_id" text;
--> statement-breakpoint
ALTER TABLE "registration_drafts" ADD COLUMN "location_candidates" jsonb;
--> statement-breakpoint
UPDATE "registration_drafts"
SET
  "step" = 'country',
  "city" = NULL,
  "country" = NULL,
  "country_code" = NULL,
  "city_osm_type" = NULL,
  "city_osm_id" = NULL,
  "location_candidates" = NULL
WHERE "step" IN ('city', 'country');
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_country_code_format_check"
  CHECK ("country_code" IS NULL OR "country_code" ~ '^[A-Z]{2}$');
--> statement-breakpoint
ALTER TABLE "registration_drafts" ADD CONSTRAINT "registration_drafts_country_code_format_check"
  CHECK ("country_code" IS NULL OR "country_code" ~ '^[A-Z]{2}$');
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_city_osm_reference_check"
  CHECK (("city_osm_type" IS NULL) = ("city_osm_id" IS NULL));
--> statement-breakpoint
ALTER TABLE "registration_drafts" ADD CONSTRAINT "registration_drafts_city_osm_reference_check"
  CHECK (("city_osm_type" IS NULL) = ("city_osm_id" IS NULL));
--> statement-breakpoint
CREATE INDEX "users_country_code_idx" ON "users" USING btree ("country_code");
--> statement-breakpoint
CREATE INDEX "users_country_code_city_osm_idx" ON "users" USING btree ("country_code", "city_osm_type", "city_osm_id");
