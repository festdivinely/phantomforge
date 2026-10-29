import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@pf/db';
import { enqueueRun, cancelRun } from '@pf/queue';
import { getAgent } from '@pf/connectors';
import { getObject } from '@pf/storage';

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
    let agent;
    try {
      agent = getAgent(body.agentKey);
    } catch {
      return reply.code(400).send({ error: `Unknown agent "${body.agentKey}"` });
    }

    const parsedInput = agent.inputSchema.safeParse(body.input);
    if (!parsedInput.success) {
      return reply.code(400).send({ error: 'Invalid agent input', issues: parsedInput.error.issues });
    }

    // An agent that acts on an account must run as an account of its own
    // platform: a LinkedIn agent on the fake account, or the other way round,
    // must never start.
    if (body.identityId) {
      const identity = await prisma.identity.findUnique({
        where: { id: body.identityId },
        select: { platform: true, organizationId: true, status: true },
      });
      if (!identity || identity.organizationId !== body.organizationId) {
        return reply.code(404).send({ error: 'Account not found' });
      }
      if (identity.platform !== agent.platform) {
        return reply
          .code(400)
          .send({ error: `This is a ${agent.platform} agent; choose a ${agent.platform} account.` });
      }
      if (identity.status !== 'active') {
        return reply.code(409).send({ error: `This account is ${identity.status}; fix it before running agents.` });
      }
    } else if (!agent.readOnly) {
      return reply.code(400).send({ error: 'This agent acts on an account; choose one.' });
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

  /** One saved screenshot / page snapshot from a run, e.g. what LinkedIn showed when a run stopped. */
  app.get('/runs/:id/artifacts/:artifactId', async (req, reply) => {
    const { id, artifactId } = z.object({ id: z.string(), artifactId: z.string() }).parse(req.params);
    const artifact = await prisma.runArtifact.findFirst({ where: { id: artifactId, runId: id } });
    if (!artifact) return reply.code(404).send({ error: 'Artifact not found' });
    const object = await getObject(artifact.storageKey);
    if (!object) return reply.code(404).send({ error: 'The file was not saved (the capture failed)' });
    return reply.type(object.contentType).header('Cache-Control', 'private, max-age=3600').send(Buffer.from(object.body));
  });

  /** Stops a run: removed from the queue if waiting, aborted by the worker within seconds if running. */
  app.post('/runs/:id/cancel', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const updated = await prisma.run.updateMany({
      where: { id, status: { in: ['queued', 'running'] } },
      data: { status: 'cancelled', finishedAt: new Date() },
    });
    if (updated.count === 0) {
      const exists = await prisma.run.findUnique({ where: { id }, select: { status: true } });
      return exists
        ? reply.code(409).send({ error: `This run already ended (${exists.status})` })
        : reply.code(404).send({ error: 'Run not found' });
    }
    const removed = await cancelRun(id);
    return { cancelled: true, removedFromQueue: removed };
  });
}
