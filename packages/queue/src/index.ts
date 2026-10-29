import { Queue, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '@pf/config';

export const RUN_QUEUE_NAME = 'pf-runs';

/** BullMQ requires maxRetriesPerRequest: null on the connection it blocks on. */
export const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

/** The single unit of work the worker consumes: "execute this run". */
export interface RunJobData {
  runId: string;
  organizationId: string;
  agentKey: string;
  identityId: string | null;
  /** Set when re-queuing an interrupted run so the worker resumes. */
  resume?: boolean;
}

export const runQueue = new Queue<RunJobData>(RUN_QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: { age: 86_400, count: 1_000 },
    removeOnFail: { age: 604_800 },
  },
});

export const runQueueEvents = new QueueEvents(RUN_QUEUE_NAME, { connection: connection.duplicate() });

export async function enqueueRun(data: RunJobData): Promise<string> {
  const job = await runQueue.add('execute-run', data, { jobId: data.runId });
  return job.id ?? data.runId;
}

/**
 * Removes a run that hasn't started yet. A run that is already running can't
 * be removed (BullMQ locks it); the worker stops it instead when it sees the
 * run marked cancelled.
 */
export async function cancelRun(runId: string): Promise<boolean> {
  const job = await runQueue.getJob(runId);
  if (!job) return false;
  try {
    await job.remove();
    return true;
  } catch {
    return false;
  }
}

export const IDENTITY_QUEUE_NAME = 'pf-identity-validation';

export interface IdentityValidationJobData {
  identityId: string;
}

export const identityQueue = new Queue<IdentityValidationJobData>(IDENTITY_QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { age: 3_600, count: 100 },
    removeOnFail: { age: 86_400 },
  },
});

export async function enqueueIdentityValidation(identityId: string): Promise<void> {
  await identityQueue.add(
    'validate-identity',
    { identityId },
    { jobId: `validate-${identityId}-${Date.now()}` },
  );
}

export const DRAFT_QUEUE_NAME = 'pf-post-drafts';

/** "Have Claude write `count` post drafts for this account." */
export interface DraftJobData {
  identityId: string;
  count: number;
  /** Optional steer from the owner for this batch, e.g. "about my new job". */
  hint?: string;
  requestedBy: 'owner' | 'auto';
}

export const draftQueue = new Queue<DraftJobData>(DRAFT_QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 60_000 },
    removeOnComplete: { age: 86_400, count: 200 },
    removeOnFail: { age: 604_800 },
  },
});

export async function enqueueDrafting(data: DraftJobData): Promise<string> {
  const job = await draftQueue.add('draft-posts', data, {
    jobId: `draft-${data.identityId}-${Date.now()}`,
  });
  return job.id ?? '';
}

export { Queue, QueueEvents };

export { nextScheduledRun, assertValidSchedule } from './schedule.js';
