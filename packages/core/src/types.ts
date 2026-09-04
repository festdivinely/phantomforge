/** Shared domain vocabulary. If a concept matters across packages, it lives here. */

export type Platform = 'mock' | 'linkedin';

/** Lifecycle of a single execution of an agent. */
export type RunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'timed_out'
  | 'quota_blocked';

export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = [
  'succeeded',
  'failed',
  'cancelled',
  'timed_out',
  'quota_blocked',
] as const;

/**
 * Actions that consume quota. The governor meters these per identity per day;
 * anything that touches another user's attention belongs on this list.
 */
export type QuotaAction =
  | 'connection_request'
  | 'connection_accept'
  | 'connection_reject'
  | 'connection_withdraw'
  | 'message_send'
  | 'profile_view'
  | 'post_create'
  | 'post_engage';

/** Health of a stored platform session. */
export type IdentityStatus = 'active' | 'expired' | 'challenged' | 'restricted' | 'disabled';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface RunLogEntry {
  ts: string;
  level: LogLevel;
  message: string;
  data?: Record<string, unknown>;
}

/**
 * Progress marker written after every processed item so an interrupted run
 * resumes where it stopped instead of starting over.
 */
export interface Checkpoint {
  cursor: string | null;
  processed: number;
  total: number | null;
  updatedAt: string;
}

export interface RunArtifact {
  kind: 'screenshot' | 'dom_snapshot' | 'har' | 'export';
  key: string;
  contentType: string;
  capturedAt: string;
  note?: string;
}
