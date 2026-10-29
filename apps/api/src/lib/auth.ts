import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { env } from '@pf/config';

/** Hash first so the comparison is constant-time whatever the input length. */
const digest = (value: string) => createHash('sha256').update(value).digest();
const expected = digest(env.PF_API_TOKEN);

export function isOwnerToken(token: string | undefined): boolean {
  return token !== undefined && timingSafeEqual(digest(token), expected);
}

/** Routes anyone may call. Everything else needs the owner token. */
const PUBLIC_ROUTES = new Set(['/health', '/health/ready']);

/**
 * Owner-token login for every route except the health checks. Until real
 * multi-user accounts exist (better-auth), there is one owner and one token.
 * The phone app and dashboard send `Authorization: Bearer <PF_API_TOKEN>`;
 * the worker's Telegram bot accesses the database internally.
 *
 * Checks the route Fastify matched, not the raw URL: a raw-URL prefix check
 * let `/%61pi/agents` (an encoded `/api/agents`) through without a token.
 */
export function requireOwnerToken(app: FastifyInstance): void {
  app.addHook('onRequest', async (req, reply) => {
    if (req.method === 'OPTIONS') return;
    const route = req.routeOptions.url;
    if (route !== undefined && PUBLIC_ROUTES.has(route)) return;

    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : undefined;
    if (!isOwnerToken(token)) {
      return reply
        .code(401)
        .send({ error: 'Not signed in: send Authorization: Bearer <owner token>' });
    }
  });
}
