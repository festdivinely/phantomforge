import Anthropic from '@anthropic-ai/sdk';
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema';
import { UnrecoverableError, type Job } from 'bullmq';
import { env } from '@pf/config';
import { prisma } from '@pf/db';
import { enqueueDrafting, type DraftJobData } from '@pf/queue';
import { notifyOwner } from './telegram.js';

/**
 * Claude drafts LinkedIn posts in the owner's voice. Drafts are only ever
 * saved as `pending_approval`: the owner approves, edits or skips each one in
 * the phone app or Telegram, and only approved posts are published.
 */

const MODEL = 'claude-opus-5-5';
const MAX_POST_LENGTH = 3000;

const DRAFTS_FORMAT = jsonSchemaOutputFormat({
  type: 'object',
  properties: {
    posts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          topic: { type: 'string', description: 'A few words naming what the post is about.' },
          text: { type: 'string', description: 'The full post, exactly as it would appear on LinkedIn.' },
        },
        required: ['topic', 'text'],
        additionalProperties: false,
      },
    },
  },
  required: ['posts'],
  additionalProperties: false,
} as const);

const SYSTEM_PROMPT = `You write LinkedIn posts for one person, in their own voice, to grow their network: posts that people in their audience want to read, react to and connect over.

How the posts must be:
- First person, as the account owner. Plain text only: LinkedIn shows no markdown, so no **bold**, no headings, no bullet symbols other than simple dashes or line breaks.
- Specific and useful: a lesson, an opinion with a reason, a short how-to, an observation from their field, or a genuine question. One idea per post.
- A strong first line, because LinkedIn only shows the first two lines before "see more".
- Usually 80-220 words, short paragraphs with blank lines between them. Vary length and format across the batch.
- At most three relevant hashtags, at the end, and only when they fit. Emojis only if the owner's tone or examples use them.
- End with a natural question or invitation to share views when it fits, never forced.

Honesty rules - these matter more than anything else:
- Never invent facts about the owner: no made-up jobs, clients, numbers, results, places, events or stories. Use only what the profile and their past posts say. When you have no real story, write an opinion, a lesson or a practical tip instead of a fake anecdote.
- No invented statistics or quotes. No engagement bait ("comment YES", "like if you agree", "agree?").
- Respect everything listed under "avoid".

Variety: do not repeat the topics, openings or angles of the recent posts you are shown, and do not resemble the posts the owner skipped.`;

function section(title: string, body: string | undefined): string {
  const text = body?.trim();
  return text ? `<${title}>\n${text}\n</${title}>` : `<${title}>(not given)</${title}>`;
}

async function buildPrompt(identityId: string, count: number, hint?: string): Promise<string> {
  const [profile, published, skipped, waiting] = await Promise.all([
    prisma.postingProfile.findUnique({ where: { identityId } }),
    prisma.postDraft.findMany({
      where: { identityId, status: { in: ['published', 'approved', 'publishing'] } },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { text: true },
    }),
    prisma.postDraft.findMany({
      where: { identityId, status: 'rejected', source: 'claude' },
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: { text: true },
    }),
    prisma.postDraft.findMany({
      where: { identityId, status: 'pending_approval' },
      select: { text: true },
    }),
  ]);
  if (!profile || !(profile.about.trim() || profile.topics.trim())) {
    throw new UnrecoverableError(
      'This account has no posting profile yet. Fill in at least "About you" or "Topics" in the app first.',
    );
  }

  const list = (posts: Array<{ text: string }>) =>
    posts.length ? posts.map((p, i) => `--- ${i + 1} ---\n${p.text}`).join('\n\n') : '';

  return [
    section('about_the_owner', profile.about),
    section('audience', profile.audience),
    section('topics', profile.topics),
    section('tone', profile.tone),
    section('avoid', profile.avoid),
    section('owner_example_posts', profile.examples),
    section('recent_posts', list([...waiting, ...published])),
    section('posts_the_owner_skipped', list(skipped)),
    hint?.trim() ? section('owner_request_for_this_batch', hint) : '',
    `Write ${count} different LinkedIn post${count > 1 ? 's' : ''} for this person.`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

let client: Anthropic | undefined;

async function askClaude(prompt: string) {
  if (!env.ANTHROPIC_API_KEY) {
    throw new UnrecoverableError('Drafting is off: ANTHROPIC_API_KEY is empty in the server .env.');
  }
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  try {
    const response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      // If a safety classifier declines, retry on the model Anthropic picks
      // for that case instead of failing the batch.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'high', format: DRAFTS_FORMAT },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    });
    if (response.stop_reason === 'refusal') {
      throw new UnrecoverableError('Claude declined to write these posts. Try different topics or a different request.');
    }
    if (!response.parsed_output) {
      throw new Error(`Claude's answer could not be read (stop reason: ${response.stop_reason}).`);
    }
    return response.parsed_output.posts;
  } catch (error) {
    // Most specific first. Wrong key or no credit won't fix itself: don't retry.
    if (error instanceof Anthropic.AuthenticationError) {
      throw new UnrecoverableError('The Anthropic API key was refused. Check ANTHROPIC_API_KEY in the server .env.');
    }
    if (error instanceof Anthropic.PermissionDeniedError) {
      throw new UnrecoverableError(`Anthropic refused access: ${error.message}`);
    }
    if (error instanceof Anthropic.BadRequestError) {
      throw new UnrecoverableError(`Anthropic rejected the request: ${error.message}`);
    }
    // Rate limits, overload and network errors: let BullMQ retry later.
    throw error;
  }
}

/** The draft queue's job handler. */
export async function executeDrafting(job: Job<DraftJobData>): Promise<number> {
  const { identityId, count, hint } = job.data;
  const identity = await prisma.identity.findUnique({
    where: { id: identityId },
    select: { id: true, label: true, organizationId: true },
  });
  if (!identity) throw new UnrecoverableError('That account no longer exists.');

  const posts = await askClaude(await buildPrompt(identityId, count, hint));
  const usable = posts
    .map((p) => p.text.trim())
    .filter((text) => text.length > 0 && text.length <= MAX_POST_LENGTH)
    .slice(0, count);
  if (usable.length === 0) throw new Error('Claude returned no usable drafts.');

  await prisma.postDraft.createMany({
    data: usable.map((text) => ({
      text,
      source: 'claude',
      organizationId: identity.organizationId,
      identityId,
    })),
  });
  await notifyOwner(
    `✍️ ${usable.length} new draft${usable.length > 1 ? 's' : ''} for ${identity.label} waiting for you. Open the app or send /posts.`,
  );
  return usable.length;
}

/**
 * Once a day at DRAFT_HOUR (owner's time), tops every auto-draft account up
 * to DRAFTS_WAITING Claude drafts. Never more: unanswered drafts stop it.
 */
export function startAutoDrafter(): () => void {
  if (!env.ANTHROPIC_API_KEY) {
    console.log('Auto-drafting is disabled (ANTHROPIC_API_KEY is empty)');
    return () => undefined;
  }
  let lastRunDay = '';
  const tick = async () => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: env.OWNER_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(new Date())
        .map((p) => [p.type, p.value]),
    );
    const day = `${parts.year}-${parts.month}-${parts.day}`;
    if (Number(parts.hour) !== env.DRAFT_HOUR || day === lastRunDay) return;
    lastRunDay = day;

    const profiles = await prisma.postingProfile.findMany({
      where: { autoDraft: true, identity: { status: 'active' } },
      select: { identityId: true },
    });
    for (const { identityId } of profiles) {
      const waiting = await prisma.postDraft.count({
        where: { identityId, source: 'claude', status: 'pending_approval' },
      });
      const missing = env.DRAFTS_WAITING - waiting;
      if (missing > 0) await enqueueDrafting({ identityId, count: missing, requestedBy: 'auto' });
    }
  };
  const timer = setInterval(() => {
    tick().catch((error: unknown) =>
      console.error('Auto-draft check failed:', error instanceof Error ? error.message : error),
    );
  }, 5 * 60_000);
  console.log(`Auto-drafting is enabled (daily at ${env.DRAFT_HOUR}:00 ${env.OWNER_TIMEZONE})`);
  return () => clearInterval(timer);
}
