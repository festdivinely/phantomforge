# PhantomForge

A lead-automation platform — Phantombuster-shaped, built to be better than it.

Browser automation with an actual platform around it: a job queue, resumable
runs, a quota governor that treats account safety as a subsystem rather than a
checkbox, and a lead graph instead of a pile of CSVs.

> Personal learning project. See `docs/decisions/0003-browser-automation.md`
> for the account-risk considerations before pointing this at a real account.

## Quick start

```bash
pnpm install
pnpm browsers                       # fetch the Playwright chromium binary
node scripts/generate-secrets.mjs   # writes .env with generated secrets
pnpm infra:up                       # postgres + redis + rustfs storage (Docker must be RUNNING)
pnpm db:generate && pnpm db:migrate && pnpm db:seed
pnpm dev
```

- Dashboard: http://localhost:3000
- API: http://localhost:3001/health
- Storage (RustFS) console: http://localhost:9001 (phantomforge / phantomforge)

Requires Node 22+, pnpm 9+, and Docker Desktop.

## Layout

See `CLAUDE.md` for the full map and conventions, `docs/ARCHITECTURE.md` for how
a run flows through the system, and `docs/ROADMAP.md` for what is built and what
is next.
