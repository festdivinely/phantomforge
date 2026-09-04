import type { ZodTypeAny, z } from 'zod';
import type { AgentManifest, AgentOutcome } from '@pf/core';
import type { AgentContext } from './context.js';

/**
 * An executable agent: its manifest plus the code that runs it.
 *
 * Contract every agent must honour:
 *  1. Call `ctx.consumeQuota()` immediately before each metered action.
 *  2. Call `ctx.pace()` between actions - never a hand-rolled sleep.
 *  3. Call `ctx.saveCheckpoint()` after each item so the run is resumable.
 *  4. Check `ctx.signal.aborted` in every loop iteration.
 *  5. Throw a typed PhantomForgeError, never a bare Error.
 */
export interface Agent<TInput extends ZodTypeAny = ZodTypeAny, TResult = unknown>
  extends AgentManifest<TInput> {
  execute(ctx: AgentContext, input: z.infer<TInput>): Promise<AgentOutcome<TResult>>;
}

/** Helper that preserves input typing while keeping definitions declarative. */
export function defineAgent<TInput extends ZodTypeAny, TResult>(
  agent: Agent<TInput, TResult>,
): Agent<TInput, TResult> {
  return agent;
}
