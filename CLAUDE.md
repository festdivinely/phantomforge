# PhantomForge — project memory

Read this file first in every session. It is the contract between sessions.

## What this is

A Phantombuster-style lead-automation platform, built as a personal learning
project by Divine. Browser automation (Playwright) driving real logged-in
sessions. SaaS-shaped from day one: multi-user, orgs, auth. LinkedIn is the
first real target connector.

**The mental model that matters:** this is a *job execution platform* that
happens to use a browser. The browser automation is a plugin. The platform
around it — queue, workers, quota, checkpointing, observability — is the project.

## Current state

**Phase 2 (identity vault) — verified working**, mock platform only so far. Identity CRUD +
encryption (`apps/api/src/routes/identities.ts`), a dedicated validation
queue (`packages/queue`: `identityQueue`/`IDENTITY_QUEUE_NAME`), the worker's
`loadIdentitySession()` (`apps/worker/src/identity-session.ts`, the only
function that ever holds a plaintext cookie) and `executeIdentityValidation`,
and a dashboard page (`apps/web/app/identities`). The Run executor's old
`cookies: []` TODO is also closed - real Runs now load a real identity's
session when one is attached. Confirmed end to end with a mock identity
(create -> encrypt -> store -> validate -> decrypt -> real browser ->
"active"). A deliberately fake LinkedIn cookie was also tried and failed
cleanly (ERR_TOO_MANY_REDIRECTS, caught and recorded as `expired` with a
readable reason, no crash) - no real LinkedIn account has been attempted yet.

**Phase 0 (foundation) — verified working**, not just written. `pnpm install`,
`pnpm browsers`, `pnpm infra:up`, `pnpm db:migrate`, `pnpm db:seed`, and
`pnpm typecheck` (all 9 packages) all run clean on the dev machine.

**Phase 1 (walking skeleton) — spine proven, UI remaining.** Full pipeline
verified working end to end on 2026-09-04: POST /api/runs -> queued -> worker
picks it up -> mock.collect-profiles executes -> checkpoints -> 5 leads
written to Postgres -> status succeeded. Two bugs fixed along the way:
BullMQ rejects ':' in queue names (renamed pf:runs -> pf-runs), and Prisma's
CLI doesn't read the root .env on its own (wrapped packages/db scripts with
dotenv-cli). The trigger button + live status/log view in `apps/web` is now written
(`components/AgentList.tsx`, `app/runs/[id]/page.tsx`, `lib/api.ts`) but not
yet verified in a browser - that's the next thing to confirm.

`linkedin.send-connection` is a deliberate stub that throws; the mock agents
are the working reference.

## Stack

TypeScript everywhere, pnpm workspaces + Turborepo, Node 22+.

| Layer | Choice |
|---|---|
| Web | Next.js 15 App Router, Tailwind v4 |
| API | Fastify 5 + Zod |
| Worker | BullMQ + Playwright |
| DB | PostgreSQL + Prisma 6 |
| Queue/cache | Redis |
| Storage | S3-compatible (MinIO locally) |
| Auth | better-auth + organization plugin (not wired yet) |

Internal packages ship **TypeScript source**, not builds — `main` points at
`src/index.ts`. No build step between packages. Keep it that way.

## Layout

```
apps/web        Next.js dashboard
apps/api        Fastify REST — enqueues work, never executes it
apps/worker     the ONLY process that drives a browser
packages/core   domain types, errors, lead model, crypto. No Playwright, no DB.
packages/db     Prisma schema + client
packages/connectors
  base/         Connector + Agent interfaces, AgentContext, resilient selectors
  mock/         fake platform — develop against this
  linkedin/     real connector
packages/queue  BullMQ setup, job definitions
packages/quota  the quota governor
packages/config validated env (never read process.env directly)
infra/          docker-compose: postgres, redis, minio
docs/           ROADMAP, ARCHITECTURE, decisions/
```

## Non-negotiable conventions

1. **Never read `process.env` directly.** Import `env` from `@pf/config`.
2. **The API never runs automation.** It enqueues; the worker executes.
3. **Agents only touch `AgentContext`.** No database handle, no queue, no fs.
   That constraint is what makes agents testable against the mock.
4. **Every agent honours the contract** in `packages/connectors/src/base/agent.ts`:
   consumeQuota before each metered action · pace between actions · checkpoint
   after each item · check `ctx.signal.aborted` in every loop · throw typed
   `PhantomForgeError`, never a bare `Error`.
5. **Never a raw Playwright locator in an agent.** Use `resolveSelector()` with
   a `ResilientSelector`. Selectors live in `<platform>/selectors/`.
6. **One identity = one browser context.** Never share contexts between identities.
7. **Session cookies are encrypted at rest** (AES-256-GCM, `@pf/core/crypto`).
   Plaintext cookies never touch the database or a log line.
8. Files use `.js` extensions in relative imports (ESM + `verbatimModuleSyntax`).

## Why the quota governor exists

Scripted LinkedIn actions violate its User Agreement and can get accounts
restricted. Development happens against the **mock connector**; real runs use a
throwaway account; the governor's conservative defaults are the guard rail, not
a setting to raise casually. Treat `packages/quota` as load-bearing safety code.

## PROJECT_GUIDE.md — keep it updated, always

`PROJECT_GUIDE.md` is a plain-language explainer of this whole project for a
non-technical reader: what it is, what every folder and technology is for,
and a dated progress log of what's actually been built and verified.

**Update it in the same session as any meaningful change** — a new phase
completed, a new folder/package added, a technology swapped, a real bug found
and fixed, a new agent working end to end. Add a new dated entry at the top
of its progress log rather than editing old entries away. Skip it only for
pure refactors or typo fixes that a non-technical reader wouldn't care about.
This is a standing project convention, not a one-time request — every future
session follows it without being asked again.

## Working agreement with Divine

- Intermediate developer (JS, Python, React Native). Explain the *why* behind
  architectural choices; don't explain basic syntax.
- Wants token efficiency. Respect it:
  - Work one vertical slice per session.
  - Read files rather than asking for pastes.
  - Write decisions into `docs/decisions/` so they are re-read, not re-argued.
  - Update the "Current state" section above when a phase completes.
- Prompt when a decision is genuinely his to make; otherwise pick a sane default
  and say which default was picked.

## Commands

```bash
pnpm install            # once
pnpm browsers           # fetch Playwright chromium (separate from pnpm install)
node scripts/generate-secrets.mjs   # creates .env with real secrets
pnpm infra:up           # postgres + redis + minio
pnpm db:generate        # prisma client
pnpm db:migrate         # create/apply migrations
pnpm db:seed            # dev org, user, mock identity, sample agent config
pnpm dev                # web + api + worker via turbo
pnpm typecheck          # verification pass before any commit
```
