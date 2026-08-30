import { Writable } from "node:stream";

import { describe, expect, it } from "@jest/globals";

import type { Config } from "../src/config.js";
import { createLogger } from "../src/observability/logger.js";

describe("application logger", () => {
  it("redacts secrets from nested errors, stacks and messages", () => {
    const config: Config = {
      BOT_TOKEN: "1234567890:very_secret_telegram_token_value",
      DATABASE_URL: "postgres://bot:super-secret-password@db:5432/bot",
      ADMIN_TELEGRAM_ID: 120484366n,
      AUDIT_RETENTION_YEARS: 3,
      LOG_LEVEL: "debug",
      LOG_PRETTY: false,
    };
    let output = "";
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        output += chunk.toString();
        callback();
      },
    });
    const error = new Error(`Request failed for ${config.BOT_TOKEN}`, {
      cause: new Error(`Could not connect using ${config.DATABASE_URL}`),
    });

    createLogger(config, destination).error(
      { err: error, note: `password=super-secret-password` },
      `Telegram token: ${config.BOT_TOKEN}`,
    );

    expect(output).toContain("[REDACTED]");
    expect(output).not.toContain(config.BOT_TOKEN);
    expect(output).not.toContain(config.DATABASE_URL);
    expect(output).not.toContain("super-secret-password");
  });
});
