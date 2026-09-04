import type { FastifyInstance } from 'fastify';
import { prisma } from '@pf/db';
import { connection } from '@pf/queue';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }));

  /** Readiness: proves Postgres and Redis are actually reachable, not just that we booted. */
  app.get('/health/ready', async (_req, reply) => {
    const checks: Record<string, string> = {};
    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.database = 'ok';
    } catch {
      checks.database = 'unreachable';
    }
    try {
      await connection.ping();
      checks.redis = 'ok';
    } catch {
      checks.redis = 'unreachable';
    }
    const healthy = Object.values(checks).every((v) => v === 'ok');
    return reply.code(healthy ? 200 : 503).send({ status: healthy ? 'ready' : 'degraded', checks });
  });
}
