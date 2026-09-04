---
description: Scaffold a new connector agent following project conventions
---
Create a new agent. Arguments: $ARGUMENTS (format: `<platform> <agent-slug>`).

Follow the existing conventions exactly:
- File: `packages/connectors/src/<platform>/agents/<agent-slug>.ts`
- Use `defineAgent()` from `../../base/agent.js`
- Zod `inputSchema`, declared `quotaCost`, correct `readOnly` flag
- Honour the agent contract in `packages/connectors/src/base/agent.ts`:
  consumeQuota before each action, pace between actions, checkpoint after each
  item, check `ctx.signal.aborted` every iteration, throw typed errors only
- Register it in the connector's `index.ts`
- Use `resolveSelector()` with a resilient selector - never a raw locator

Read `packages/connectors/src/mock/agents/send-connection.ts` first as the reference implementation.
