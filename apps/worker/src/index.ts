import { Worker, type Job } from 'bullmq';
import { chromium, type Browser } from 'playwright';
import { env } from '@pf/config';
import {
  connection,
  RUN_QUEUE_NAME,
  IDENTITY_QUEUE_NAME,
  type RunJobData,
  type IdentityValidationJobData,
} from '@pf/queue';
import { getAgent, getConnector, type IdentitySession } from '@pf/connectors';
import { PhantomForgeError, isRetryable } from '@pf/core';
import { prisma } from '@pf/db';
import { createAgentContext } from './context.js';
import { loadIdentitySession } from './identity-session.js';

/**
 * The worker: the only process in the system that drives a browser.
 *
 * One browser instance, one context per run or per validation check, torn
 * down every time. Contexts are never reused across identities.
 */
let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({ headless: env.PLAYWRIGHT_HEADLESS });
  }
  return browser;
}

const ANONYMOUS_SESSION: IdentitySession = { identityId: 'anonymous', cookies: [] };

async function executeRun(job: Job<RunJobData>): Promise<void> {
  const { runId, organizationId, agentKey, identityId } = job.data;

  const run = await prisma.run.findUnique({ where: { id: runId } });
  if (!run) throw new Error(`Run ${runId} not found`);
  if (run.status === 'cancelled') return;

  const agent = getAgent(agentKey);
  const connector = getConnector(agent.platform);

  await prisma.run.update({
    where: { id: runId },
    data: { status: 'running', startedAt: new Date(), attempt: job.attemptsMade + 1 },
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.RUN_TIMEOUT_MS);

  const browserInstance = await getBrowser();
  const session = identityId ? await loadIdentitySession(identityId) : ANONYMOUS_SESSION;
  const context = await connector.createBrowserContext(browserInstance, session);
  const page = await context.newPage();

  try {
    const ctx = createAgentContext({
      runId,
      organizationId,
      identityId: identityId ?? 'anonymous',
      page,
      signal: controller.signal,
    });

    const input = agent.inputSchema.parse(run.input);
    const outcome = await agent.execute(ctx, input);

    await prisma.run.update({
      where: { id: runId },
      data: {
        status: 'succeeded',
        finishedAt: new Date(),
        processed: outcome.processed,
        skipped: outcome.skipped,
        failed: outcome.failed,
        output: { results: outcome.results } as object,
      },
    });
  } catch (error) {
    const pfError = error instanceof PhantomForgeError ? error : null;
    await prisma.run.update({
      where: { id: runId },
      data: {
        status: pfError?.code === 'QUOTA_EXCEEDED' ? 'quota_blocked' : 'failed',
        finishedAt: new Date(),
        errorCode: pfError?.code ?? 'UNKNOWN',
        errorMessage: error instanceof Error ? error.message : String(error),
      },
    });
    // Only retry things that are actually worth retrying.
    if (isRetryable(error)) throw error;
  } finally {
    clearTimeout(timeout);
    await page.close().catch(() => undefined);
    await context.close().catch(() => undefined);
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

  const connector = getConnector(identity.platform);
  const browserInstance = await getBrowser();
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

console.log(`PhantomForge worker listening (concurrency ${env.WORKER_CONCURRENCY})`);

async function shutdown() {
  console.log('Shutting down worker...');
  await Promise.all([runWorker.close(), identityWorker.close()]);
  await browser?.close().catch(() => undefined);
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
