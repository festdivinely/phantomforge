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

// --- Remote login -----------------------------------------------------------
// The owner logs in to LinkedIn in the server's own browser from the phone:
// the worker streams screenshots into Redis, the API relays taps and typing
// back. Keystrokes live only in a short Redis list the worker empties at once
// and are never logged.

export const LOGIN_QUEUE_NAME = 'pf-remote-login';

export interface LoginJobData {
  sessionId: string;
  organizationId: string;
  /** Set to log an existing account in again; omitted to add a new account. */
  identityId?: string;
  label: string;
}

export type LoginInput =
  | { kind: 'tap'; x: number; y: number }
  | { kind: 'text'; text: string }
  | { kind: 'key'; key: 'Enter' | 'Tab' | 'Backspace' | 'Escape' }
  | { kind: 'scroll'; dy: number };

export interface LoginState {
  status: 'starting' | 'live' | 'saving' | 'done' | 'failed' | 'cancelled' | 'expired';
  message?: string;
  /** Page address without its query string. */
  page?: string;
  identityId?: string;
  /** Size of the live picture in page pixels, for mapping taps. */
  width: number;
  height: number;
  updatedAt: string;
}

/** A login session lives at most this long. */
export const LOGIN_TTL_SECONDS = 15 * 60;

export const loginKeys = (sessionId: string) => ({
  state: `pf:login:${sessionId}:state`,
  frame: `pf:login:${sessionId}:frame`,
  input: `pf:login:${sessionId}:input`,
  cancel: `pf:login:${sessionId}:cancel`,
});

export const loginQueue = new Queue<LoginJobData>(LOGIN_QUEUE_NAME, {
  connection,
  defaultJobOptions: { attempts: 1, removeOnComplete: { age: 3_600 }, removeOnFail: { age: 86_400 } },
});

export async function setLoginState(sessionId: string, state: Omit<LoginState, 'updatedAt'>): Promise<void> {
  await connection.set(
    loginKeys(sessionId).state,
    JSON.stringify({ ...state, updatedAt: new Date().toISOString() }),
    'EX',
    LOGIN_TTL_SECONDS,
  );
}

export async function getLoginState(sessionId: string): Promise<LoginState | undefined> {
  const raw = await connection.get(loginKeys(sessionId).state);
  return raw ? (JSON.parse(raw) as LoginState) : undefined;
}

export async function enqueueLogin(data: LoginJobData): Promise<void> {
  await setLoginState(data.sessionId, { status: 'starting', width: 0, height: 0 });
  await loginQueue.add('remote-login', data, { jobId: data.sessionId });
}

export { Queue, QueueEvents };

export { nextScheduledRun, assertValidSchedule } from './schedule.js';
