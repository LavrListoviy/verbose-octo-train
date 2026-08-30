import { describe, expect, it } from "@jest/globals";

import type { RegistrationDraft } from "../src/db/schema.js";
import { formatDraft, promptForStep } from "../src/registration/prompts.js";

describe("registration location prompts", () => {
  it("asks for country before city", () => {
    expect(promptForStep("country")).toContain("страну");
    expect(promptForStep("city")).toContain("город");
  });

  it("shows country before city in the confirmation", () => {
    const draft: Pick<RegistrationDraft, "country" | "city"> = { country: "Россия", city: "Москва" };
    const formatted = formatDraft(draft as RegistrationDraft);
    expect(formatted.indexOf("Страна: Россия")).toBeLessThan(formatted.indexOf("Город: Москва"));
  });
});
