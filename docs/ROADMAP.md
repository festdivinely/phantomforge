# Roadmap

One phase at a time. A phase is done when it *runs*, not when the code exists.

---

## Phase 0 — Foundation ✅

Monorepo, Docker infra, Prisma schema, connector interfaces, quota governor,
docs, git. Nothing executes end to end yet — that is Phase 1's job.

---

## Phase 1 — Walking skeleton ⬅️ NEXT

**Goal:** click a button, watch a job run, see rows appear. No LinkedIn, no real browser.

- [ ] `pnpm install` clean, `pnpm typecheck` green
- [ ] `pnpm infra:up` → Postgres, Redis, MinIO healthy
- [ ] First Prisma migration applied, seed data in place
- [ ] Worker consumes from `pf:runs` and executes `mock.collect-profiles`
- [ ] Leads land in the `lead` table, deduplicated
- [ ] Run logs stream to the dashboard; run status transitions correctly
- [ ] Dashboard: list agents, trigger a run, watch it live, view results

**Why first:** this proves the entire spine — API → queue → worker → context →
agent → database → UI. Most clones skip it, build browser automation, and then
discover their platform cannot report on it. Do not skip it.

---

## Phase 2 — Identity vault

- [ ] Capture LinkedIn cookies (browser extension or manual `li_at` paste)
- [ ] Encrypt with `@pf/core/crypto`, store on `Identity`
- [ ] Worker decrypts and injects into the browser context
- [ ] `validateSession()` wired into the run lifecycle, status surfaced in UI
- [ ] Re-authentication flow when a session expires

---

## Phase 3 — First real agent (read-only)

- [ ] `linkedin.scrape-profile` — lowest risk, teaches the selector layer
- [ ] `selector_health` telemetry recorded on every resolve
- [ ] Screenshot artifact captured on unexpected DOM state
- [ ] Search-results pagination with checkpointing

---

## Phase 4 — Action agents

- [ ] `linkedin.send-connection` (replaces the current stub)
- [ ] `linkedin.withdraw-pending`
- [ ] `linkedin.accept-invitations` / `linkedin.reject-invitations`
- [ ] `linkedin.send-message`
- [ ] `linkedin.create-post`

Every one of these goes through the quota governor. No exceptions.

---

## Phase 5 — Quota governor + scheduler

- [ ] Per-org configurable limits, not just env defaults
- [ ] Warm-up ramping for new identities
- [ ] Cron schedules with timezone handling
- [ ] Quota dashboard: what is left today, per identity

---

## Phase 6 — Leads and export

- [ ] Lead list with filtering and search
- [ ] Campaigns: sequences of agents against a lead segment
- [ ] CSV export, webhook delivery
- [ ] Interaction timeline per lead

---

## Phase 7 — Hardening

- [ ] Full failure forensics (screenshot + DOM + HAR) uploaded to storage
- [ ] Retry policy tuned per error code
- [ ] Selector-health alerting
- [ ] Run cancellation mid-flight, verified
- [ ] Playwright test suite against the mock connector
