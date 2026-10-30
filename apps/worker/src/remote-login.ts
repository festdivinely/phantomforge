import type { Job } from 'bullmq';
import type { BrowserContext, Page } from 'playwright';
import { env } from '@pf/config';
import { encryptJson } from '@pf/core';
import { getConnector } from '@pf/connectors';
import { prisma } from '@pf/db';
import {
  connection,
  LOGIN_TTL_SECONDS,
  loginKeys,
  setLoginState,
  type LoginInput,
  type LoginJobData,
  type LoginState,
} from '@pf/queue';
import { getBrowser, lockIdentity } from './browsers.js';
import { notifyOwner } from './telegram.js';

/**
 * Remote login: the owner logs in to LinkedIn in this server's own browser
 * from the phone. The worker shows the page as a stream of screenshots and
 * replays the owner's taps and typing; when LinkedIn opens the feed, the
 * session cookies are encrypted into the identity vault.
 *
 * Privacy: typed text is applied straight to the page and never logged or
 * stored; the Redis input list is emptied on every tick.
 */

const LOGIN_URL = 'https://www.linkedin.com/login';
const VIEWPORT = { width: 1440, height: 900 };
const TICK_MS = 700;
const SESSION_MS = 12 * 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** A person types at an uneven pace; so does this. */
const keyDelay = () => 45 + Math.round(Math.random() * 90);

async function takeInputs(sessionId: string): Promise<LoginInput[]> {
  const key = loginKeys(sessionId).input;
  const [[, items]] = (await connection.multi().lrange(key, 0, -1).del(key).exec()) as [[unknown, string[]]];
  return items.map((raw) => JSON.parse(raw) as LoginInput);
}

async function apply(page: Page, input: LoginInput): Promise<void> {
  switch (input.kind) {
    case 'tap':
      await page.mouse.click(
        Math.max(0, Math.min(VIEWPORT.width, input.x)),
        Math.max(0, Math.min(VIEWPORT.height, input.y)),
      );
      break;
    case 'text':
      await page.keyboard.type(input.text, { delay: keyDelay() });
      break;
    case 'key':
      await page.keyboard.press(input.key);
      break;
    case 'scroll':
      await page.mouse.wheel(0, Math.max(-2000, Math.min(2000, input.dy)));
      break;
  }
}

/** Where the page is, without query strings (they can carry tokens). */
const pageAddress = (page: Page) => {
  try {
    const u = new URL(page.url());
    return `${u.host}${u.pathname}`;
  } catch {
    return '';
  }
};

/** Logged in = LinkedIn shows the signed-in app, not a login or check page. */
function loggedIn(page: Page): boolean {
  const path = new URL(page.url()).pathname;
  return /^\/(feed|mynetwork|in\/|messaging|notifications)/.test(path);
}

export async function executeRemoteLogin(job: Job<LoginJobData>): Promise<void> {
  const { sessionId, organizationId, identityId, label } = job.data;
  const keys = loginKeys(sessionId);
  const state = (s: Omit<LoginState, 'updatedAt' | 'width' | 'height'>) =>
    setLoginState(sessionId, { ...s, ...VIEWPORT });

  // Logging an existing account in again: nothing else may use it meanwhile.
  const release = identityId ? await lockIdentity(identityId, `login-${sessionId}`, SESSION_MS + 60_000) : null;
  if (identityId && !release) {
    await state({ status: 'failed', message: 'This account is busy with a run. Try again in a minute.' });
    return;
  }

  let context: BrowserContext | undefined;
  let page: Page | undefined;
  const deadline = Date.now() + SESSION_MS;

  try {
    const browser = await getBrowser('linkedin');
    context = await getConnector('linkedin').createBrowserContext(browser, {
      identityId: identityId ?? 'new-login',
      cookies: [],
      locale: 'en-US',
      timezoneId: env.OWNER_TIMEZONE,
    });
    page = await context.newPage();
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
    await state({ status: 'live', page: pageAddress(page) });

    for (;;) {
      if (await connection.get(keys.cancel)) {
        await state({ status: 'cancelled', message: 'Login cancelled.' });
        return;
      }
      if (Date.now() > deadline) {
        await state({ status: 'expired', message: 'The login window timed out. Start again.' });
        return;
      }

      for (const input of await takeInputs(sessionId)) {
        await apply(page, input).catch(() => undefined);
      }

      if (loggedIn(page)) break;

      const frame = await page.screenshot({ type: 'jpeg', quality: 55, timeout: 5_000 }).catch(() => null);
      if (frame) await connection.set(keys.frame, frame, 'EX', LOGIN_TTL_SECONDS);
      await state({ status: 'live', page: pageAddress(page) });
      await sleep(TICK_MS);
    }

    // Signed in. Let the page settle so every session cookie is set.
    await state({ status: 'saving', message: 'Signed in - saving the session...' });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);

    const cookies = (await context.cookies())
      .filter((c) => c.domain.replace(/^\./, '').endsWith('linkedin.com'))
      .map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        expires: c.expires > 0 ? c.expires : undefined,
        httpOnly: c.httpOnly,
        secure: c.secure,
        sameSite: c.sameSite,
      }));
    if (!cookies.some((c) => c.name === 'li_at' && c.value)) {
      await state({ status: 'failed', message: 'LinkedIn did not give a login session. Try again.' });
      return;
    }
    const userAgent = await page.evaluate(() => navigator.userAgent);
    const { ciphertext, iv, tag } = encryptJson(cookies, env.PF_ENCRYPTION_KEY);
    const vault = { encryptedCookies: ciphertext, encryptionIv: iv, encryptionTag: tag };

    let savedId: string;
    if (identityId) {
      const updated = await prisma.identity.update({
        where: { id: identityId },
        data: {
          ...vault,
          userAgent,
          status: 'active',
          statusReason: null,
          lastValidatedAt: new Date(),
        },
        select: { id: true },
      });
      savedId = updated.id;
    } else {
      const created = await prisma.identity.create({
        data: {
          ...vault,
          organizationId,
          platform: 'linkedin',
          label,
          userAgent,
          locale: 'en-US',
          timezoneId: env.OWNER_TIMEZONE,
          status: 'active',
          lastValidatedAt: new Date(),
        },
        select: { id: true },
      });
      savedId = created.id;
    }

    await state({ status: 'done', message: 'Account connected.', identityId: savedId });
    await notifyOwner(`✅ LinkedIn account "${label}" is connected to PhantomForge.`);
  } catch (error) {
    console.error(`[login] ${sessionId} failed:`, error instanceof Error ? error.message : error);
    await state({ status: 'failed', message: 'The login window ran into an error. Start again.' });
  } finally {
    await connection.del(keys.frame, keys.input, keys.cancel);
    await page?.close().catch(() => undefined);
    await context?.close().catch(() => undefined);
    await release?.();
  }
}
