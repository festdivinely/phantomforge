import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@pf/db';
import { checkQuota } from '@pf/quota';
import type { QuotaAction } from '@pf/core';

/** The actions the owner cares about when watching an account grow. */
const GROWTH_KINDS = [
  'connection_accept',
  'connection_request',
  'connection_withdraw',
  'post_create',
  'message_send',
] as const satisfies readonly QuotaAction[];

const DEFAULT_TZ = 'Africa/Lagos';

interface KindCount {
  kind: string;
  ok: number;
  failed: number;
}

/** Counts per kind since `since` (all time when null). */
async function countByKind(identityId: string, since: Date | null): Promise<Record<string, KindCount>> {
  const rows = await prisma.activity.groupBy({
    by: ['kind', 'succeeded'],
    where: { identityId, ...(since ? { occurredAt: { gte: since } } : {}) },
    _count: { _all: true },
  });
  const out: Record<string, KindCount> = {};
  for (const kind of GROWTH_KINDS) out[kind] = { kind, ok: 0, failed: 0 };
  for (const row of rows) {
    const entry = (out[row.kind] ??= { kind: row.kind, ok: 0, failed: 0 });
    if (row.succeeded) entry.ok += row._count._all;
    else entry.failed += row._count._all;
  }
  return out;
}

/** Midnight today in `tz`, as a UTC instant. */
function startOfToday(tz: string): Date {
  const now = new Date();
  const local = new Date(now.toLocaleString('en-US', { timeZone: tz }));
  const offsetMs = local.getTime() - now.getTime();
  const localMidnight = new Date(local);
  localMidnight.setHours(0, 0, 0, 0);
  return new Date(localMidnight.getTime() - offsetMs);
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

export async function growthRoutes(app: FastifyInstance) {
  /**
   * Every account with today's numbers - the phone app's home screen.
   */
  app.get('/accounts/overview', async (req) => {
    const { organizationId } = z.object({ organizationId: z.string() }).parse(req.query);
    const identities = await prisma.identity.findMany({
      where: { organizationId },
      select: {
        id: true,
        platform: true,
        label: true,
        accountName: true,
        status: true,
        statusReason: true,
        timezoneId: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    return Promise.all(
      identities.map(async (identity) => {
        const tz = identity.timezoneId ?? DEFAULT_TZ;
        const [today, last] = await Promise.all([
          countByKind(identity.id, startOfToday(tz)),
          prisma.activity.findFirst({
            where: { identityId: identity.id },
            orderBy: { occurredAt: 'desc' },
            select: { occurredAt: true, kind: true, succeeded: true, targetName: true },
          }),
        ]);
        return { ...identity, today, lastActivity: last };
      }),
    );
  });

  /**
   * Everything about one account: totals for today / 7 days / 30 days / all
   * time, a day-by-day series for charts, quota left today, and schedules.
   */
  app.get('/accounts/:id/stats', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const identity = await prisma.identity.findUnique({
      where: { id },
      select: { id: true, label: true, status: true, statusReason: true, timezoneId: true },
    });
    if (!identity) return reply.code(404).send({ error: 'Account not found' });
    const tz = identity.timezoneId ?? DEFAULT_TZ;

    const [today, week, month, allTime, daily, quota, schedules, pendingPosts] = await Promise.all([
      countByKind(id, startOfToday(tz)),
      countByKind(id, daysAgo(7)),
      countByKind(id, daysAgo(30)),
      countByKind(id, null),
      prisma.$queryRaw<Array<{ day: string; kind: string; ok: bigint; failed: bigint }>>`
        SELECT to_char(("occurredAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS day,
               kind,
               count(*) FILTER (WHERE succeeded)     AS ok,
               count(*) FILTER (WHERE NOT succeeded) AS failed
        FROM activity
        WHERE "identityId" = ${id} AND "occurredAt" >= ${daysAgo(30)}
        GROUP BY 1, 2
        ORDER BY 1`,
      Promise.all(GROWTH_KINDS.map((kind) => checkQuota(id, kind))),
      prisma.schedule.findMany({
        where: { identityId: id },
        select: {
          id: true,
          cron: true,
          timezone: true,
          enabled: true,
          lastRunAt: true,
          nextRunAt: true,
          agentConfig: { select: { agentKey: true, name: true } },
        },
      }),
      prisma.postDraft.count({ where: { identityId: id, status: 'pending_approval' } }),
    ]);

    return {
      identity,
      today,
      last7Days: week,
      last30Days: month,
      allTime,
      daily: daily.map((d) => ({ day: d.day, kind: d.kind, ok: Number(d.ok), failed: Number(d.failed) })),
      quotaToday: quota,
      schedules,
      pendingPosts,
    };
  });

  /**
   * The activity feed: newest first, for one account or all of them.
   * Pass `before` (an ISO time from the last item) to page backwards, or
   * `after` to poll for anything new since the newest item you have.
   */
  app.get('/activity', async (req) => {
    const query = z
      .object({
        organizationId: z.string(),
        identityId: z.string().optional(),
        before: z.coerce.date().optional(),
        after: z.coerce.date().optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      })
      .parse(req.query);

    return prisma.activity.findMany({
      where: {
        organizationId: query.organizationId,
        ...(query.identityId ? { identityId: query.identityId } : {}),
        ...(query.before || query.after
          ? { occurredAt: { ...(query.before ? { lt: query.before } : {}), ...(query.after ? { gt: query.after } : {}) } }
          : {}),
      },
      orderBy: { occurredAt: 'desc' },
      take: query.limit,
      include: { identity: { select: { label: true, platform: true } } },
    });
  });
}
