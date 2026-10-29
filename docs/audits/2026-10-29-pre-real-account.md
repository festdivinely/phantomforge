# Audit before the first real LinkedIn account — 2026-10-29

Scope: every server part that touches an account (quota governor, pacing,
worker run lifecycle, LinkedIn connector and selectors, identity vault, API
auth and routes, scheduler, posts, drafting). Everything was re-tested end to
end on the fake LinkedIn afterwards.

## Fixed

| # | Problem | Risk | Fix |
|---|---|---|---|
| 1 | Two runs could act on the same account at once (e.g. accept + withdraw, or any two jobs with concurrency 2) | Doubled action rate, two parallel sessions: a bot signature | Per-account lock in Redis; a second run waits and retries a minute later |
| 2 | Cancel only removed waiting jobs; a running job kept clicking and could finish as "succeeded" | No way to stop a run on a real account | Worker checks every 3 s and aborts; final states never overwrite a cancel; cancel on a finished run returns 409 |
| 3 | No weekly cap on connection requests | A daily limit alone (20/day) allows ~140/week, above LinkedIn's ~100 | Rolling 7-day cap, `QUOTA_CONNECTIONS_PER_WEEK=80` |
| 4 | No warm-up | Going from zero to full activity on day one is a classic automation pattern | Real accounts get 25% of limits in week 1, 50% week 2, 75% week 3, then 100% (fake account always 100%) |
| 5 | Quota day reset at midnight UTC | Limits and stats disagreed by an hour | Day is now the owner's day (`OWNER_TIMEZONE`) |
| 6 | LinkedIn's own warning pop-ups ("weekly invitation limit", "too many invitations", restricted) were not detected | Bot keeps clicking after LinkedIn says stop | `assertSafeToContinue()` after every navigation/action stops with `RATE_LIMITED` and alerts Telegram |
| 7 | A missing button ("selector not found") was retried 3 times automatically | Repeating odd navigation on a real account | No automatic retry; the owner fixes the selector first |
| 8 | The last Accept fallback matched any button labelled "Accept" | Could click a cookie banner or terms dialog | Every Accept strategy is tied to an invitation |
| 9 | "Screenshot on error" saved only a note, no picture | Real-account failures could not be diagnosed | Screenshots are saved to object storage (RustFS/S3) and viewable at `GET /api/runs/:id/artifacts/:artifactId` (owner token) |
| 10 | Runs could start on an account of the wrong platform, a write agent without an account, an unknown agent (500), or another org's account | Wrong account acted on | API rejects all four (400/404); worker refuses to start on any account that isn't `active` |
| 11 | Pacing delays were evenly random | Even jitter is itself a pattern | Skewed toward short pauses with a long tail, plus occasional "distracted" pauses |

## Verified (fake LinkedIn)

Wrong-platform / no-account / unknown-agent / wrong-org runs refused; two runs
on one account ran one after the other; a running 6-request job cancelled
after 1 request; read-only run without an account succeeded; quota and weekly
counters correct; a real screenshot saved and served (401 without token); the
LinkedIn guard stops on limit dialogs/toasts but not on normal pages or the
"Add a note" dialog; the Accept selector ignores a cookie-banner button.

## Not built yet (needed before real growth actions)

- **Remote login:** the owner logs in to LinkedIn in the server's own browser
  from the phone. Until then a real account can only be added by pasting
  cookies. Logging in through the server's browser also keeps the account's
  browser identity consistent; without a stored user agent, headless
  Chromium reports itself as "HeadlessChrome" (no spoofing will be added -
  the real browser is used instead).
- `linkedin.send-connection` (stub) - including the "Add a note" step and
  targeting rules: people who want to connect ("open to connect",
  #opentoconnect, LION, active networkers); leave out CEOs, founders, senior
  executives and tech professionals for now.
- `linkedin.withdraw-pending` (only the fake version exists).
- `linkedin.create-post` (official API vs browser still to decide).
- Selector-health telemetry dashboard.
