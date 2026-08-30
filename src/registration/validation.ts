export const MINIMUM_AGE = 16;

export function parseBirthDate(value: string): string | null {
  const trimmed = value.trim();
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  const localMatch = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(trimmed);

  const year = Number(isoMatch?.[1] ?? localMatch?.[3]);
  const month = Number(isoMatch?.[2] ?? localMatch?.[2]);
  const day = Number(isoMatch?.[3] ?? localMatch?.[1]);

  if (!year || !month || !day) {
    return null;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day
    .toString()
    .padStart(2, "0")}`;
}

export function isAtLeastAge(birthDate: string, age: number, now = new Date()): boolean {
  const [year, month, day] = birthDate.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    return false;
  }

  const threshold = new Date(
    Date.UTC(now.getUTCFullYear() - age, now.getUTCMonth(), now.getUTCDate()),
  );
  const birth = new Date(Date.UTC(year, month - 1, day));
  return birth <= threshold;
}

export function normalizeOptionalText(value: string, maxLength: number): string | null {
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 0 && normalized.length <= maxLength ? normalized : null;
}

export function validateRequiredProfile(
  profile: { displayName: string | null; birthDate: string | null },
  now = new Date(),
): { displayName: string; birthDate: string } {
  if (!profile.displayName || !profile.birthDate) {
    throw new Error("Display name and birth date are required");
  }
  if (!parseBirthDate(profile.birthDate) || !isAtLeastAge(profile.birthDate, MINIMUM_AGE, now)) {
    throw new Error("Birth date does not satisfy registration requirements");
  }
  return { displayName: profile.displayName, birthDate: profile.birthDate };
}
