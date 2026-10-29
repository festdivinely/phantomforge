import parser from 'cron-parser';

/**
 * When a schedule should fire next: the next cron match in the schedule's own
 * timezone (so "9am" means 9am where the account lives), pushed back by a
 * random 0..jitterMinutes. Shared by the API (first run) and the worker
 * (every run after).
 */
export function nextScheduledRun(
  cron: string,
  timezone: string,
  jitterMinutes: number,
  from: Date = new Date(),
): Date {
  const next = parser.parseExpression(cron, { currentDate: from, tz: timezone }).next().toDate();
  const jitterMs = Math.floor(Math.random() * (jitterMinutes * 60_000 + 1));
  return new Date(next.getTime() + jitterMs);
}

/** Throws a readable error for a bad cron expression or timezone. */
export function assertValidSchedule(cron: string, timezone: string): void {
  try {
    parser.parseExpression(cron, { tz: timezone }).next();
  } catch (error) {
    throw new Error(
      `Invalid schedule "${cron}" in ${timezone}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
