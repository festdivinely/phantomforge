import type { ZodTypeAny, z } from 'zod';
import type { Platform, QuotaAction } from './types.js';

/**
 * Pure metadata describing an agent: what it is, what it accepts, what it costs.
 * Deliberately free of Playwright so the API and web app can read agent
 * definitions without depending on a browser runtime.
 *
 * The executable half lives in @pf/connectors (`Agent`), which extends this.
 */
export interface AgentManifest<TInput extends ZodTypeAny = ZodTypeAny> {
  /** Stable unique key, e.g. "linkedin.send-connection". Never rename in place. */
  key: string;
  platform: Platform;
  name: string;
  description: string;
  /** Bump when the input schema changes incompatibly. */
  version: number;
  inputSchema: TInput;
  /**
   * Quota consumed per processed item. The governor multiplies this by the
   * number of items an agent intends to act on before the run is allowed to start.
   */
  quotaCost: Partial<Record<QuotaAction, number>>;
  /** Read-only agents may run without pacing delays and never touch quota. */
  readOnly: boolean;
}

export type AgentInput<M> = M extends AgentManifest<infer S> ? z.infer<S> : never;

export interface AgentOutcome<TResult = unknown> {
  /** Items successfully processed. */
  processed: number;
  /** Items deliberately skipped (already connected, out of network, ...). */
  skipped: number;
  /** Items that errored but did not abort the run. */
  failed: number;
  results: TResult[];
}
