import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema';
import { UnrecoverableError, type Job } from 'bullmq';
import { draftingEnabled, draftingOffReason, env } from '@pf/config';
import { prisma } from '@pf/db';
import { enqueueDrafting, type DraftJobData } from '@pf/queue';
import { notifyOwner } from './telegram.js';

/**
 * Claude drafts LinkedIn posts in the owner's voice. Drafts are only ever
 * saved as `pending_approval`: the owner approves, edits or skips each one in
 * the phone app or Telegram, and only approved posts are published.
 *
 * Two engines (DRAFT_ENGINE): `claude-code` runs the Claude Code CLI logged in
 * with the owner's Claude subscription (no per-use cost; for the owner's own
 * accounts), `api` calls the Anthropic API with ANTHROPIC_API_KEY.
 */

const API_MODEL = 'claude-opus-5-5';
const MAX_POST_LENGTH = 3000;
const CLI_TIMEOUT_MS = 5 * 60_000;

interface DraftedPost {
  topic: string;
  text: string;
}

const DRAFTS_SCHEMA = {
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
} as const;

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

Variety: do not repeat the topics, openings or angles of the recent posts you are shown, and do not resemble the posts the owner skipped.

Reply only with the requested JSON.`;

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

// --- Engine: Claude Code CLI (owner's subscription) --------------------------

interface CliResult {
  is_error?: boolean;
  subtype?: string;
  result?: string;
  api_error_status?: number | null;
  structured_output?: { posts?: DraftedPost[] };
}

/** Runs `claude -p` with no tools: it can only write text back, nothing else. */
async function draftWithClaudeCode(prompt: string): Promise<DraftedPost[]> {
  // An empty folder, so the CLI picks up no project files or CLAUDE.md.
  const cwd = await mkdtemp(join(tmpdir(), 'pf-draft-'));
  // Without an API key in its environment, the CLI uses its claude.ai login.
  const childEnv = { ...process.env };
  delete childEnv.ANTHROPIC_API_KEY;
  delete childEnv.ANTHROPIC_AUTH_TOKEN;

  const args = [
    '-p',
    '--output-format', 'json',
    '--json-schema', JSON.stringify(DRAFTS_SCHEMA),
    '--system-prompt', SYSTEM_PROMPT,
    '--tools', '',
    '--strict-mcp-config',
    '--no-session-persistence',
  ];

  try {
    const { code, stdout, stderr } = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
      (resolve, reject) => {
        const child = spawn(env.CLAUDE_CLI, args, { cwd, env: childEnv, stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => child.kill(), CLI_TIMEOUT_MS);
        child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
        child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
        child.on('error', (error: NodeJS.ErrnoException) => {
          clearTimeout(timer);
          reject(
            error.code === 'ENOENT'
              ? new UnrecoverableError(`Claude Code isn't installed on the server (no "${env.CLAUDE_CLI}" command).`)
              : error,
          );
        });
        child.on('close', (exitCode) => {
          clearTimeout(timer);
          resolve({ code: exitCode, stdout, stderr });
        });
        // The prompt goes in through stdin: no command-line length limit.
        child.stdin.end(prompt);
      },
    );

    let parsed: CliResult | undefined;
    try {
      parsed = JSON.parse(stdout) as CliResult;
    } catch {
      parsed = undefined;
    }
    if (!parsed) {
      const detail = (stderr || stdout).trim().slice(0, 300);
      if (/log ?in|not logged|authenticat/i.test(detail)) {
        throw new UnrecoverableError('Claude Code on the server is not logged in. Run `claude` there once and log in.');
      }
      throw new Error(`Claude Code gave no answer (exit ${code}): ${detail || 'no output'}`);
    }
    if (parsed.is_error || parsed.subtype !== 'success') {
      const why = parsed.result ?? `error ${parsed.api_error_status ?? 'unknown'}`;
      // Usage limits reset within hours: let the queue retry later.
      if (/limit|rate|overloaded/i.test(why)) throw new Error(`Claude usage limit reached for now: ${why}`);
      throw new UnrecoverableError(`Claude Code could not draft: ${why}`);
    }
    const posts = parsed.structured_output?.posts;
    if (!Array.isArray(posts)) throw new Error("Claude Code's answer had no posts in it.");
    return posts;
  } finally {
    await rm(cwd, { recursive: true, force: true }).catch(() => undefined);
  }
}

// --- Engine: Anthropic API (per-use billing) ---------------------------------

let apiClient: Anthropic | undefined;

async function draftWithApi(prompt: string): Promise<DraftedPost[]> {
  if (!env.ANTHROPIC_API_KEY) throw new UnrecoverableError(draftingOffReason);
  apiClient ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  try {
    const response = await apiClient.beta.messages.parse({
      model: API_MODEL,
      max_tokens: 16000,
      // If a safety classifier declines, retry on the model Anthropic picks
      // for that case instead of failing the batch.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'high', format: jsonSchemaOutputFormat(DRAFTS_SCHEMA) },
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
  if (!draftingEnabled) throw new UnrecoverableError(draftingOffReason);
  const identity = await prisma.identity.findUnique({
    where: { id: identityId },
    select: { id: true, label: true, organizationId: true },
  });
  if (!identity) throw new UnrecoverableError('That account no longer exists.');

  const prompt = await buildPrompt(identityId, count, hint);
  const posts = env.DRAFT_ENGINE === 'api' ? await draftWithApi(prompt) : await draftWithClaudeCode(prompt);
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
  if (!draftingEnabled) {
    console.log(`Auto-drafting is disabled (${draftingOffReason})`);
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
  console.log(
    `Auto-drafting is enabled via ${env.DRAFT_ENGINE} (daily at ${env.DRAFT_HOUR}:00 ${env.OWNER_TIMEZONE})`,
  );
  return () => clearInterval(timer);
}
