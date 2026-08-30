import { describe, expect, it } from "@jest/globals";

import { createDiff } from "../src/audit/diff.js";
import { getRetentionCutoff } from "../src/audit/retention.js";
import {
  getRequestContext,
  runWithRequestContext,
} from "../src/observability/context.js";

describe("createDiff", () => {
  it("reports added, changed and removed fields", () => {
    expect(
      createDiff(
        { unchanged: "same", changed: "old", removed: "value" },
        { unchanged: "same", changed: "new", added: 42 },
      ),
    ).toEqual({
      changed: { before: "old", after: "new" },
      removed: { before: "value", after: null },
      added: { before: null, after: 42 },
    });
  });

  it("compares nested JSON values structurally", () => {
    expect(createDiff({ nested: { enabled: true } }, { nested: { enabled: true } })).toEqual({});
  });

  it("supports entity creation and deletion snapshots", () => {
    expect(createDiff(null, { status: "created" })).toEqual({
      status: { before: null, after: "created" },
    });
    expect(createDiff({ status: "deleted" }, null)).toEqual({
      status: { before: "deleted", after: null },
    });
  });
});

describe("request context", () => {
  it("is absent outside a request", () => {
    expect(getRequestContext()).toBeUndefined();
  });

  it("survives an asynchronous boundary", async () => {
    const context = {
      correlationId: "61c9142a-c2c0-4c3f-8fe8-42fcbcd1adab",
      telegramUpdateId: 10n,
      actorTelegramId: 20n,
    };

    await runWithRequestContext(context, async () => {
      await Promise.resolve();
      expect(getRequestContext()).toEqual(context);
    });
  });
});

describe("getRetentionCutoff", () => {
  it("subtracts full calendar years while preserving time", () => {
    expect(getRetentionCutoff(3, new Date("2026-08-11T12:30:45.123Z"))).toEqual(
      new Date("2023-08-11T12:30:45.123Z"),
    );
  });

  it("clamps February 29 to the last day of February", () => {
    expect(getRetentionCutoff(3, new Date("2024-02-29T10:00:00.000Z"))).toEqual(
      new Date("2021-02-28T10:00:00.000Z"),
    );
  });
});
