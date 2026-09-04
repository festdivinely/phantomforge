import type { Locator, Page } from 'playwright';
import { SelectorNotFoundError } from '@pf/core';

/**
 * Resilient selectors.
 *
 * LinkedIn reships its DOM constantly, which is why Phantombuster agents rot.
 * Rather than one brittle CSS string, every element is described by an ordered
 * list of strategies. The resolver tries each in turn and reports which one won,
 * so selector health becomes a metric you can watch instead of a 3am surprise.
 */
export interface SelectorStrategy {
  /** Human name for telemetry, e.g. "aria-label", "data-testid", "css-fallback". */
  name: string;
  locate(scope: Page | Locator): Locator;
}

export interface ResilientSelector {
  /** Stable identifier used in telemetry, e.g. "connect-button". */
  name: string;
  strategies: SelectorStrategy[];
}

export interface ResolveOptions {
  timeoutMs?: number;
  /** Called with the winning strategy so callers can record selector health. */
  onResolved?: (selectorName: string, strategyName: string, strategyIndex: number) => void;
}

export async function resolveSelector(
  scope: Page | Locator,
  selector: ResilientSelector,
  options: ResolveOptions = {},
): Promise<Locator> {
  const timeout = options.timeoutMs ?? 5_000;
  const perStrategyTimeout = Math.max(500, Math.floor(timeout / selector.strategies.length));

  for (const [index, strategy] of selector.strategies.entries()) {
    const locator = strategy.locate(scope).first();
    try {
      await locator.waitFor({ state: 'attached', timeout: perStrategyTimeout });
      options.onResolved?.(selector.name, strategy.name, index);
      return locator;
    } catch {
      // Strategy did not match; fall through to the next one.
    }
  }

  throw new SelectorNotFoundError(selector.name, selector.strategies.length);
}

/** Convenience builder so selector files stay declarative and readable. */
export function selector(name: string, strategies: SelectorStrategy[]): ResilientSelector {
  return { name, strategies };
}

export function byRole(
  name: string,
  role: Parameters<Page['getByRole']>[0],
  options?: Parameters<Page['getByRole']>[1],
): SelectorStrategy {
  return { name, locate: (scope) => scope.getByRole(role, options) };
}

export function byTestId(name: string, testId: string): SelectorStrategy {
  return { name, locate: (scope) => scope.getByTestId(testId) };
}

export function byCss(name: string, css: string): SelectorStrategy {
  return { name, locate: (scope) => scope.locator(css) };
}
