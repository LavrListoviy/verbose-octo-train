import pino, {
  type DestinationStream,
  type Logger,
  type LoggerOptions,
} from "pino";

import type { OperationalConfig } from "../config.js";
import { getRequestContext } from "./context.js";

type LoggerConfig = OperationalConfig & { BOT_TOKEN?: string };

export function createLogger(config: LoggerConfig, destination?: DestinationStream): Logger {
  const secrets = collectSecrets(config);
  const options: LoggerOptions = {
    level: config.LOG_LEVEL,
    base: { service: "telegram-account-bot" },
    redact: {
      paths: [
        "botToken",
        "token",
        "databaseUrl",
        "password",
        "headers.authorization",
        "req.headers.authorization",
      ],
      censor: "[REDACTED]",
    },
    hooks: {
      logMethod(args, method) {
        const sanitizedArgs = args.map((argument) => sanitizeValue(argument, secrets));
        return method.apply(this, sanitizedArgs as typeof args);
      },
    },
  };

  if (!config.LOG_PRETTY) return pino(options, destination);

  return pino(
    options,
    pino.transport({
      target: "pino-pretty",
      options: { colorize: true, singleLine: false, translateTime: "SYS:standard" },
    }),
  );
}

function collectSecrets(config: LoggerConfig): string[] {
  const secrets = [config.BOT_TOKEN, config.DATABASE_URL].filter(
    (secret): secret is string => secret !== undefined,
  );
  try {
    const databaseUrl = new URL(config.DATABASE_URL);
    if (databaseUrl.password) {
      secrets.push(databaseUrl.password, decodeURIComponent(databaseUrl.password));
    }
  } catch {
    // Configuration validation reports malformed URLs before logger creation.
  }
  return [...new Set(secrets.filter(Boolean))].sort((left, right) => right.length - left.length);
}

function sanitizeValue(value: unknown, secrets: string[], seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") {
    return secrets.reduce(
      (sanitized, secret) => sanitized.replaceAll(secret, "[REDACTED]"),
      value,
    );
  }
  if (value instanceof Error) {
    return sanitizeValue(pino.stdSerializers.err(value), secrets, seen);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, secrets, seen));
  }
  if (value instanceof Date) return value.toISOString();
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";

  seen.add(value);
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, sanitizeValue(item, secrets, seen)]),
  );
}

export function requestLogger(logger: Logger): Logger {
  const context = getRequestContext();
  if (!context) return logger;

  return logger.child({
    correlationId: context.correlationId,
    ...(context.telegramUpdateId !== undefined
      ? { telegramUpdateId: context.telegramUpdateId.toString() }
      : {}),
    ...(context.actorTelegramId !== undefined
      ? { actorTelegramId: context.actorTelegramId.toString() }
      : {}),
  });
}
