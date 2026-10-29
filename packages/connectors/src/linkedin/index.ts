import type { Browser, BrowserContext, Page } from 'playwright';
import type { Connector, IdentitySession, SessionValidation } from '../base/connector.js';
import { createLinkedInContext, validateLinkedInSession } from './session.js';
import { sendConnectionAgent } from './agents/send-connection.js';
import { acceptInvitationsAgent } from './agents/accept-invitations.js';

/**
 * LinkedIn connector.
 *
 * Read docs/decisions/0003-browser-automation.md before extending this:
 * scripted actions here carry real account risk, which is why the quota
 * governor is not optional and why development happens against the mock.
 */
export const linkedinConnector: Connector = {
  platform: 'linkedin',
  name: 'LinkedIn',
  agents: [acceptInvitationsAgent, sendConnectionAgent],

  createBrowserContext(browser: Browser, session: IdentitySession): Promise<BrowserContext> {
    return createLinkedInContext(browser, session);
  },

  validateSession(page: Page): Promise<SessionValidation> {
    return validateLinkedInSession(page);
  },
};
