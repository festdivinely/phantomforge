import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@pf/db';
import { connection, enqueueLogin, getLoginState, LOGIN_TTL_SECONDS, loginKeys } from '@pf/queue';

const startSchema = z.object({
  organizationId: z.string().min(1),
  /** Log an existing LinkedIn account in again. */
  identityId: z.string().min(1).optional(),
  /** Name for a new account, e.g. "My LinkedIn". */
  label: z.string().trim().min(1).max(100).optional(),
});

const inputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('tap'), x: z.number().min(0).max(4000), y: z.number().min(0).max(4000) }),
  z.object({ kind: z.literal('text'), text: z.string().min(1).max(200) }),
  z.object({ kind: z.literal('key'), key: z.enum(['Enter', 'Tab', 'Backspace', 'Escape']) }),
  z.object({ kind: z.literal('scroll'), dy: z.number().min(-2000).max(2000) }),
]);

const idParam = z.object({ id: z.string().uuid() });

/**
 * Remote login: the owner logs in to LinkedIn in the server's browser from
 * the phone. The API only relays: the worker drives the browser. Request
 * bodies (which carry typed text, i.e. passwords) are never logged.
 */
export async function loginRoutes(app: FastifyInstance) {
  app.post('/login-sessions', async (req, reply) => {
    const body = startSchema.parse(req.body);
    let label = body.label;
    if (body.identityId) {
      const identity = await prisma.identity.findUnique({
        where: { id: body.identityId },
        select: { organizationId: true, platform: true, label: true },
      });
      if (!identity || identity.organizationId !== body.organizationId) {
        return reply.code(404).send({ error: 'Account not found' });
      }
      if (identity.platform !== 'linkedin') {
        return reply.code(400).send({ error: 'Only LinkedIn accounts log in this way.' });
      }
      label = identity.label;
    } else if (!label) {
      return reply.code(400).send({ error: 'Give the new account a name.' });
    }

    const sessionId = randomUUID();
    await enqueueLogin({ sessionId, organizationId: body.organizationId, identityId: body.identityId, label: label! });
    return reply.code(201).send({ id: sessionId });
  });

  app.get('/login-sessions/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const state = await getLoginState(id);
    return state ?? reply.code(404).send({ error: 'Login session not found or expired' });
  });

  /** The latest picture of the login page (JPEG). */
  app.get('/login-sessions/:id/frame', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const frame = await connection.getBuffer(loginKeys(id).frame);
    if (!frame) return reply.code(404).send({ error: 'No picture yet' });
    return reply.type('image/jpeg').header('Cache-Control', 'no-store').send(frame);
  });

  app.post('/login-sessions/:id/input', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const input = inputSchema.parse(req.body);
    const state = await getLoginState(id);
    if (!state || state.status !== 'live') {
      return reply.code(409).send({ error: 'This login window is not open' });
    }
    const key = loginKeys(id).input;
    await connection.multi().rpush(key, JSON.stringify(input)).expire(key, LOGIN_TTL_SECONDS).exec();
    return reply.code(202).send({ queued: true });
  });

  app.post('/login-sessions/:id/cancel', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    if (!(await getLoginState(id))) return reply.code(404).send({ error: 'Login session not found or expired' });
    await connection.set(loginKeys(id).cancel, '1', 'EX', LOGIN_TTL_SECONDS);
    return { cancelling: true };
  });
}
