export interface FieldDiff {
  before: unknown;
  after: unknown;
}

export function createDiff(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): Record<string, FieldDiff> {
  const result: Record<string, FieldDiff> = {};
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);

  for (const key of keys) {
    const previous = before?.[key] ?? null;
    const next = after?.[key] ?? null;
    if (!valuesEqual(previous, next)) {
      result[key] = { before: previous, after: next };
    }
  }

  return result;
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
