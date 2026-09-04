/**
 * Typed failures. The distinction that matters: is retrying this sane?
 * The worker's retry policy reads `retryable`; it should never guess.
 */
export type ErrorCode =
  | 'AUTH_EXPIRED'
  | 'CHALLENGE_REQUIRED'
  | 'RATE_LIMITED'
  | 'QUOTA_EXCEEDED'
  | 'SELECTOR_NOT_FOUND'
  | 'NAVIGATION_FAILED'
  | 'TARGET_NOT_FOUND'
  | 'ALREADY_DONE'
  | 'INVALID_INPUT'
  | 'TIMEOUT'
  | 'UNKNOWN';

export class PhantomForgeError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly context: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    options: { retryable?: boolean; context?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'PhantomForgeError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.context = options.context ?? {};
  }
}

/** The stored session is no longer valid; a human must re-authenticate. */
export class AuthExpiredError extends PhantomForgeError {
  constructor(message = 'Stored session is no longer authenticated', context = {}) {
    super('AUTH_EXPIRED', message, { retryable: false, context });
  }
}

/** The platform is showing a checkpoint/captcha. Stop, do not hammer it. */
export class ChallengeRequiredError extends PhantomForgeError {
  constructor(message = 'Platform presented a verification challenge', context = {}) {
    super('CHALLENGE_REQUIRED', message, { retryable: false, context });
  }
}

/** Our own governor refused the action. Never a bug - it is the point. */
export class QuotaExceededError extends PhantomForgeError {
  constructor(action: string, limit: number) {
    super('QUOTA_EXCEEDED', `Daily quota reached for "${action}" (limit ${limit})`, {
      retryable: false,
      context: { action, limit },
    });
  }
}

/** A selector strategy chain exhausted itself. Feeds selector-health telemetry. */
export class SelectorNotFoundError extends PhantomForgeError {
  constructor(selectorName: string, triedStrategies: number) {
    super('SELECTOR_NOT_FOUND', `No strategy matched selector "${selectorName}"`, {
      retryable: true,
      context: { selectorName, triedStrategies },
    });
  }
}

export function isRetryable(error: unknown): boolean {
  return error instanceof PhantomForgeError ? error.retryable : false;
}
