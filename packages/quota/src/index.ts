import { env } from '@pf/config';
import { prisma } from '@pf/db';
import { QuotaExceededError, type QuotaAction } from '@pf/core';

/**
 * The quota governor.
 *
 * Phantombuster treats rate limiting as a checkbox. Here it is a subsystem with
 * its own package, its own table and its own tests, because it is the single
 * thing standing between "useful automation" and "banned account".
 *
 * Mechanisms:
 *   1. Daily ceilings per identity per action, counted in the owner's own day
 *   2. A rolling 7-day ceiling on connection requests (LinkedIn caps invites
 *      weekly, so a daily limit alone could still overshoot the week)
 *   3. Warm-up: a real account's limits start low and grow over three weeks
 *   4. Randomised inter-action delays (pace)
 */

export const DEFAULT_LIMITS: Record<QuotaAction, number> = {
  connection_request: env.QUOTA_CONNECTIONS_PER_DAY,
  connection_accept: env.QUOTA_CONNECTIONS_PER_DAY,
  connection_reject: env.QUOTA_CONNECTIONS_PER_DAY,
  connection_withdraw: env.QUOTA_CONNECTIONS_PER_DAY,
  message_send: env.QUOTA_MESSAGES_PER_DAY,
  profile_view: env.QUOTA_PROFILE_VIEWS_PER_DAY,
  post_create: env.QUOTA_POSTS_PER_DAY,
  post_engage: env.QUOTA_POSTS_PER_DAY,
};

/** Actions with a rolling 7-day ceiling on top of the daily one. */
const WEEKLY_LIMITS: Partial<Record<QuotaAction, number>> = {
  connection_request: env.QUOTA_CONNECTIONS_PER_WEEK,
};

/**
 * Share of the full limits a real account gets, by days since it was added.
 * A sudden jump from zero to full activity is the classic automation
 * signature; ramping up looks like a person getting into a habit.
 */
const WARM_UP: Array<{ beforeDay: number; factor: number }> = [
  { beforeDay: 7, factor: 0.25 },
  { beforeDay: 14, factor: 0.5 },
  { beforeDay: 21, factor: 0.75 },
];

/** Midnight of the owner's current calendar day, as the DATE the table stores. */
export function ownerDay(at = new Date()): Date {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: env.OWNER_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
}

async function warmUpFactor(identityId: string): Promise<number> {
  const identity = await prisma.identity.findUnique({
    where: { id: identityId },
    select: { platform: true, createdAt: true },
  });
  // The fake platform is for testing the machinery at full speed.
  if (!identity || identity.platform === 'mock') return 1;
  const ageDays = (Date.now() - identity.createdAt.getTime()) / 86_400_000;
  return WARM_UP.find((w) => ageDays < w.beforeDay)?.factor ?? 1;
}

const scaled = (limit: number, factor: number) => (limit > 0 ? Math.max(1, Math.floor(limit * factor)) : 0);

export interface QuotaCheck {
  action: QuotaAction;
  used: number;
  /** Today's limit after warm-up. */
  limit: number;
  /** What can still be done today, also respecting the weekly ceiling. */
  remaining: number;
  week?: { used: number; limit: number };
}

async function weeklyUsed(identityId: string, action: QuotaAction): Promise<number> {
  const today = ownerDay();
  const from = new Date(today.getTime() - 6 * 86_400_000);
  const rows = await prisma.quotaUsage.aggregate({
    where: { identityId, action, day: { gte: from, lte: today } },
    _sum: { used: true },
  });
  return rows._sum.used ?? 0;
}

export async function checkQuota(identityId: string, action: QuotaAction): Promise<QuotaCheck> {
  const factor = await warmUpFactor(identityId);
  const limit = scaled(DEFAULT_LIMITS[action], factor);
  const row = await prisma.quotaUsage.findUnique({
    where: { identityId_action_day: { identityId, action, day: ownerDay() } },
  });
  const used = row?.used ?? 0;
  let remaining = Math.max(0, limit - used);

  const weeklyBase = WEEKLY_LIMITS[action];
  if (weeklyBase === undefined) return { action, used, limit, remaining };
  const week = { used: await weeklyUsed(identityId, action), limit: scaled(weeklyBase, factor) };
  remaining = Math.min(remaining, Math.max(0, week.limit - week.used));
  return { action, used, limit, remaining, week };
}

/**
 * Reserve quota for one action. Throws QuotaExceededError when the daily or
 * weekly budget is spent - that is a normal, expected outcome, not a bug.
 * The worker runs one run per identity at a time, so check-then-write here
 * cannot race against another run on the same account.
 */
export async function consumeQuota(
  organizationId: string,
  identityId: string,
  action: QuotaAction,
  amount = 1,
): Promise<QuotaCheck> {
  const check = await checkQuota(identityId, action);
  if (check.week && check.week.used + amount > check.week.limit) {
    throw new QuotaExceededError(`${action} (this week)`, check.week.limit);
  }
  if (check.used + amount > check.limit) throw new QuotaExceededError(action, check.limit);

  const day = ownerDay();
  const row = await prisma.quotaUsage.upsert({
    where: { identityId_action_day: { identityId, action, day } },
    update: { used: { increment: amount }, limit: check.limit },
    create: { organizationId, identityId, action, day, used: amount, limit: check.limit },
  });
  return { ...check, used: row.used, remaining: Math.max(0, check.remaining - amount) };
}

/**
 * Randomised human-like delay between actions.
 *
 * Uniform jitter is itself a fingerprint, so this skews the distribution and
 * occasionally inserts a longer "the human got distracted" pause.
 */
export function nextPacingDelayMs(): number {
  const min = env.PACING_MIN_MS;
  const max = env.PACING_MAX_MS;
  // Squaring a uniform draw skews toward shorter pauses with a long tail,
  // closer to how a person clicks through a list than an even spread.
  const base = min + Math.random() ** 2 * (max - min);
  const distracted = Math.random() < 0.08 ? base * (2 + Math.random() * 3) : 0;
  return Math.round(base + distracted);
}

export function pace(signal?: AbortSignal): Promise<void> {
  const delay = nextPacingDelayMs();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Aborted before pacing delay'));
    const timer = setTimeout(resolve, delay);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('Aborted during pacing delay'));
      },
      { once: true },
    );
  });
}
