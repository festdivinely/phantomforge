import type { FastifyInstance } from 'fastify';
import { listAgents } from '@pf/connectors';

/**
 * Agents are code, not database rows, so this reads straight from the registry.
 * The dashboard renders forms from `inputSchema`, which is why manifests carry it.
 */
export async function agentRoutes(app: FastifyInstance) {
  app.get('/agents', async () =>
    listAgents().map((a) => ({
      key: a.key,
      platform: a.platform,
      name: a.name,
      description: a.description,
      version: a.version,
      readOnly: a.readOnly,
      quotaCost: a.quotaCost,
    })),
  );
}
