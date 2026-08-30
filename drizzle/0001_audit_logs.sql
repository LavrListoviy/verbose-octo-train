CREATE TABLE "audit_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "correlation_id" uuid NOT NULL,
  "telegram_update_id" bigint,
  "actor_telegram_id" bigint,
  "action" text NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" text,
  "before" jsonb,
  "after" jsonb,
  "diff" jsonb,
  "metadata" jsonb
);
--> statement-breakpoint
CREATE INDEX "audit_logs_occurred_at_idx" ON "audit_logs" USING btree ("occurred_at");
--> statement-breakpoint
CREATE INDEX "audit_logs_actor_occurred_at_idx" ON "audit_logs" USING btree ("actor_telegram_id", "occurred_at");
--> statement-breakpoint
CREATE INDEX "audit_logs_action_occurred_at_idx" ON "audit_logs" USING btree ("action", "occurred_at");
