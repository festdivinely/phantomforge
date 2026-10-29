import type { FastifyInstance } from 'fastify';
import { prisma } from '@pf/db';

/**
 * Who the caller is. With one owner token there is one owner, who sees every
 * organization; the phone app uses this to find its organization id instead
 * of hardcoding `dev-org`. Becomes per-user once better-auth is wired up.
 */
export async function meRoutes(app: FastifyInstance) {
  app.get('/me', async () => ({
    role: 'owner',
    organizations: await prisma.organization.findMany({
      select: { id: true, name: true, slug: true },
      orderBy: { createdAt: 'asc' },
    }),
  }));
}
