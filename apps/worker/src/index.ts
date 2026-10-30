import { DelayedError, Worker, type Job } from 'bullmq';
import { env } from '@pf/config';
import {
  connection,
  RUN_QUEUE_NAME,
  IDENTITY_QUEUE_NAME,
  DRAFT_QUEUE_NAME,
  LOGIN_QUEUE_NAME,
  type RunJobData,
  type IdentityValidationJobData,
  type DraftJobData,
  type LoginJobData,
} from '@pf/queue';
import { getAgent, getConnector, type IdentitySession } from '@pf/connectors';
import { PhantomForgeError, isRetryable } from '@pf/core';
import { prisma } from '@pf/db';
import { closeBrowsers, getBrowser, lockIdentity } from './browsers.js';
import { createAgentContext } from './context.js';
import { loadIdentitySession } from './identity-session.js';
import { postUrlFrom, settlePost } from './posts.js';
import { startScheduler } from './scheduler.js';
import { notifyOwner, startTelegramBot } from './telegram.js';
import { executeDrafting, startAutoDrafter } from './drafter.js';
import { executeRemoteLogin } from './remote-login.js';

/**
 * The worker: the only process in the system that drives a browser.
 *
 * One browser per mode (see browsers.ts), one context per run, validation or
 * login, torn down every time. Contexts are never reused across identities.
 */

const ANONYMOUS_SESSION: IdentitySession = { identityId: 'anonymous', cookies: [] };

/** How often a running run checks whether the owner cancelled it. */
const CANCEL_POLL_MS = 3_000;
/** When an account is busy, try the run again this much later. */
const BUSY_RETRY_MS = 60_000;

/** Final run states never overwrite a cancel the owner already made. */
async function finishRun(runId: string, data: Parameters<typeof prisma.run.updateMany>[0]['data']) {
  await prisma.run.updateMany({ where: { id: runId, status: { not: 'cancelled' } }, data });
}

async function executeRun(job: Job<RunJobData>, token?: string): Promise<void> {
  const { runId, organizationId, agentKey, identityId } = job.data;

  const run = await prisma.run.findUnique({ where: { id: runId } });
  if (!run) throw new Error(`Run ${runId} not found`);
  if (run.status === 'cancelled') return;

  const agent = getAgent(agentKey);
  const connector = getConnector(agent.platform);

  // Never act on an account that is logged out, being checked or restricted.
  if (identityId) {
    const identity = await prisma.identity.findUnique({
      where: { id: identityId },
      select: { status: true, statusReason: true },
    });
    if (!identity || identity.status !== 'active') {
      const why = identity ? `account is ${identity.status}${identity.statusReason ? `: ${identity.statusReason}` : ''}` : 'account not found';
      await finishRun(runId, {
        status: 'failed',
        finishedAt: new Date(),
        errorCode: 'AUTH_EXPIRED',
        errorMessage: `Not started - ${why}`,
      });
      await settlePost(runId, { ok: false, error: `Not started - ${why}` });
      return;
    }
  }

  const release = identityId
    ? await lockIdentity(identityId, runId, env.RUN_TIMEOUT_MS + 60_000)
    : async () => undefined;
  if (!release) {
    await job.moveToDelayed(Date.now() + BUSY_RETRY_MS, token);
    throw new DelayedError();
  }

  await prisma.run.update({
    where: { id: runId },
    data: { status: 'running', startedAt: new Date(), attempt: job.attemptsMade + 1 },
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.RUN_TIMEOUT_MS);
  // The Cancel button sets the run to cancelled; stop clicking within seconds.
  const cancelWatch = setInterval(() => {
    void prisma.run
      .findUnique({ where: { id: runId }, select: { status: true } })
      .then((r) => {
        if (r?.status === 'cancelled') controller.abort();
      })
      .catch(() => undefined);
  }, CANCEL_POLL_MS);

  // Declared out here so `finally` can close them; created inside the try so a
  // failure while loading the session (e.g. a cookie that won't decrypt) marks
  // the Run failed instead of leaving it stuck at "running".
  let context: Awaited<ReturnType<typeof connector.createBrowserContext>> | undefined;
  let page: Awaited<ReturnType<NonNullable<typeof context>['newPage']>> | undefined;

  try {
    const browserInstance = await getBrowser(agent.platform);
    const session = identityId ? await loadIdentitySession(identityId) : ANONYMOUS_SESSION;
    context = await connector.createBrowserContext(browserInstance, session);
    page = await context.newPage();

    const ctx = createAgentContext({
      runId,
      organizationId,
      identityId: identityId ?? 'anonymous',
      page,
      signal: controller.signal,
    });

    const input = agent.inputSchema.parse(run.input);
    const outcome = await agent.execute(ctx, input);

    await finishRun(runId, {
      status: 'succeeded',
      finishedAt: new Date(),
      processed: outcome.processed,
      skipped: outcome.skipped,
      failed: outcome.failed,
      output: { results: outcome.results } as object,
    });
    await settlePost(
      runId,
      outcome.processed > 0
        ? { ok: true, postUrl: postUrlFrom(outcome.results) }
        : { ok: false, error: 'The platform did not accept the post' },
    );
  } catch (error) {
    const pfError = error instanceof PhantomForgeError ? error : null;
    const message = error instanceof Error ? error.message : String(error);
    if (controller.signal.aborted) {
      // Cancelled by the owner (the run row already says so) or timed out.
      await finishRun(runId, {
        status: 'timed_out',
        finishedAt: new Date(),
        errorCode: 'TIMEOUT',
        errorMessage: `Stopped after ${Math.round(env.RUN_TIMEOUT_MS / 60_000)} minutes`,
      });
      await settlePost(runId, { ok: false, error: 'Stopped before it finished' });
      return;
    }
    await finishRun(runId, {
      status: pfError?.code === 'QUOTA_EXCEEDED' ? 'quota_blocked' : 'failed',
      finishedAt: new Date(),
      errorCode: pfError?.code ?? 'UNKNOWN',
      errorMessage: message,
    });
    await settlePost(runId, { ok: false, error: message });
    if (pfError?.code === 'RATE_LIMITED') {
      await notifyOwner(`⚠️ LinkedIn showed a limit warning, so the run stopped: ${message}`);
    }

    // A login wall or checkpoint means the account needs its owner: mark it,
    // so schedules stop running on it until the owner fixes it.
    if (identityId && (pfError?.code === 'AUTH_EXPIRED' || pfError?.code === 'CHALLENGE_REQUIRED')) {
      await prisma.identity.update({
        where: { id: identityId },
        data: {
          status: pfError.code === 'AUTH_EXPIRED' ? 'expired' : 'challenged',
          statusReason: message,
          lastValidatedAt: new Date(),
        },
      });
    }
    // Only retry things that are actually worth retrying.
    if (isRetryable(error)) throw error;
  } finally {
    clearTimeout(timeout);
    clearInterval(cancelWatch);
    await page?.close().catch(() => undefined);
    await context?.close().catch(() => undefined);
    await release();
  }
}

/**
 * Checks whether a stored identity is still logged in. No leads, no quota,
 * no checkpointing - just "does this session still work" - so it runs on
 * its own queue rather than through the Run/Agent machinery.
 */
async function executeIdentityValidation(job: Job<IdentityValidationJobData>): Promise<void> {
  const identity = await prisma.identity.findUnique({ where: { id: job.data.identityId } });
  if (!identity) return;

  // Never check an account while a run or login is using it.
  const release = await lockIdentity(identity.id, `validate-${job.id}`, 3 * 60_000);
  if (!release) {
    console.log(`Identity ${identity.id} is busy; skipping this validation check`);
    return;
  }

  const connector = getConnector(identity.platform);
  const browserInstance = await getBrowser(identity.platform);
  const session = await loadIdentitySession(identity.id);
  const context = await connector.createBrowserContext(browserInstance, session);
  const page = await context.newPage();

  try {
    const result = await connector.validateSession(page);
    await prisma.identity.update({
      where: { id: identity.id },
      data: {
        status: result.status,
        statusReason: result.reason ?? null,
        accountName: result.accountName ?? identity.accountName,
        lastValidatedAt: new Date(),
      },
    });
    console.log(`Identity ${identity.id} validated: ${result.status}`);
  } catch (error) {
    await prisma.identity.update({
      where: { id: identity.id },
      data: {
        status: 'expired',
        statusReason: error instanceof Error ? error.message : 'Validation failed',
        lastValidatedAt: new Date(),
      },
    });
    console.error(`Identity ${identity.id} validation error:`, error);
  } finally {
    await page.close().catch(() => undefined);
    await context.close().catch(() => undefined);
    await release();
  }
}

const runWorker = new Worker<RunJobData>(RUN_QUEUE_NAME, executeRun, {
  connection,
  concurrency: env.WORKER_CONCURRENCY,
});
runWorker.on('completed', (job) => console.log(`Run ${job.data.runId} completed`));
runWorker.on('failed', (job, err) => console.error(`Run ${job?.data.runId} failed: ${err.message}`));

const identityWorker = new Worker<IdentityValidationJobData>(
  IDENTITY_QUEUE_NAME,
  executeIdentityValidation,
  { connection, concurrency: 1 },
);
identityWorker.on('failed', (job, err) =>
  console.error(`Identity validation ${job?.data.identityId} failed: ${err.message}`),
);

/** Claude post drafting: one batch at a time, no browser involved. */
const draftWorker = new Worker<DraftJobData, number>(DRAFT_QUEUE_NAME, executeDrafting, {
  connection,
  concurrency: 1,
});
draftWorker.on('completed', (job, made) => console.log(`Drafted ${made} posts for ${job.data.identityId}`));
draftWorker.on('failed', (job, err) => console.error(`Drafting for ${job?.data.identityId} failed: ${err.message}`));

/** Remote login: one live login window at a time. */
const loginWorker = new Worker<LoginJobData>(LOGIN_QUEUE_NAME, executeRemoteLogin, { connection, concurrency: 1 });
loginWorker.on('failed', (job, err) => console.error(`Login session ${job?.data.sessionId} failed: ${err.message}`));

console.log(`PhantomForge worker listening (concurrency ${env.WORKER_CONCURRENCY})`);

const stopScheduler = startScheduler();
const stopTelegramBot = startTelegramBot();
const stopAutoDrafter = startAutoDrafter();

async function shutdown() {
  console.log('Shutting down worker...');
  stopScheduler();
  stopTelegramBot();
  stopAutoDrafter();
  await Promise.all([runWorker.close(), identityWorker.close(), draftWorker.close(), loginWorker.close()]);
  await closeBrowsers();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
