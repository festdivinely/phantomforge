# LinkedIn page study - 2026-11-01

First `linkedin.study-pages` run on the owner's real account (read-only,
nothing clicked). Desktop layout, 1440x900. Screenshots and accessibility maps
are stored with the run's artifacts. Facts below are what the pages actually
showed; build agents against these, not against guesses.

## The account

- Brand new: **0 connections, 0 following**. Warm-up limits apply (first week
  at 25% of the daily caps). Expect LinkedIn to watch a new account closely.

## Received invitations (`/mynetwork/invitation-manager/received/`)

- Each invitation is a list item with `Ignore invitation for <name>` and
  `Accept invitation for <name>` buttons.
- **Not every invitation is a person.** The only one present was "LinkedIn
  invited you to subscribe to In the Loop" (a newsletter; its card links to
  `/newsletters/...` and `/company/...`). Accepting it would subscribe, not
  connect. `linkedin.accept-invitations` v2 accepts only cards that link to a
  person (`/in/...`) and leaves newsletters, pages, events and groups alone.
- A **"Focused (N)"** filter is on by default. Whether "All" shows more is not
  yet known - check it once people start sending invitations.
- Below the list: "Suggestions for you" with `Invite <name> to connect`
  buttons. Accept selectors never match these.

## Sent invitations (`/mynetwork/invitation-manager/sent/`)

- Empty: shows "No sent invitations". The Withdraw button could not be seen
  yet - study this page again once requests have been sent, before building
  `linkedin.withdraw-pending`.

## People search (`/search/results/people/?keywords=%23opentoconnect`)

- Results: `main` > list > list items. Each has the name link (`/in/<slug>`),
  "• 3rd+" degree, headline, location.
- The action is either a **Connect link** named `Invite <name> to connect`
  (href `/preload/search-custom-invite/?vanityName=<slug>`) or only a
  `Follow <name>` button (Connect hidden; skip these).
- Filters on the bar: People, 1st, 2nd, 3rd+, Locations, Current companies,
  All filters.
- Headlines include many founders / directors / developers - filter those out
  for the owner's targeting (peers who want to grow, not executives or tech
  professionals).
- What opens after clicking Connect (note dialog / send without a note) was
  not studied - nothing was clicked. The first real send must screenshot it.

## Profile (`/in/<slug>/`)

- Top card actions: `Invite <name> to connect` (a **link**), `Message`, and
  a `More` button. Also a separate `Follow <name>` button lower down.
- Right rail "More profiles for you" also carries Connect links - scope any
  Connect lookup to the top card, never the whole page.

## My Network (`/mynetwork/grow/`)

- Sections: "Invites received", "Follow suggestions for you", "Popular on
  LinkedIn", "Suggestions for you". Connect here is a **button** named
  `Invite <name> to connect`. Links "Show all invitations", "0 Connections",
  "0 Following".

## Feed (`/feed/`)

- `Start a post` button, then `Video` and `Photo` buttons. Posts are
  `heading "Feed post"` sections.

## No warnings

- No checkpoint, login wall, restriction or limit message on any page.
