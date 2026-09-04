import type { Browser, BrowserContext, Page } from 'playwright';
import type { IdentityStatus, Platform } from '@pf/core';
import type { Agent } from './agent.js';

/** A single cookie as stored (encrypted) against an identity. */
export interface SessionCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

/** The decrypted session material handed to a connector at run time. */
export interface IdentitySession {
  identityId: string;
  cookies: SessionCookie[];
  userAgent?: string;
  locale?: string;
  timezoneId?: string;
  proxy?: { server: string; username?: string; password?: string };
}

export interface SessionValidation {
  status: IdentityStatus;
  /** Platform-side account name, when detectable. Useful for UI confirmation. */
  accountName?: string;
  reason?: string;
}

/**
 * A platform integration. Everything platform-specific lives behind this
 * interface, which is why the mock connector and the LinkedIn connector are
 * interchangeable and why agents can be developed without touching a real site.
 */
export interface Connector {
  platform: Platform;
  name: string;
  agents: Agent[];

  /** Build an isolated browser context carrying this identity's session. */
  createBrowserContext(browser: Browser, session: IdentitySession): Promise<BrowserContext>;

  /** Confirm the session is still logged in and unchallenged before doing work. */
  validateSession(page: Page): Promise<SessionValidation>;
}

export function findAgent(connector: Connector, key: string): Agent | undefined {
  return connector.agents.find((a) => a.key === key);
}
