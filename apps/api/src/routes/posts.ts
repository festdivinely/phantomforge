import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@pf/db';

const createPostSchema = z.object({
  organizationId: z.string().min(1),
  identityId: z.string().min(1),
  text: z.string().trim().min(1).max(3000),
  source: z.string().max(40).default('owner'),
  scheduledFor: z.coerce.date().optional(),
});

const approveSchema = z.object({
  /** The owner may edit the text while approving. */
  text: z.string().trim().min(1).max(3000).optional(),
  scheduledFor: z.coerce.date().nullable().optional(),
});

/**
 * Post drafts and the owner's decision on each. Approving is the only way a
 * post can ever be published: the worker's scheduler only picks up posts in
 * the `approved` state.
 */
export async function postRoutes(app: FastifyInstance) {
  app.get('/posts', async (req) => {
    const query = z
      .object({
        organizationId: z.string(),
        identityId: z.string().optional(),
        status: z
          .enum(['pending_approval', 'approved', 'rejected', 'publishing', 'published', 'failed'])
          .optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      })
      .parse(req.query);
    return prisma.postDraft.findMany({
      where: {
        organizationId: query.organizationId,
        ...(query.identityId ? { identityId: query.identityId } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
      include: { identity: { select: { label: true, platform: true } } },
    });
  });

  app.post('/posts', async (req, reply) => {
    const body = createPostSchema.parse(req.body);
    const identity = await prisma.identity.findUnique({
      where: { id: body.identityId },
      select: { organizationId: true },
    });
    if (!identity || identity.organizationId !== body.organizationId) {
      return reply.code(404).send({ error: 'Account not found' });
    }
    const post = await prisma.postDraft.create({ data: body });
    return reply.code(201).send(post);
  });

  app.post('/posts/:id/approve', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = approveSchema.parse(req.body ?? {});
    const updated = await prisma.postDraft.updateMany({
      where: { id, status: 'pending_approval' },
      data: {
        status: 'approved',
        decidedAt: new Date(),
        ...(body.text ? { text: body.text } : {}),
        ...(body.scheduledFor !== undefined ? { scheduledFor: body.scheduledFor } : {}),
      },
    });
    if (updated.count === 0) {
      return reply.code(409).send({ error: 'Only a post waiting for approval can be approved' });
    }
    return prisma.postDraft.findUnique({ where: { id } });
  });

  app.post('/posts/:id/reject', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const updated = await prisma.postDraft.updateMany({
      where: { id, status: { in: ['pending_approval', 'approved'] }, runId: null },
      data: { status: 'rejected', decidedAt: new Date() },
    });
    if (updated.count === 0) {
      return reply.code(409).send({ error: 'This post is already publishing or done' });
    }
    return prisma.postDraft.findUnique({ where: { id } });
  });
}
