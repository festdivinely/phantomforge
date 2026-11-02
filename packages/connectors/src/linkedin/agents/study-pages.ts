import { z } from 'zod';
import { defineAgent } from '../../base/agent.js';
import type { AgentContext } from '../../base/context.js';
import { assertSafeToContinue, LINKEDIN_ORIGIN } from '../session.js';

/**
 * The pages every growth agent works on. Studied before any agent clicks
 * anything on a real account, so selectors are checked against the account's
 * own LinkedIn rather than guessed.
 */
const PAGES = [
  { key: 'feed', name: 'feed', url: `${LINKEDIN_ORIGIN}/feed/` },
  { key: 'own-profile', name: 'own profile', url: `${LINKEDIN_ORIGIN}/in/me/` },
  { key: 'received', name: 'received invitations', url: `${LINKEDIN_ORIGIN}/mynetwork/invitation-manager/received/` },
  { key: 'sent', name: 'sent invitations', url: `${LINKEDIN_ORIGIN}/mynetwork/invitation-manager/sent/` },
  { key: 'network', name: 'my network suggestions', url: `${LINKEDIN_ORIGIN}/mynetwork/grow/` },
  {
    key: 'search',
    name: 'people search #opentoconnect',
    url: `${LINKEDIN_ORIGIN}/search/results/people/?keywords=${encodeURIComponent('#opentoconnect')}`,
  },
  // Who can follow / see the account (where Follow vs Connect is chosen).
  { key: 'visibility', name: 'visibility settings', url: `${LINKEDIN_ORIGIN}/mypreferences/d/categories/profile-visibility/` },
  { key: 'followers', name: 'followers setting', url: `${LINKEDIN_ORIGIN}/mypreferences/m/settings/followed/` },
  { key: 'invitations-setting', name: 'who can invite setting', url: `${LINKEDIN_ORIGIN}/mypreferences/m/settings/receive-invitations/` },
  // The owner's own edit forms, opened only to read them - nothing is typed or saved.
  { key: 'edit-intro', name: 'edit intro form', url: (own: string) => `${own}edit/intro/` },
  // The About form only opens from a link on the profile, like a person clicking it.
  { key: 'edit-about', name: 'edit about form', url: (own: string) => own, open: 'main a[href*="/edit/forms/summary/"]' },
  { key: 'experience', name: 'experience list', url: (own: string) => `${own}details/experience/` },
  {
    key: 'edit-experience',
    name: 'edit job form',
    url: (own: string) => `${own}details/experience/`,
    open: 'main a[href*="/details/experience/edit/forms/"]',
  },
] as const;

const PAGE_KEYS = ['feed', 'own-profile', 'received', 'sent', 'network', 'search', 'edit-intro', 'edit-about', 'experience', 'edit-experience', 'visibility', 'followers', 'invitations-setting'] as const;

const inputSchema = z.object({
  pages: z
    .array(z.enum(PAGE_KEYS))
    .min(1)
    .optional()
    .describe('Only these pages; all of them when left out'),
  openOneProfile: z
    .boolean()
    .default(true)
    .describe('Also open the first person from the search (one profile view, counted in the quota)'),
});

/** A person reads a page before moving on: a short scroll down and back. */
async function lookAround(ctx: AgentContext) {
  await ctx.page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  for (const dy of [500, 600, -1100]) {
    await ctx.page.mouse.wheel(0, dy);
    await ctx.page.waitForTimeout(900 + Math.random() * 1200);
  }
}

async function study(ctx: AgentContext, name: string) {
  await lookAround(ctx);
  await assertSafeToContinue(ctx.page);
  await ctx.captureArtifact('screenshot', name);
  await ctx.captureArtifact('aria_snapshot', name);
  ctx.log('info', `Studied: ${name}`);
}

/**
 * Read-only: opens each page, scrolls, and saves a screenshot plus the page's
 * accessibility map (every button, link and label, the same information a
 * screen reader gets). Clicks nothing, sends nothing, accepts nothing.
 */
export const studyPagesAgent = defineAgent({
  key: 'linkedin.study-pages',
  platform: 'linkedin',
  name: 'Study LinkedIn Pages',
  description:
    'Read-only. Opens the pages the growth agents use and saves screenshots and page maps so selectors can be checked. Clicks nothing.',
  version: 1,
  inputSchema,
  quotaCost: { profile_view: 1 },
  readOnly: true,

  async execute(ctx, input) {
    const { page } = ctx;
    const studied: string[] = [];

    const chosen = PAGES.filter((p) => !input.pages || input.pages.includes(p.key));
    let own: string | undefined;
    for (const target of chosen) {
      if (ctx.signal.aborted) break;
      let url: string;
      if (typeof target.url === 'string') url = target.url;
      else {
        // /in/me/ redirects to the owner's real profile address.
        if (!own) {
          await page.goto(`${LINKEDIN_ORIGIN}/in/me/`, { waitUntil: 'domcontentloaded' });
          await assertSafeToContinue(page);
          own = `${LINKEDIN_ORIGIN}${/^\/in\/[^/]+\//.exec(new URL(page.url()).pathname)?.[0] ?? '/in/me/'}`;
        }
        url = target.url(own);
      }
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await assertSafeToContinue(page);
      if (typeof target.url !== 'string') {
        await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
        if ('open' in target) {
          const link = page.locator(target.open).first();
          await link.scrollIntoViewIfNeeded({ timeout: 10_000 });
          await link.hover();
          await page.waitForTimeout(500 + Math.random() * 700);
          await link.click();
          await page.getByRole('dialog').first().waitFor({ timeout: 15_000 }).catch(() => undefined);
          await page.waitForTimeout(1500);
        }
        // Forms open as a dialog: read it top and bottom.
        await page.mouse.move(720, 450);
        await ctx.captureArtifact('screenshot', `${target.name} (top)`);
        await page.mouse.wheel(0, 1500);
        await page.waitForTimeout(1200);
      }
      await study(ctx, target.name);
      studied.push(target.name);
      await ctx.pace();
    }

    // One stranger's profile shows where Connect / More / Follow sit.
    if (input.openOneProfile && chosen.some((p) => p.key === 'search') && !ctx.signal.aborted) {
      const href = await page
        .locator('main a[href*="/in/"]')
        .first()
        .getAttribute('href', { timeout: 5_000 })
        .catch(() => null);
      if (href) {
        const url = new URL(href, LINKEDIN_ORIGIN);
        await ctx.consumeQuota('profile_view');
        await page.goto(`${url.origin}${url.pathname}`, { waitUntil: 'domcontentloaded' });
        await assertSafeToContinue(page);
        await study(ctx, 'a profile from the search');
        studied.push('a profile from the search');
      } else {
        ctx.log('warn', 'No profile link found in the search results');
      }
    }

    return { processed: studied.length, skipped: 0, failed: 0, results: studied };
  },
});
