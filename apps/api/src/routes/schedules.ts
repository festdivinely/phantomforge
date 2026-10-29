import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@pf/db';
import { getAgent } from '@pf/connectors';
import { assertValidSchedule, nextScheduledRun } from '@pf/queue';

const createScheduleSchema = z.object({
  organizationId: z.string().min(1),
  identityId: z.string().min(1),
  agentKey: z.string().min(1),
  input: z.record(z.unknown()).default({}),
  name: z.string().min(1).max(100).optional(),
  /**
   * Standard cron in the account's local time. Default: at minute 0 of
   * 9am, 1pm and 5pm, Monday to Friday - working hours, weekends off.
   */
  cron: z.string().default('0 9,13,17 * * 1-5'),
  timezone: z.string().default('Africa/Lagos'),
  jitterMinutes: z.number().int().min(0).max(120).default(25),
});

const updateScheduleSchema = z.object({
  cron: z.string().optional(),
  timezone: z.string().optional(),
  jitterMinutes: z.number().int().min(0).max(120).optional(),
  enabled: z.boolean().optional(),
  input: z.record(z.unknown()).optional(),
});

const SCHEDULE_SELECT = {
  id: true,
  cron: true,
  timezone: true,
  jitterMinutes: true,
  enabled: true,
  lastRunAt: true,
  nextRunAt: true,
  createdAt: true,
  identityId: true,
  agentConfig: { select: { id: true, agentKey: true, name: true, input: true } },
} as const;

/**
 * Schedules: "run this agent on this account at these times". The worker's
 * scheduler loop fires them; this only stores them and books the first run.
 */
export async function scheduleRoutes(app: FastifyInstance) {
  app.get('/schedules', async (req) => {
    const query = z
      .object({ organizationId: z.string(), identityId: z.string().optional() })
      .parse(req.query);
    return prisma.schedule.findMany({
      where: { organizationId: query.organizationId, ...(query.identityId ? { identityId: query.identityId } : {}) },
      select: SCHEDULE_SELECT,
      orderBy: { createdAt: 'asc' },
    });
  });

  app.post('/schedules', async (req, reply) => {
    const body = createScheduleSchema.parse(req.body);
    const agent = getAgent(body.agentKey);

    const identity = await prisma.identity.findUnique({
      where: { id: body.identityId },
      select: { platform: true, organizationId: true },
    });
    if (!identity || identity.organizationId !== body.organizationId) {
      return reply.code(404).send({ error: 'Account not found' });
    }
    if (identity.platform !== agent.platform) {
      return reply.code(400).send({ error: `${agent.key} runs on ${agent.platform}, not ${identity.platform}` });
    }
    const input = agent.inputSchema.safeParse(body.input);
    if (!input.success) {
      return reply.code(400).send({ error: 'Invalid agent input', issues: input.error.issues });
    }
    try {
      assertValidSchedule(body.cron, body.timezone);
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }

    const schedule = await prisma.schedule.create({
      data: {
        organization: { connect: { id: body.organizationId } },
        identity: { connect: { id: body.identityId } },
        cron: body.cron,
        timezone: body.timezone,
        jitterMinutes: body.jitterMinutes,
        nextRunAt: nextScheduledRun(body.cron, body.timezone, body.jitterMinutes),
        agentConfig: {
          create: {
            organization: { connect: { id: body.organizationId } },
            agentKey: body.agentKey,
            name: body.name ?? agent.name,
            input: input.data as object,
          },
        },
      },
      select: SCHEDULE_SELECT,
    });
    return reply.code(201).send(schedule);
  });

  app.patch('/schedules/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = updateScheduleSchema.parse(req.body);
    const existing = await prisma.schedule.findUnique({ where: { id }, include: { agentConfig: true } });
    if (!existing) return reply.code(404).send({ error: 'Schedule not found' });

    const cron = body.cron ?? existing.cron;
    const timezone = body.timezone ?? existing.timezone;
    const jitterMinutes = body.jitterMinutes ?? existing.jitterMinutes;
    try {
      assertValidSchedule(cron, timezone);
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }

    let input: object | undefined;
    if (body.input) {
      const parsed = getAgent(existing.agentConfig.agentKey).inputSchema.safeParse(body.input);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid agent input', issues: parsed.error.issues });
      }
      input = parsed.data as object;
    }

    const timingChanged = body.cron !== undefined || body.timezone !== undefined || body.jitterMinutes !== undefined;
    const turningOn = body.enabled === true && !existing.enabled;

    return prisma.schedule.update({
      where: { id },
      data: {
        cron,
        timezone,
        jitterMinutes,
        enabled: body.enabled ?? existing.enabled,
        ...(timingChanged || turningOn ? { nextRunAt: nextScheduledRun(cron, timezone, jitterMinutes) } : {}),
        ...(input ? { agentConfig: { update: { input } } } : {}),
      },
      select: SCHEDULE_SELECT,
    });
  });

  app.delete('/schedules/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const existing = await prisma.schedule.findUnique({ where: { id }, select: { agentConfigId: true } });
    if (!existing) return reply.code(404).send({ error: 'Schedule not found' });
    // The config was created for this schedule; removing it removes the schedule too (cascade).
    await prisma.agentConfig.delete({ where: { id: existing.agentConfigId } });
    return reply.code(204).send();
  });
}
