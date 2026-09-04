import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@pf/db';
import { env } from '@pf/config';
import { encryptJson } from '@pf/core';
import { enqueueIdentityValidation } from '@pf/queue';

/**
 * Fields safe to ever send to a browser. Deliberately excludes
 * encryptedCookies/encryptionIv/encryptionTag - those never leave the
 * database once written, not even to this app's own dashboard.
 */
const SAFE_SELECT = {
  id: true,
  platform: true,
  label: true,
  accountName: true,
  status: true,
  statusReason: true,
  lastValidatedAt: true,
  createdAt: true,
} as const;

const cookieSchema = z.object({
  name: z.string().min(1),
  value: z.string().min(1),
  domain: z.string().min(1),
  path: z.string().default('/'),
  expires: z.number().optional(),
  httpOnly: z.boolean().optional(),
  secure: z.boolean().optional(),
  sameSite: z.enum(['Strict', 'Lax', 'None']).optional(),
});

const createIdentitySchema = z.object({
  organizationId: z.string().min(1),
  platform: z.enum(['mock', 'linkedin']),
  label: z.string().min(1).max(100),
  cookies: z.array(cookieSchema).min(1),
  userAgent: z.string().optional(),
  locale: z.string().optional(),
  timezoneId: z.string().optional(),
});

export async function identityRoutes(app: FastifyInstance) {
  app.post('/identities', async (req, reply) => {
    const body = createIdentitySchema.parse(req.body);

    if (body.platform === 'linkedin' && !body.cookies.some((c) => c.name === 'li_at')) {
      return reply.code(400).send({
        error: 'LinkedIn identities need an li_at cookie - that is the one that actually authenticates.',
      });
    }

    // Encrypted the moment they arrive. Nothing downstream ever sees the
    // plaintext cookies again except loadIdentitySession() inside the worker.
    const { ciphertext, iv, tag } = encryptJson(body.cookies, env.PF_ENCRYPTION_KEY);

    const identity = await prisma.identity.create({
      data: {
        organizationId: body.organizationId,
        platform: body.platform,
        label: body.label,
        userAgent: body.userAgent,
        locale: body.locale ?? 'en-US',
        timezoneId: body.timezoneId,
        encryptedCookies: ciphertext,
        encryptionIv: iv,
        encryptionTag: tag,
      },
      select: SAFE_SELECT,
    });

    return reply.code(201).send(identity);
  });

  app.get('/identities', async (req) => {
    const query = z.object({ organizationId: z.string() }).parse(req.query);
    return prisma.identity.findMany({
      where: { organizationId: query.organizationId },
      select: SAFE_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  });

  app.get('/identities/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const identity = await prisma.identity.findUnique({ where: { id }, select: SAFE_SELECT });
    return identity ? identity : reply.code(404).send({ error: 'Identity not found' });
  });

  /** Kicks off a worker job that opens a real browser and checks login status. */
  app.post('/identities/:id/validate', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const identity = await prisma.identity.findUnique({ where: { id }, select: { id: true } });
    if (!identity) return reply.code(404).send({ error: 'Identity not found' });

    await enqueueIdentityValidation(id);
    return reply.code(202).send({ queued: true });
  });
}
