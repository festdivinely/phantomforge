import Fastify, { type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import { ZodError } from 'zod';
import { env } from '@pf/config';
import { requireOwnerToken } from './lib/auth.js';
import { healthRoutes } from './routes/health.js';
import { agentRoutes } from './routes/agents.js';
import { runRoutes } from './routes/runs.js';
import { identityRoutes } from './routes/identities.js';
import { growthRoutes } from './routes/growth.js';
import { scheduleRoutes } from './routes/schedules.js';
import { postRoutes } from './routes/posts.js';
import { meRoutes } from './routes/me.js';

const app = Fastify({ logger: { level: env.LOG_LEVEL } });

await app.register(sensible);
await app.register(cors, { origin: [env.WEB_URL], credentials: true });
requireOwnerToken(app);

/**
 * Bad input (a failed Zod parse) is the caller's mistake: 400 with the fields
 * that were wrong. Real crashes are logged in full but answered with a plain
 * 500, so internal details never reach a client once the API is on the internet.
 */
app.setErrorHandler<FastifyError>((error, req, reply) => {
  if (error instanceof ZodError) {
    return reply.code(400).send({
      error: 'Invalid request',
      issues: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    });
  }
  const status = error.statusCode ?? 500;
  if (status < 500) return reply.code(status).send({ error: error.message });
  req.log.error(error);
  return reply.code(500).send({ error: 'Internal server error' });
});

await app.register(healthRoutes);
await app.register(agentRoutes, { prefix: '/api' });
await app.register(runRoutes, { prefix: '/api' });
await app.register(identityRoutes, { prefix: '/api' });
await app.register(growthRoutes, { prefix: '/api' });
await app.register(scheduleRoutes, { prefix: '/api' });
await app.register(postRoutes, { prefix: '/api' });
await app.register(meRoutes, { prefix: '/api' });

try {
  await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
  app.log.info(`PhantomForge API listening on ${env.API_URL}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
