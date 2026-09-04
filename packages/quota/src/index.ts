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
 * Two mechanisms:
 *   1. Hard daily ceilings per identity per action  (consume)
 *   2. Randomised inter-action delays               (pace)
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

function today(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export interface QuotaCheck {
  action: QuotaAction;
  used: number;
  limit: number;
  remaining: number;
}

export async function checkQuota(
  identityId: string,
  action: QuotaAction,
): Promise<QuotaCheck> {
  const limit = DEFAULT_LIMITS[action];
  const row = await prisma.quotaUsage.findUnique({
    where: { identityId_action_day: { identityId, action, day: today() } },
  });
  const used = row?.used ?? 0;
  return { action, used, limit, remaining: Math.max(0, limit - used) };
}

/**
 * Atomically reserve quota. Throws QuotaExceededError when the budget is spent -
 * that is a normal, expected outcome, not a bug.
 */
export async function consumeQuota(
  organizationId: string,
  identityId: string,
  action: QuotaAction,
  amount = 1,
): Promise<QuotaCheck> {
  const limit = DEFAULT_LIMITS[action];
  const day = today();

  const row = await prisma.quotaUsage.upsert({
    where: { identityId_action_day: { identityId, action, day } },
    update: { used: { increment: amount } },
    create: { organizationId, identityId, action, day, used: amount, limit },
  });

  if (row.used > limit) {
    // Roll the reservation back so a rejected action does not burn budget.
    await prisma.quotaUsage.update({
      where: { id: row.id },
      data: { used: { decrement: amount } },
    });
    throw new QuotaExceededError(action, limit);
  }

  return { action, used: row.used, limit, remaining: Math.max(0, limit - row.used) };
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
  const base = min + Math.random() * (max - min);
  const distracted = Math.random() < 0.08 ? base * (2 + Math.random() * 3) : 0;
  return Math.round(base + distracted);
}

export function pace(signal?: AbortSignal): Promise<void> {
  const delay = nextPacingDelayMs();
  return new Promise((resolve, reject) => {
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
