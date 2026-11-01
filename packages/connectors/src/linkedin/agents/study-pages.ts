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
] as const;

const PAGE_KEYS = ['feed', 'own-profile', 'received', 'sent', 'network', 'search'] as const;

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
    for (const target of chosen) {
      if (ctx.signal.aborted) break;
      await page.goto(target.url, { waitUntil: 'domcontentloaded' });
      await assertSafeToContinue(page);
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
