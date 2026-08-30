import "dotenv/config";
import { z } from "zod";

const databaseEnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  ADMIN_TELEGRAM_ID: z.coerce.bigint().positive(),
  AUDIT_RETENTION_YEARS: z.coerce.number().int().min(3).max(100).default(3),
});

const operationalEnvSchema = databaseEnvSchema.extend({
  NOMINATIM_BASE_URL: z.string().url().default("https://nominatim.openstreetmap.org/"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  LOG_PRETTY: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

const envSchema = operationalEnvSchema.extend({
  BOT_TOKEN: z
    .string()
    .min(1)
    .refine((value) => !value.includes("replace_with"), "BOT_TOKEN still contains a placeholder"),
});

export type Config = z.infer<typeof envSchema>;
export type DatabaseConfig = z.infer<typeof databaseEnvSchema>;
export type OperationalConfig = z.infer<typeof operationalEnvSchema>;

export function loadConfig(): Config {
  return parseEnvironment(envSchema);
}

export function loadDatabaseConfig(): DatabaseConfig {
  return parseEnvironment(databaseEnvSchema);
}

export function loadOperationalConfig(): OperationalConfig {
  return parseEnvironment(operationalEnvSchema);
}

function parseEnvironment<TSchema extends z.ZodTypeAny>(schema: TSchema): z.infer<TSchema> {
  const result = schema.safeParse(process.env);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  return result.data;
}
