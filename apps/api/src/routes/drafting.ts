import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '@pf/config';
import { prisma } from '@pf/db';
import { draftQueue, enqueueDrafting } from '@pf/queue';

const field = (max: number) => z.string().max(max).default('');

const profileSchema = z.object({
  about: field(4000),
  audience: field(2000),
  topics: field(4000),
  tone: field(2000),
  avoid: field(2000),
  examples: field(15000),
  autoDraft: z.boolean().default(false),
});

const draftRequestSchema = z.object({
  identityId: z.string().min(1),
  count: z.number().int().min(1).max(5).default(3),
  hint: z.string().trim().max(500).optional(),
});

/**
 * Claude post drafting. The API only stores the posting profile and queues
 * drafting jobs; the worker calls Claude (convention: the API never does the
 * work itself). Drafts land as `pending_approval` posts.
 */
export async function draftingRoutes(app: FastifyInstance) {
  app.get('/accounts/:id/posting-profile', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const identity = await prisma.identity.findUnique({ where: { id }, select: { id: true } });
    if (!identity) return reply.code(404).send({ error: 'Account not found' });
    const profile = await prisma.postingProfile.findUnique({ where: { identityId: id } });
    return {
      ...(profile ?? profileSchema.parse({})),
      draftingEnabled: Boolean(env.ANTHROPIC_API_KEY),
    };
  });

  app.put('/accounts/:id/posting-profile', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = profileSchema.parse(req.body);
    const identity = await prisma.identity.findUnique({ where: { id }, select: { id: true } });
    if (!identity) return reply.code(404).send({ error: 'Account not found' });
    return prisma.postingProfile.upsert({
      where: { identityId: id },
      create: { ...body, identityId: id },
      update: body,
    });
  });

  app.post('/posts/draft', async (req, reply) => {
    const body = draftRequestSchema.parse(req.body);
    if (!env.ANTHROPIC_API_KEY) {
      return reply.code(503).send({ error: 'Drafting is off: ANTHROPIC_API_KEY is empty in the server .env.' });
    }
    const profile = await prisma.postingProfile.findUnique({ where: { identityId: body.identityId } });
    if (!profile || !(profile.about.trim() || profile.topics.trim())) {
      return reply
        .code(409)
        .send({ error: 'Fill in this account\'s posting profile first (at least "About you" or "Topics").' });
    }
    const jobId = await enqueueDrafting({ ...body, requestedBy: 'owner' });
    return reply.code(202).send({ jobId });
  });

  /** Progress of one drafting job, so the app can show "writing..." then the result. */
  app.get('/posts/draft/:jobId', async (req, reply) => {
    const { jobId } = z.object({ jobId: z.string() }).parse(req.params);
    const job = await draftQueue.getJob(jobId);
    if (!job) return reply.code(404).send({ error: 'Drafting job not found' });
    const state = await job.getState();
    return {
      state, // waiting | active | completed | failed | delayed (retrying)
      made: state === 'completed' ? (job.returnvalue as number | undefined) ?? 0 : undefined,
      error: state === 'failed' ? job.failedReason : undefined,
    };
  });
}
