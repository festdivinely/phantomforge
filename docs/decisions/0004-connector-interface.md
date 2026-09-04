# 0004 — Connector/Agent interface and the mock-first workflow

**Status:** accepted · **Date:** 2026-09-04

## Context

Building automation directly against a live site is slow, flaky, rate-limited
and risky. Iterating on platform mechanics (queue, retries, checkpoints, UI)
while fighting a real DOM conflates two very different problems.

## Decision

All platform-specific behaviour sits behind `Connector`, and all automation
behind `Agent`. Agents receive `AgentContext` and nothing else — no database
handle, no queue, no filesystem.

A `mock` connector implements the same interfaces with deterministic fake data.
It is the default development target.

Agent manifests (`@pf/core`) are separated from agent execution
(`@pf/connectors`), so the API and web app can read agent metadata and render
input forms without depending on Playwright.

## Consequences

- The whole platform can be built and tested with zero bans and zero rate limits.
- Safety rules are enforced by the context the platform constructs, not trusted
  to each agent author.
- A new platform is a new folder implementing two interfaces — nothing else changes.
- Cost: one extra layer of indirection, and the mock must be kept honest. Worth it.
