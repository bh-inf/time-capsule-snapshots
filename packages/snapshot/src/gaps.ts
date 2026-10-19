export function findMissingDates(dates: readonly string[], from: string, to: string): string[] {
  if (from > to) return [];
  const have = new Set(dates);
  const missing: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor.getTime() <= end.getTime()) {
    const date = cursor.toISOString().slice(0, 10);
    if (!have.has(date)) missing.push(date);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return missing;
}
