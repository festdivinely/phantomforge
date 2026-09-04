import type { Browser, BrowserContext, Page } from 'playwright';
import type { IdentitySession, SessionValidation } from '../base/connector.js';

export const LINKEDIN_ORIGIN = 'https://www.linkedin.com';

/** The cookie LinkedIn actually authenticates with. Without it, nothing works. */
export const AUTH_COOKIE_NAME = 'li_at';

/**
 * Builds an isolated browser context for one identity.
 *
 * One identity == one browser context == one cookie jar. Contexts are never
 * shared between identities; mixing sessions is the fastest way to get an
 * account flagged.
 */
export async function createLinkedInContext(
  browser: Browser,
  session: IdentitySession,
): Promise<BrowserContext> {
  const context = await browser.newContext({
    userAgent: session.userAgent,
    locale: session.locale ?? 'en-US',
    timezoneId: session.timezoneId,
    proxy: session.proxy,
    viewport: { width: 1440, height: 900 },
  });

  await context.addCookies(
    session.cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain || '.linkedin.com',
      path: c.path || '/',
      expires: c.expires,
      httpOnly: c.httpOnly ?? true,
      secure: c.secure ?? true,
      sameSite: c.sameSite ?? 'None',
    })),
  );

  return context;
}

/**
 * Decides whether a stored session is still usable.
 *
 * Called before every run. Cheap compared to discovering mid-run that we have
 * been logged out and hammering a login wall a hundred times.
 */
export async function validateLinkedInSession(page: Page): Promise<SessionValidation> {
  await page.goto(`${LINKEDIN_ORIGIN}/feed/`, { waitUntil: 'domcontentloaded' });
  const url = page.url();

  if (url.includes('/checkpoint/') || url.includes('/challenge')) {
    return { status: 'challenged', reason: 'LinkedIn presented a verification checkpoint' };
  }
  if (url.includes('/login') || url.includes('/authwall')) {
    return { status: 'expired', reason: 'Session cookie is no longer valid' };
  }
  if (url.includes('/restricted') || url.includes('/help/linkedin/answer/')) {
    return { status: 'restricted', reason: 'Account appears to be restricted' };
  }

  const navVisible = await page
    .locator('#global-nav')
    .isVisible({ timeout: 10_000 })
    .catch(() => false);

  return navVisible
    ? { status: 'active' }
    : { status: 'expired', reason: 'Authenticated navigation was not rendered' };
}

export function hasAuthCookie(session: IdentitySession): boolean {
  return session.cookies.some((c) => c.name === AUTH_COOKIE_NAME && c.value.length > 0);
}
