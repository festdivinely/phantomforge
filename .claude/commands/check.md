---
description: Run the full verification pass before committing
---
Run, in order, and report failures with the exact file and line:
1. `pnpm typecheck`
2. `pnpm lint`
3. `pnpm test`

If everything passes, summarise what changed since the last commit and propose a commit message. Do not commit without being asked.
