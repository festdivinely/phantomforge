import { chromium, type Browser } from 'playwright';
import type { Platform } from '@pf/core';
import { env } from '@pf/config';
import { connection } from '@pf/queue';

/**
 * One browser per mode. The fake platform runs headless for speed. Real
 * platforms run in a normal browser window (LINKEDIN_HEADLESS=false), so the
 * site sees an ordinary browser, and the owner's login and every later run
 * use that same browser - one consistent identity, nothing disguised.
 */
const browsers = new Map<string, Browser>();

export async function getBrowser(platform: Platform): Promise<Browser> {
  const real = platform !== 'mock';
  const headless = real ? env.LINKEDIN_HEADLESS : env.PLAYWRIGHT_HEADLESS;
  // An installed Chrome/Edge for real accounts; Playwright launches it with
  // a fresh temporary profile, so the owner's own browser data is untouched.
  const channel = real && env.LINKEDIN_BROWSER !== 'chromium' ? env.LINKEDIN_BROWSER : undefined;
  const key = `${channel ?? 'chromium'}:${headless}`;
  const existing = browsers.get(key);
  if (existing?.isConnected()) return existing;
  const browser = await chromium.launch({ headless, channel });
  browsers.set(key, browser);
  return browser;
}

export async function closeBrowsers(): Promise<void> {
  await Promise.all([...browsers.values()].map((b) => b.close().catch(() => undefined)));
  browsers.clear();
}

/**
 * One job per account at a time - a run, a validation or a login. Two at
 * once would mean two parallel sessions on one account, which looks like a
 * bot. Returns a release function, or null when the account is busy.
 */
export async function lockIdentity(
  identityId: string,
  holder: string,
  ttlMs: number,
): Promise<(() => Promise<void>) | null> {
  const key = `pf:identity-busy:${identityId}`;
  const ok = await connection.set(key, holder, 'PX', ttlMs, 'NX');
  if (ok !== 'OK') return null;
  return async () => {
    if ((await connection.get(key)) === holder) await connection.del(key);
  };
}
