import type { Job } from 'bullmq';
import type { BrowserContext, Page } from 'playwright';
import { env } from '@pf/config';
import { encryptJson } from '@pf/core';
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
// Phone-shaped, so LinkedIn's login page fills the owner's phone screen and
// stays readable. Only the login uses it; runs keep the laptop layout. The
// session cookies don't depend on the window size.
const VIEWPORT = { width: 412, height: 860 };
// Short, so a tap or key from the phone reaches the page almost at once.
const TICK_MS = 150;
/** Even with no new picture, refresh the state this often so the phone knows the session is alive. */
const HEARTBEAT_MS = 2_000;
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

  // Replaced by a newer login while it waited: don't open a window at all.
  if (await connection.get(keys.cancel)) {
    await state({ status: 'cancelled', message: 'Replaced by a newer login.' });
    await connection.del(keys.cancel);
    return;
  }

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
    context = await browser.newContext({
      viewport: VIEWPORT,
      // Sharp text on a phone screen.
      deviceScaleFactor: 2,
      locale: 'en-US',
      timezoneId: env.OWNER_TIMEZONE,
    });
    page = await context.newPage();

    // Live picture: Chrome streams a frame whenever the page changes. Taking
    // a screenshot every tick instead made the visible window resize and
    // flash each time.
    let latestFrame: Buffer | null = null;
    let frameIsNew = false;
    let frameSeq = 0;
    const cdp = await context.newCDPSession(page);
    cdp.on('Page.screencastFrame', ({ data, sessionId: frameId }) => {
      latestFrame = Buffer.from(data, 'base64');
      frameIsNew = true;
      void cdp.send('Page.screencastFrameAck', { sessionId: frameId }).catch(() => undefined);
    });
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 60,
      maxWidth: VIEWPORT.width * 2,
      maxHeight: VIEWPORT.height * 2,
    });

    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
    await state({ status: 'live', page: pageAddress(page) });
    let lastPage = '';
    let lastBeat = -1;
    let lastBeatAt = 0;

    for (;;) {
      if (await connection.get(keys.cancel)) {
        await state({ status: 'cancelled', message: 'Login cancelled.' });
        return;
      }
      // Someone closed the browser window (or tab) on the server.
      if (page.isClosed() || !browser.isConnected()) {
        await state({ status: 'failed', message: 'The login window on the server was closed. Start again.' });
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

      // Only a changed picture is stored and announced; the phone fetches a
      // picture only when frameSeq moves, so nothing unchanged crosses the tunnel.
      const address = pageAddress(page);
      if (frameIsNew && latestFrame) {
        frameIsNew = false;
        frameSeq += 1;
        await connection.set(keys.frame, latestFrame, 'EX', LOGIN_TTL_SECONDS);
      }
      if (frameSeq !== lastBeat || address !== lastPage || Date.now() - lastBeatAt > HEARTBEAT_MS) {
        await state({ status: 'live', page: address, frameSeq });
        lastBeat = frameSeq;
        lastPage = address;
        lastBeatAt = Date.now();
      }
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
