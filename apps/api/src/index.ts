import Fastify from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import { env } from '@pf/config';
import { healthRoutes } from './routes/health.js';
import { agentRoutes } from './routes/agents.js';
import { runRoutes } from './routes/runs.js';
import { identityRoutes } from './routes/identities.js';
import { growthRoutes } from './routes/growth.js';
import { scheduleRoutes } from './routes/schedules.js';
import { postRoutes } from './routes/posts.js';

const app = Fastify({ logger: { level: env.LOG_LEVEL } });

await app.register(sensible);
await app.register(cors, { origin: [env.WEB_URL], credentials: true });

await app.register(healthRoutes);
await app.register(agentRoutes, { prefix: '/api' });
await app.register(runRoutes, { prefix: '/api' });
await app.register(identityRoutes, { prefix: '/api' });
await app.register(growthRoutes, { prefix: '/api' });
await app.register(scheduleRoutes, { prefix: '/api' });
await app.register(postRoutes, { prefix: '/api' });

try {
  await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
  app.log.info(`PhantomForge API listening on ${env.API_URL}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
