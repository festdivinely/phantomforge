import { prisma } from '@pf/db';
import { enqueueRun, nextScheduledRun } from '@pf/queue';
import { getAgent } from '@pf/connectors';

const TICK_MS = 60_000;

async function startRun(params: {
  organizationId: string;
  identityId: string;
  agentKey: string;
  input: object;
  agentConfigId?: string;
}) {
  const run = await prisma.run.create({
    data: {
      organizationId: params.organizationId,
      identityId: params.identityId,
      agentKey: params.agentKey,
      agentConfigId: params.agentConfigId,
      input: params.input,
      status: 'queued',
      trigger: 'schedule',
    },
  });
  await enqueueRun({
    runId: run.id,
    organizationId: run.organizationId,
    agentKey: run.agentKey,
    identityId: run.identityId,
  });
  return run;
}

/** Fires every schedule whose time has come, then books its next time. */
async function runDueSchedules(now: Date): Promise<void> {
  const due = await prisma.schedule.findMany({
    where: { enabled: true, nextRunAt: { lte: now } },
    include: { agentConfig: true, identity: { select: { status: true, label: true } } },
  });

  for (const schedule of due) {
    const next = nextScheduledRun(schedule.cron, schedule.timezone, schedule.jitterMinutes, now);
    // Claim it: only one worker wins if several are running.
    const claimed = await prisma.schedule.updateMany({
      where: { id: schedule.id, nextRunAt: schedule.nextRunAt },
      data: { lastRunAt: now, nextRunAt: next },
    });
    if (claimed.count === 0) continue;

    const label = `${schedule.agentConfig.agentKey} on ${schedule.identity.label}`;
    if (!schedule.agentConfig.enabled) continue;
    if (schedule.identity.status !== 'active') {
      console.log(`[schedule] skipped ${label}: account is ${schedule.identity.status}`);
      continue;
    }
    // Never stack runs: if the last one is still going, wait for the next slot.
    const busy = await prisma.run.findFirst({
      where: {
        agentConfigId: schedule.agentConfigId,
        identityId: schedule.identityId,
        status: { in: ['queued', 'running'] },
      },
      select: { id: true },
    });
    if (busy) {
      console.log(`[schedule] skipped ${label}: previous run ${busy.id} still going`);
      continue;
    }

    const run = await startRun({
      organizationId: schedule.organizationId,
      identityId: schedule.identityId,
      agentKey: schedule.agentConfig.agentKey,
      agentConfigId: schedule.agentConfigId,
      input: schedule.agentConfig.input as object,
    });
    console.log(`[schedule] started ${label} (run ${run.id}); next at ${next.toISOString()}`);
  }
}

/** Queues a publish run for every approved post whose time has come. */
async function publishDuePosts(now: Date): Promise<void> {
  const due = await prisma.postDraft.findMany({
    where: {
      status: 'approved',
      runId: null,
      OR: [{ scheduledFor: null }, { scheduledFor: { lte: now } }],
    },
    include: { identity: { select: { platform: true, status: true } } },
  });

  for (const post of due) {
    if (post.identity.status !== 'active') continue;

    const agentKey = `${post.identity.platform}.create-post`;
    try {
      getAgent(agentKey);
    } catch {
      await prisma.postDraft.update({
        where: { id: post.id },
        data: { status: 'failed', error: `Posting on ${post.identity.platform} isn't built yet` },
      });
      continue;
    }

    const claimed = await prisma.postDraft.updateMany({
      where: { id: post.id, status: 'approved', runId: null },
      data: { status: 'publishing' },
    });
    if (claimed.count === 0) continue;

    const run = await startRun({
      organizationId: post.organizationId,
      identityId: post.identityId,
      agentKey,
      input: { postId: post.id, text: post.text },
    });
    await prisma.postDraft.update({ where: { id: post.id }, data: { runId: run.id } });
    console.log(`[posts] publishing post ${post.id} (run ${run.id})`);
  }
}

/** Starts the once-a-minute scheduler loop. Returns a function that stops it. */
export function startScheduler(): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    const now = new Date();
    try {
      await runDueSchedules(now);
      await publishDuePosts(now);
    } catch (error) {
      console.error('[scheduler] tick failed:', error);
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), TICK_MS);
  return () => clearInterval(timer);
}
