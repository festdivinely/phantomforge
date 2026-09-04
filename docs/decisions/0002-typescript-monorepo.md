# 0002 — TypeScript monorepo with source-only internal packages

**Status:** accepted · **Date:** 2026-09-04

## Context

The system needs a web app, an HTTP API, a background worker and shared domain
logic. Python was a candidate (Divine knows it), but Playwright's primary
support, its ecosystem and its documentation are strongest in Node.

## Decision

One language — TypeScript — across web, API, worker and automation. pnpm
workspaces for linking, Turborepo for task orchestration.

Internal packages ship **TypeScript source**: `main` and `types` point at
`src/index.ts` with no build step. Consumers (Next.js via `transpilePackages`,
`tsx` for API and worker) compile them.

## Consequences

- No inter-package build ordering, no stale `dist/`, instant cross-package edits.
- Anything consuming these packages must be able to compile TS — fine for every
  current consumer. Publishing externally would require adding real builds.
- Strict compiler settings (`noUncheckedIndexedAccess`, `verbatimModuleSyntax`)
  are on from day one; retrofitting strictness later is far more painful.
