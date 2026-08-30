import { describe, expect, it } from "@jest/globals";

import {
  isAtLeastAge,
  normalizeOptionalText,
  parseBirthDate,
  validateRequiredProfile,
} from "../src/registration/validation.js";

describe("parseBirthDate", () => {
  it.each([
    ["17.04.1998", "1998-04-17"],
    ["1998-04-17", "1998-04-17"],
  ])("parses %s", (input, expected) => {
    expect(parseBirthDate(input)).toBe(expected);
  });

  it.each(["31.02.2000", "2000/01/01", "hello", ""])("rejects %s", (input) => {
    expect(parseBirthDate(input)).toBeNull();
  });
});

describe("isAtLeastAge", () => {
  const now = new Date("2026-08-10T12:00:00.000Z");

  it("accepts a user on their sixteenth birthday", () => {
    expect(isAtLeastAge("2010-08-10", 16, now)).toBe(true);
  });

  it("rejects a user one day before their sixteenth birthday", () => {
    expect(isAtLeastAge("2010-08-11", 16, now)).toBe(false);
  });

  it("rejects a future date", () => {
    expect(isAtLeastAge("2030-01-01", 16, now)).toBe(false);
  });

  it("rejects a malformed stored date", () => {
    expect(isAtLeastAge("2000", 16, now)).toBe(false);
  });
});

describe("normalizeOptionalText", () => {
  it("trims text and collapses whitespace", () => {
    expect(normalizeOptionalText("  New   York \n", 20)).toBe("New York");
  });

  it.each(["   ", "too long"])("rejects an empty or oversized value", (value) => {
    expect(normalizeOptionalText(value, 3)).toBeNull();
  });
});

describe("validateRequiredProfile", () => {
  const now = new Date("2026-08-10T12:00:00.000Z");

  it("returns a profile that can be persisted", () => {
    expect(
      validateRequiredProfile({ displayName: "Alice", birthDate: "2010-08-10" }, now),
    ).toEqual({ displayName: "Alice", birthDate: "2010-08-10" });
  });

  it.each([
    [{ displayName: null, birthDate: "2000-01-01" }],
    [{ displayName: "Alice", birthDate: null }],
    [{ displayName: "Alice", birthDate: "2010-08-11" }],
  ])("rejects an incomplete or underage profile", (profile) => {
    expect(() => validateRequiredProfile(profile, now)).toThrow();
  });
});
