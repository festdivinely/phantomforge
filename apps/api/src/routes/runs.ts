import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@pf/db';
import { enqueueRun, cancelRun } from '@pf/queue';
import { getAgent } from '@pf/connectors';

const createRunSchema = z.object({
  organizationId: z.string().min(1),
  agentKey: z.string().min(1),
  identityId: z.string().min(1).nullable().default(null),
  input: z.record(z.unknown()).default({}),
});

export async function runRoutes(app: FastifyInstance) {
  /** Enqueue a run. The HTTP request never executes automation itself. */
  app.post('/runs', async (req, reply) => {
    const body = createRunSchema.parse(req.body);
    const agent = getAgent(body.agentKey);

    const parsedInput = agent.inputSchema.safeParse(body.input);
    if (!parsedInput.success) {
      return reply.code(400).send({ error: 'Invalid agent input', issues: parsedInput.error.issues });
    }

    const run = await prisma.run.create({
      data: {
        organizationId: body.organizationId,
        agentKey: body.agentKey,
        identityId: body.identityId,
        input: parsedInput.data as object,
        status: 'queued',
        trigger: 'manual',
      },
    });

    await enqueueRun({
      runId: run.id,
      organizationId: run.organizationId,
      agentKey: run.agentKey,
      identityId: run.identityId,
    });

    return reply.code(201).send(run);
  });

  app.get('/runs', async (req) => {
    const query = z
      .object({ organizationId: z.string(), limit: z.coerce.number().max(100).default(25) })
      .parse(req.query);

    return prisma.run.findMany({
      where: { organizationId: query.organizationId },
      orderBy: { queuedAt: 'desc' },
      take: query.limit,
    });
  });

  app.get('/runs/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const run = await prisma.run.findUnique({
      where: { id },
      include: { logs: { orderBy: { ts: 'asc' }, take: 500 }, artifacts: true },
    });
    return run ? run : reply.code(404).send({ error: 'Run not found' });
  });

  app.post('/runs/:id/cancel', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const removed = await cancelRun(id);
    await prisma.run.update({ where: { id }, data: { status: 'cancelled', finishedAt: new Date() } });
    return { cancelled: true, removedFromQueue: removed };
  });
}
