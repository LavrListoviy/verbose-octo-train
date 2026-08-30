export function getRetentionCutoff(retentionYears: number, now = new Date()): Date {
  const targetYear = now.getUTCFullYear() - retentionYears;
  const month = now.getUTCMonth();
  const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, month + 1, 0)).getUTCDate();

  return new Date(
    Date.UTC(
      targetYear,
      month,
      Math.min(now.getUTCDate(), lastDayOfTargetMonth),
      now.getUTCHours(),
      now.getUTCMinutes(),
      now.getUTCSeconds(),
      now.getUTCMilliseconds(),
    ),
  );
}
