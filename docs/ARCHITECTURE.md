# Architecture

## The five concepts

Everything else is CRUD around these.

| Concept | What it is |
|---|---|
| **Agent** | A reusable automation definition with an input schema. Code, not a database row. |
| **Identity** | A saved logged-in platform account: encrypted cookies, user agent, proxy. The most sensitive data we hold. |
| **Run** | One execution of one agent, with one identity, given specific input. Has status, logs, artifacts, checkpoint. |
| **Queue + Worker** | Runs never execute in a web request. They are enqueued; the worker owns the browser. |
| **Quota Governor** | Per-identity daily budgets and human pacing. A subsystem, not a setting. |

## How a run flows

```
POST /api/runs
      │  validate input against the agent's Zod schema
      ▼
  Run row (status: queued)
      │
      ▼
  BullMQ  pf:runs
      │
      ▼
  Worker
      ├── getAgent(agentKey) → getConnector(agent.platform)
      ├── decrypt identity cookies        (Phase 2)
      ├── connector.createBrowserContext()   one context per run, never shared
      ├── connector.validateSession()        stop early if expired/challenged
      ├── build AgentContext ─── quota · pacing · checkpoint · leads · artifacts
      ├── agent.execute(ctx, input)
      │        └── loop: consumeQuota → pace → act → saveCheckpoint
      └── finalise Run row, tear down context
```

## Why the boundaries sit where they do

**The API never drives a browser.** HTTP requests are short and cheap; browser
runs are long and fragile. Mixing them means one hung page load takes down the
API. The queue is the seam.

**Agents receive only `AgentContext`.** No Prisma client, no queue handle, no
filesystem. This is what lets an agent be developed against the mock connector
and later run against LinkedIn without changing a line of its logic — and it
means the safety rules are enforced by the platform, not trusted to each agent.

**`packages/core` has no Playwright and no database.** It is the vocabulary the
whole system shares. If a type needs a browser, it belongs in `connectors`.

**Packages ship TypeScript source.** No inter-package build step, so there is no
stale-`dist` class of bug and no build ordering to reason about.

## Where "better than Phantombuster" lives

- **Self-healing selectors** — every element is an ordered list of strategies,
  and which strategy wins is recorded in `selector_health`. A low-ranked
  fallback starting to win is an early warning that the platform redesigned,
  days before runs actually break.
- **Resumable runs** — a checkpoint after every item. An interrupted run of 500
  profiles resumes at 341 instead of starting over.
- **Failure forensics** — screenshot, DOM snapshot and HAR on failure, stored
  and viewable, rather than one log line.
- **A lead graph** — deduplicated people with interaction history, not a CSV per run.
- **Quota as a subsystem** — its own package, table and tests.
