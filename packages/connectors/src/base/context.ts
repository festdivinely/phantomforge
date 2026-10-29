import type { Page } from 'playwright';
import type { Checkpoint, LogLevel, QuotaAction, RunArtifact } from '@pf/core';

/** One action the identity performed on the platform, for the growth record. */
export interface ActivityRecord {
  kind: QuotaAction;
  ok: boolean;
  targetName?: string;
  targetUrl?: string;
  detail?: Record<string, unknown>;
}

/**
 * Everything an agent is allowed to touch during a run.
 *
 * Agents receive this and nothing else - no database handle, no queue, no
 * direct filesystem. That constraint is what makes agents testable against the
 * mock connector and swappable without rewriting the platform around them.
 */
export interface AgentContext {
  runId: string;
  identityId: string;

  /** A Playwright page already primed with the identity's session. */
  page: Page;

  /** Structured logging; every entry is persisted and streamed to the UI. */
  log(level: LogLevel, message: string, data?: Record<string, unknown>): void;

  /**
   * Ask permission before performing a metered action. Throws QuotaExceededError
   * if the identity's daily budget is spent. Agents must call this immediately
   * before the action, never in a batch up front.
   */
  consumeQuota(action: QuotaAction, amount?: number): Promise<void>;

  /** Randomised human-like delay. Agents should not implement their own sleeps. */
  pace(): Promise<void>;

  /** Persist progress so an interrupted run resumes rather than restarts. */
  saveCheckpoint(checkpoint: Omit<Checkpoint, 'updatedAt'>): Promise<void>;
  loadCheckpoint(): Promise<Checkpoint | null>;

  /** Emit a lead into the lead graph. Deduplicated downstream. */
  emitLead(lead: unknown): Promise<void>;

  /**
   * Record what the identity just did (accepted, sent, withdrew, posted),
   * success or failure. Call it once per action, right after the action -
   * the owner's per-account history and stats are built from these.
   */
  recordActivity(activity: ActivityRecord): Promise<void>;

  /** Capture a screenshot / DOM snapshot into object storage. */
  captureArtifact(kind: RunArtifact['kind'], note?: string): Promise<RunArtifact>;

  /** Aborted when the run is cancelled or times out. Agents must respect it. */
  signal: AbortSignal;
}
