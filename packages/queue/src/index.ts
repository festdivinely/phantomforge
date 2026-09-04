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

export async function cancelRun(runId: string): Promise<boolean> {
  const job = await runQueue.getJob(runId);
  if (!job) return false;
  await job.remove();
  return true;
}

export { Queue, QueueEvents };
