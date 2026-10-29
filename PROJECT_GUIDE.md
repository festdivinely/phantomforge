# PhantomForge — Plain-Language Project Guide

**This file explains the whole project in plain English.** No coding
background required. If you want the terse, technical version for quick
reference, see `CLAUDE.md`. If you want quickstart commands, see `README.md`.
This file is different: it's meant to be readable by anyone, and it is kept
up to date every time something meaningful changes.

---

## 1. What is this, in one paragraph?

PhantomForge is a tool that automates repetitive social-media tasks —
specifically LinkedIn actions like sending connection requests, accepting or
rejecting invitations, and posting content — the same way a tool called
Phantombuster does. The goal is to build a version that works better: more
reliable, harder to break, safer for the account it's automating, and with
better visibility into what it's doing and why. It's a personal learning
project, not a commercial product (yet).

## 2. The big idea

It would be easy to think of this as "a script that clicks buttons on
LinkedIn." That undersells it badly. What we're actually building is closer
to a small factory:

- **A request comes in** — "send connection requests to these 20 people."
- **It goes on a waiting list** (a queue), instead of running immediately.
- **A dedicated worker** picks it up when it's ready, opens a real browser,
  logs in, and does the work — one careful, human-paced action at a time.
- **Everything is recorded** — what succeeded, what failed, screenshots if
  something went wrong, and a snapshot of progress after every single item,
  so if it gets interrupted at item 340 of 500, it picks up at 340 instead
  of starting over.
- **A budget system** stops it from doing too much too fast, because moving
  too quickly is how automated accounts get flagged or banned.

The browser automation (the part that actually clicks things on LinkedIn) is
genuinely the *smallest* part of this system in terms of engineering effort.
The waiting list, the worker, the record-keeping, and the budget system are
the real project. That's also what "better than Phantombuster" mostly means
in practice — Phantombuster is thin on exactly those parts.

## 3. Words used throughout this project

| Word | Plain-English meaning |
|---|---|
| **Agent** | A specific task the system knows how to do — e.g. "send a connection request," "collect profile info." Each one has a name, a description, and a list of what information it needs to run. |
| **Identity** | A saved, logged-in social media account (right now, LinkedIn) that an Agent acts on behalf of. Stored encrypted — nobody can read it just by looking at the database. |
| **Run** | One execution of one Agent — e.g. "send connection requests to these 20 people, right now." Has a status (waiting, running, done, failed) and a full history. |
| **Queue** | The waiting list. Runs sit here until a Worker is free to pick them up. This is what stops the website itself from getting bogged down doing slow browser work. |
| **Worker** | The one program that's actually allowed to open a browser and click things. It watches the queue and processes Runs one at a time (or a few at a time). |
| **Quota / Quota Governor** | The budget system. Limits how many connection requests, messages, etc. can happen per day per account, and adds random human-like pauses between actions. |
| **Lead** | A person the system has found or interacted with — their name, job title, LinkedIn profile, etc. Stored once per person even if multiple Agents encounter them, so you build a real contact list instead of a pile of duplicate spreadsheets. |
| **Selector** | The instructions for "find this specific button/box on the webpage." LinkedIn changes its page layout often, so instead of one fragile instruction, PhantomForge tries several fallback instructions in order, and remembers which one worked, to catch layout changes early. |
| **Mock connector** | A fake, pretend version of LinkedIn used for building and testing. It behaves like a real platform (returns fake people, can succeed or fail) without ever touching a real account. This is what we build and test against first, before ever pointing anything at a real LinkedIn account. |

## 4. What's in each folder, and why

```
phantomforge/
├─ apps/
│  ├─ web/       ← The website you look at (the dashboard)
│  ├─ api/       ← The "front desk" — receives requests, never does slow work itself
│  └─ worker/    ← The only part of the system that opens a real browser
│
├─ packages/
│  ├─ core/       ← Shared vocabulary/rules used everywhere else (see below)
│  ├─ db/         ← The database blueprint — every table, every column
│  ├─ connectors/ ← All the platform-specific code (LinkedIn, and the fake "mock" one)
│  ├─ queue/      ← The waiting-list system
│  ├─ quota/      ← The budget/safety system
│  └─ config/     ← Reads settings (like passwords and URLs) safely, once, for everyone
│
├─ infra/         ← Instructions for starting the supporting services (database etc.) locally
└─ docs/          ← Technical documentation and a log of major decisions
```

**Why split it up like this?** Two reasons a layman can verify for themselves:

1. **The website (`web`) never opens a browser itself.** If it did, one slow
   or stuck LinkedIn page would freeze the entire dashboard for everyone
   using it. Instead it just asks the `api` to queue the work, and the
   `worker` does the actual clicking, completely separately.
2. **The LinkedIn-specific code (`connectors`) is isolated from everything
   else.** Nothing in the queue, the database, or the website needs to know
   anything about how LinkedIn's website looks. That means adding a second
   platform later (X/Twitter, Instagram, whatever) is "write a new folder,"
   not "rewrite the system."

## 5. The tools and technologies used, and what each one is actually for

| Tool | What it's for, in plain terms |
|---|---|
| **TypeScript** | The programming language used for the entire project — website, server, and automation. Chosen so everything speaks the same language; no translation between parts. |
| **Next.js** | Builds the website/dashboard you see in your browser. |
| **Fastify** | Powers the "front desk" (`api`) — the part that receives requests like "start this run" and answers quickly. |
| **Playwright** | The actual browser-driving tool. It's what opens a real (or headless/invisible) Chrome browser, logs in, clicks buttons, and reads the page — used only inside `worker`. |
| **BullMQ** | The waiting-list (queue) software. Manages "what's next to run" and "how many things can run at once." |
| **PostgreSQL** | The permanent database — every Run, every Lead, every log line lives here. Think of it as the filing cabinet that remembers everything even after the computer restarts. |
| **Prisma** | The tool that lets the code talk to the database in a structured, checked way, instead of writing raw error-prone database commands by hand. |
| **Redis** | A very fast, temporary memory store. The queue (BullMQ) uses it to track what's waiting and what's in progress. |
| **MinIO** | Stores files — specifically screenshots and exported data — the way a cloud storage service like Dropbox would, but running on your own machine for now. |
| **better-auth** | Handles user accounts, logins, and organizations (so multiple people/teams can eventually use the same PhantomForge instance without seeing each other's data). |
| **Zod** | Checks that data is in the shape it's supposed to be before anything acts on it — e.g. making sure "how many people to connect with" is actually a number, not accidentally text. Catches bad input early instead of causing confusing errors later. |
| **pnpm + Turborepo** | Housekeeping tools. pnpm installs and organizes all the external code libraries this project depends on; Turborepo runs tasks (like "start everything" or "check everything for errors") across all the folders at once. |
| **Docker / Docker Compose** | Runs Postgres, Redis, and MinIO on your machine in self-contained little boxes, so you don't have to install and configure each one manually. One command starts all three. |

## 6. How a task actually runs, step by step (plain-language walkthrough)

1. You (or the dashboard) say: "run the agent that sends connection requests
   to these 20 people, using this LinkedIn account."
2. The **api** checks that the request makes sense (right number of people,
   valid input) and writes it to the database as a new **Run**, status
   "queued." It hands it to the **queue** and immediately replies "got it" —
   it does not wait around.
3. The **worker**, which is constantly watching the queue, picks up the Run
   when it's free.
4. The worker opens an isolated browser session using the saved, encrypted
   login for that account (the **Identity**).
5. It checks the login is still valid — not logged out, not showing a
   "please verify you're human" screen.
6. It runs the requested **Agent**'s code, which, for each person:
   - asks the **Quota Governor**, "am I still within today's budget?" — stops
     immediately if not
   - waits a randomized, human-like pause
   - performs the action (e.g. clicks Connect)
   - saves progress (a **checkpoint**) so an interruption doesn't lose work
7. Once done (or if it hits an error), the worker records the final result,
   any people discovered along the way go into the **Lead** list, and the
   Run's status updates to "succeeded" or "failed."
8. You can see all of this — the status, the logs, the results — through
   the dashboard (once that part is built) or by asking the api directly.

## 7. Progress log

*(Newest entries at the top. Each session adds to this rather than replacing it.)*

**2026-10-29 — First growth agent: accept invitations.**
PhantomForge can now accept incoming LinkedIn invitations automatically.
- On the fake LinkedIn it works start to finish: with 8 invitations waiting
  and a limit of 5 per run, it accepted 5, human-paced, and left 3 for the
  next run.
- The real LinkedIn version is written. It opens the "invitations received"
  page, accepts one at a time with the safety budget and pauses, and stops
  straight away if a click doesn't go through or LinkedIn asks for
  verification. Tested without a login, it stopped at LinkedIn's login page
  with a clear "session expired" message and clicked nothing. It has not
  been tried on a real logged-in account yet.
- The dashboard now asks which account a run should use (real LinkedIn
  runs require one), and explains what to do when an account's login has
  expired or LinkedIn wants verification.
- Three bugs fixed: a run whose saved login couldn't be unlocked stayed
  "running" forever instead of failing; the built-in test account had a
  scrambled login that couldn't be unlocked; and the dashboard's workspace
  id only matched the old PC's database.

**2026-10-29 — Running on the main PC; file storage swapped.**
Docker was installed on the main PC and the whole system started there.
MinIO (the file-storage box) no longer publishes its Docker images, so it
was replaced with RustFS, which works the same way (same address, same
login, no code changes). Database tables and starter data were set up, and a
test run against the fake LinkedIn succeeded: 5 profiles processed, 0 failed.

**2026-10-28 — New goal: grow one LinkedIn account.**
The owner made the goal clear: PhantomForge is for growing his own LinkedIn
account's connections, not mainly for collecting leads. The plan was
reordered to match, most useful and safest first:
1. Accept incoming invitations automatically, on a schedule.
2. Withdraw old unanswered invitations (too many pending ones hurt the account).
3. Send connection requests to people likely to accept - people who reacted
   to our posts first, then people in chosen places (like Nigeria) and
   industries with fewer connections - while staying under LinkedIn's limit
   of roughly 100 invitations a week.
4. Publish a good post every day; Claude drafts, the owner approves each one.
5. A growth dashboard: connections, followers, pending invitations and
   acceptance rate over time.
Lead lists and exports stay as optional extras later. Nothing already built
changes - the queue, worker, login vault and safety budget are all reused.
The project was also moved from the external disk to the main PC and backed
up to a private GitHub repository; it installs and type-checks cleanly there.

**2026-09-04 — Phase 2 (Identity vault) verified working.**
Added the ability to save a real logged-in account for the system to act
through, safely. Specifically:
- A new "Identities" page in the dashboard: add an account, paste its
  session cookie, give it a label.
- The cookie is encrypted the instant it arrives at the server, before it
  ever touches the database - even someone with direct database access
  can't read it without the separate encryption key.
- A "Validate" button opens a real, invisible browser using that saved
  login and checks whether it's still logged in - the first time this
  project has driven a real browser with a real session, rather than the
  fake ("mock") platform.
- Still no real LinkedIn *actions* yet (connecting, messaging, posting) -
  this phase only proves login storage and checking work. That's next.
Clicked through in the real dashboard: saved a test identity, clicked
Validate, watched a real (invisible) browser open with the saved login and
report back "active" within a couple seconds. Along the way, also tried a
deliberately fake LinkedIn login to see what happens - it failed exactly as
it should (a clear, readable error saved to that identity, no crash), which
is a good sign the failure-handling is solid before anything real is ever
attempted against LinkedIn.

**2026-09-04 — Phase 1 complete: the dashboard works, tested in a real browser.**
Opened the website, clicked "Run" on the mock profile-collector, and watched
it go from queued to running to succeeded live, with logs appearing and the
processed count updating, entirely by clicking - no typed commands. The page
correctly stopped refreshing itself the moment the run finished. This is the
first "walking skeleton" milestone fully closed: request a task, watch it
happen, see the result, start to finish, through the actual website.

**2026-09-04 — Foundation built and the full pipeline proven working.**
Everything above exists and runs. Specifically verified today:
- The project installs cleanly and every package passes its type-checking
- The three supporting services (database, queue memory-store, file storage)
  start correctly via Docker
- The database tables were created and starter data was added
- **A real end-to-end test succeeded**: a request was sent to the api asking
  it to "collect 5 fake profiles," it was queued, the worker picked it up,
  ran the task against the fake ("mock") platform, saved 5 people to the
  Lead list, checkpointed its progress the whole way, and marked itself
  "succeeded." This proves the entire system's plumbing works correctly.
- Two real bugs were found and fixed along the way: the queue software
  rejected a colon character in its name, and the database tool wasn't
  finding the file with passwords/settings in it (a config-lookup gap
  between the root of the project and a subfolder).
- **Not yet built:** the actual LinkedIn connection (still using the fake
  platform for safety and speed of testing), and a way to trigger/watch
  runs from the dashboard itself rather than typing commands.

**2026-09-04 — Project created.**
Folder structure, every technology choice, the database blueprint, the
safety/budget system, and all the documentation were put in place. Nothing
had been run yet — that happened later the same day (see above).

## 8. What's being worked on right now

Automatically accepting incoming LinkedIn invitations (Phase 3) - built and
tested on the fake LinkedIn first, then tried carefully on the real account.
It also finishes two small login-vault leftovers: choosing which saved
account a Run uses, and showing clearly when a login has expired.

## 9. What's next after that

In order: withdrawing old invitations → sending connection requests to
people likely to accept → daily owner-approved posts → a growth dashboard →
extras like welcome messages and lead lists. The full checklist is in
`docs/ROADMAP.md`.

---

*Maintained by Claude alongside the code. If something in here goes stale,
say so — it gets corrected immediately, the same way a bug would.*
