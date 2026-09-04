# 0003 — Browser automation over official APIs

**Status:** accepted · **Date:** 2026-09-04

## Context

Two ways to reach a platform: official APIs, or driving a real logged-in browser.
LinkedIn's official API does not expose connection requests, invitation
management, or most of what makes this project interesting. API-only would mean
building something that cannot do the thing it exists to do.

## Decision

Browser automation with Playwright, driving stored logged-in sessions — the
Phantombuster approach.

## Consequences — read these

**Scripted connection requests violate LinkedIn's User Agreement.** Accounts
that trip detection get restricted or permanently banned. That is a real cost
borne by whoever's account it is.

Mitigations, all of them structural rather than optional:

1. **Develop against the mock connector.** The full pipeline — quota, pacing,
   checkpointing, partial failure — is exercised without touching a real site.
2. **Use a throwaway account** when testing the real connector. Not a primary one.
3. **The quota governor is load-bearing safety code**, with deliberately
   conservative defaults (20 connections/day, 8–25s jittered pacing). Raising
   them is a decision, not a default.
4. **Read-only agents first** (Phase 3) before any write agent (Phase 4).
5. **Pacing jitter is skewed, not uniform** — uniform delays are themselves a
   detectable fingerprint.

The safety work is also just good architecture, so it costs nothing to do properly.
