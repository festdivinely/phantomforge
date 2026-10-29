# Roadmap

One phase at a time. A phase is done when it *runs*, not when the code exists.

## Goal (decided 2026-10-28)

PhantomForge exists to **grow one LinkedIn account's connections**: posting,
sending, accepting and withdrawing requests, everything that helps the account
grow. Lead collection is an optional extra, not the point. See
`decisions/0005-growth-focus.md`. Phases 3 onward are ordered by growth value,
lowest risk first.

Every phase is built and verified against the **mock connector first**, then
tried on the real account with low limits.

---

## Phase 0 — Foundation ✅

Monorepo, Docker infra, Prisma schema, connector interfaces, quota governor,
docs, git. Nothing executes end to end yet — that is Phase 1's job.

---

## Phase 1 — Walking skeleton ✅

**Goal:** click a button, watch a job run, see rows appear. No LinkedIn, no real browser.

- [x] `pnpm install` clean, `pnpm typecheck` green
- [x] `pnpm infra:up` → Postgres, Redis, MinIO healthy
- [x] First Prisma migration applied, seed data in place
- [x] Worker consumes from `pf-runs` and executes `mock.collect-profiles`
      (verified 2026-09-04: POST /api/runs -> queued -> succeeded, processed=5)
- [x] Leads land in the `lead` table
- [x] Run logs stream to the dashboard live (polling, verified 2026-09-04)
- [x] Dashboard: list agents, trigger a run, watch it live, view results
      (clicked through in a real browser: agent list -> Run -> live status
      polling -> auto-stopped at succeeded, exactly as designed)

**Phase 1 complete.**

**Why first:** this proves the entire spine — API → queue → worker → context →
agent → database → UI. Most clones skip it, build browser automation, and then
discover their platform cannot report on it. Do not skip it.

---

## Phase 2 — Identity vault ✅ (leftovers moved into Phase 3)

- [x] Capture LinkedIn cookies (manual `li_at` paste, via the dashboard)
- [x] Encrypt with `@pf/core/crypto`, store on `Identity`
- [x] Worker decrypts and injects into the browser context
- [x] `validateSession()` reachable from the UI (POST .../validate, polled)

**Verified working (mock identity, 2026-09-04).** A real LinkedIn login has
not been attempted yet - that's a deliberate, separate decision.

---

## Phase 3 — Auto-accept invitations (first real agent) ⬅️ NEXT

Lowest risk, instant growth: accept every incoming invitation on a schedule.

- [x] Phase 2 leftovers: pick a saved Identity in the trigger-a-run form
      (required for real platforms); expired / challenged / restricted
      identities explain what to do (2026-10-29)
- [x] `mock.accept-invitations` against the mock platform (verified
      2026-10-29: 8 pending, max 5 -> 5 accepted, 3 left for the next run)
- [x] `linkedin.accept-invitations` written (resilient selectors, quota
      `connection_accept`, stops on a click that doesn't land). Verified it
      stops at the login wall with AUTH_EXPIRED when there is no session;
      **not yet run on a real logged-in account**
- [x] Fixed: a session that fails to decrypt left the Run stuck at
      "running"; the seeded mock identity held undecryptable bytes; the dev
      org id is now fixed (`dev-org`) instead of random
- [ ] `selector_health` telemetry recorded on every resolve
- [ ] Screenshot artifact captured on unexpected DOM state (the record is
      written; uploading the actual image to storage is still a TODO)
- [x] Recurring schedules (2026-10-29): cron in the account's timezone
      (default `0 9,13,17 * * 1-5` Africa/Lagos - working hours, weekends
      off) plus a random 0..jitterMinutes delay so runs never start on the
      same minute; never stacks a run on one still going; skips accounts that
      aren't `active`. API: `/api/schedules`. Verified with the mock.
- [x] Every action is recorded as an `Activity`; a login wall or checkpoint
      mid-run marks the account `expired` / `challenged`, which pauses its
      schedules

---

## Phase 4 — Auto-withdraw old invitations

Unanswered invitations pile up and hurt the account. Withdraw them regularly.

- [ ] `linkedin.withdraw-pending`: withdraw sent invitations older than N days
      (default 21), quota `connection_withdraw`
- [ ] Remember each withdrawn person so they are not invited again soon

---

## Phase 5 — Targeted connection requests

Send to the people most likely to accept, staying under LinkedIn's limits.

- [ ] **Weekly** ceiling in the quota governor (LinkedIn caps invitations at
      roughly 100/week), not just daily; default ~15-20/day on weekdays
- [ ] Warm-up ramping: a new or quiet account starts low and rises over weeks
- [ ] Target sources, best first:
      1. people who liked or commented on our posts
      2. 2nd-degree connections in chosen locations (e.g. Nigeria) and
         industries, preferring profiles with fewer connections (they accept more)
- [ ] `linkedin.send-connection` (replaces the stub), optional short note
- [ ] Track the acceptance rate per target source; pause sending if it drops
      (many ignored or "I don't know this person" invitations lead to restrictions)

---

## Phase 6 — Daily posting

Good posts bring connections *to* the account - the safest growth of all.

- [x] Approval flow (2026-10-29): `PostDraft` with pending_approval ->
      approved / rejected -> publishing -> published / failed. API:
      `/api/posts`, `/api/posts/:id/approve` (text can be edited while
      approving), `/reject`. The scheduler publishes approved posts when due.
      Verified end to end with `mock.create-post`.
- [ ] Post drafts written by Claude from notes about the owner's topics
- [ ] `linkedin.create-post` (decide official LinkedIn API vs browser agent in
      a decision record first)
- [ ] Remember which posts got the most reactions, to guide future drafts

---

## Phase 7 — Growth dashboard

- [x] Stats API (2026-10-29): `/api/accounts/overview` (every account with
      today's numbers), `/api/accounts/:id/stats` (today / 7 / 30 days / all
      time per action, day-by-day series, quota left today, schedules,
      posts waiting), `/api/activity` (live feed, pageable, pollable)
- [ ] Daily snapshot per identity of totals only LinkedIn knows: connections,
      followers, pending invitations (needs a read agent)
- [ ] Acceptance rate (needs request -> accepted matching)

---

## Owner app (phone) + Telegram + remote login

The owner runs everything from a phone; the backend runs on a server.

- [x] **API authentication verified** - an owner
      bearer token now protects every route except `/health` and
      `/health/ready`, judged by the matched route (encoded paths like
      `/%61pi/...` no longer skip it). Bad input returns 400, not 500.
      Verified: 401 without the token and 200 with it. The local dashboard
      sends the token. Do not expose that dashboard through a tunnel because
      the token is included in its browser code.
- [ ] Cloudflare Tunnel so the phone reaches the server from anywhere
- [x] Telegram bot verified by the owner:
      owner-only post approvals with Approve / Edit / Skip buttons, daily
      per-account activity summaries, and urgent identity/quota alerts. Needs
      BotFather token and owner chat ID configured in `.env`; `/stats` and
      `/posts` both respond.
- [ ] Phone app (Expo): accounts list -> per-account activity and charts,
      live feed, post approvals
- [ ] Remote login: the phone shows the server's browser live; the owner
      types email / password / codes and solves any CAPTCHA by hand, so the
      session is created from the server's own location. Passwords are never
      stored.

---

## Phase 8 — Extras

- [ ] Short welcome message to new connections (owner-approved template)
- [ ] Lead list with filtering and search, CSV export, webhook delivery
- [ ] Campaigns: sequences of agents against a lead segment
- [ ] Interaction timeline per person

---

## Phase 9 — Hardening

- [ ] Per-identity configurable limits, not just env defaults
- [ ] Full failure forensics (screenshot + DOM + HAR) uploaded to storage
- [ ] Retry policy tuned per error code
- [ ] Selector-health alerting
- [ ] Run cancellation mid-flight, verified
- [ ] Playwright test suite against the mock connector

---

## Lines we do not cross

- Stay under LinkedIn's invitation limits. Raising a quota is a decision, never a default.
- No stealth tooling to beat LinkedIn's bot detection: no fingerprint spoofing,
  CAPTCHA solving, proxy rotation or extra fake accounts. If detection becomes
  a problem, the answer is lower limits.
- The account owner creates and logs in to the LinkedIn account and pastes the
  session cookie into the dashboard themselves.
