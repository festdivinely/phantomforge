# 0005 — Goal: grow one LinkedIn account

**Status:** accepted · **Date:** 2026-10-28

## Context

PhantomForge started as a Phantombuster-style lead-automation platform. The
owner clarified that the real goal is different: grow his own LinkedIn
account's connections as fast as is safe - posting, sending, accepting and
withdrawing requests. Leads are a nice extra, not the point.

## Decision

Reorder the roadmap by growth value per unit of risk:
accept invitations → withdraw old invitations → targeted connection requests
(people who engaged with our posts, then 2nd-degree people in chosen
locations/industries with fewer connections) → daily owner-approved posts →
growth dashboard → extras (welcome messages, leads, export).

The platform spine (queue, worker, identity vault, quota governor, mock
connector) is unchanged and reused.

## Consequences

- LinkedIn caps invitations at roughly 100 per week, so "rapid" growth means
  using that budget on people likely to accept, plus content that brings
  inbound connections. The quota governor gains a **weekly** window.
- Scripted actions still violate LinkedIn's User Agreement (see 0003). Low
  limits, warm-up, and pausing on a falling acceptance rate are the guard rails.
- No stealth tooling (fingerprint spoofing, CAPTCHA solving, proxy rotation,
  fake accounts). If detection becomes a problem, the answer is lower limits.
- Every post is approved by the owner before publishing.
