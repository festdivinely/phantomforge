# 0006 — Draft posts with Claude Code on the owner's subscription; LinkedIn only

**Status:** accepted · **Date:** 2026-10-29

## Context

Claude writes the post drafts the owner approves. The Anthropic API bills per
use, and the owner wants to draft freely (up to ~20 drafts a day) without
running up costs. Ideas raised and rejected: driving the claude.ai chat with
n8n or OpenClaw (automated use of claude.ai is against Anthropic's terms and
can get the owner's Claude account suspended).

## Decision

- Default drafting engine is the **Claude Code CLI** (`claude -p`), logged in
  with the owner's Claude subscription. It is an official non-interactive mode
  billed to the plan's normal usage allowance, not per token.
- The CLI runs with **no tools** (`--tools ""`), no MCP servers, no saved
  session, in an empty temp folder, with structured JSON output. It can only
  return text.
- The API engine stays available (`DRAFT_ENGINE=api` + `ANTHROPIC_API_KEY`).
- **PhantomForge is LinkedIn-only.** Posting to WhatsApp, TikTok and other
  platforms (with Higgsfield and other AI tools) is a separate future project,
  likely on n8n.
- Safety rule for every platform action: stay within the platform's terms
  and post moderately (LinkedIn: 1-2 posts a day). Drafting many and
  publishing a few is the intended use.

## Consequences

- No per-draft cost. Drafting shares the subscription's usage allowance with
  the owner's other Claude use; when the limit is reached, the job retries
  later and the app/Telegram show the reason.
- The server needs Claude Code installed and logged in once (`claude`).
- Subscription use is for the owner's own accounts. If PhantomForge is ever
  sold to other people, their drafting must use the API engine.
