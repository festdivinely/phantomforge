import type { Browser, BrowserContext, Page } from 'playwright';
import type { Connector, IdentitySession, SessionValidation } from '../base/connector.js';
import { collectProfilesAgent } from './agents/collect-profiles.js';
import { sendConnectionAgent } from './agents/send-connection.js';
import { acceptInvitationsAgent } from './agents/accept-invitations.js';
import { withdrawPendingAgent } from './agents/withdraw-pending.js';
import { createPostAgent } from './agents/create-post.js';

/**
 * A fake platform.
 *
 * This exists so the entire pipeline - queue, worker, quota, checkpointing,
 * artifacts, UI - can be built and tested with zero rate limits, zero bans and
 * fully deterministic output. Build against this first; swap in LinkedIn last.
 */
export const mockConnector: Connector = {
  platform: 'mock',
  name: 'Mock Platform',
  agents: [
    collectProfilesAgent,
    sendConnectionAgent,
    acceptInvitationsAgent,
    withdrawPendingAgent,
    createPostAgent,
  ],

  async createBrowserContext(browser: Browser, session: IdentitySession): Promise<BrowserContext> {
    return browser.newContext({
      userAgent: session.userAgent,
      locale: session.locale ?? 'en-US',
    });
  },

  async validateSession(_page: Page): Promise<SessionValidation> {
    return { status: 'active', accountName: 'mock-user' };
  },
};
