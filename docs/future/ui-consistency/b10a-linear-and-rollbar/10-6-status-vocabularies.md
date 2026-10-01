# 10-6. Three status vocabularies, and dashboards print raw ids

**Status:** not started. Batch B10a. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

Linear's detail draws the state as a `Chip` bordered in the team's own colour, so "In Progress" is
yellow and "Todo" white. Every priority is the same amber badge, so Urgent and Low look alike.
Rollbar's three badges are lower case and toned by a regex, so "active" is amber. Dashboards show a
grey dot and the raw id "active", though the source declares "Active". Status is what people scan
for, and the same idea changes shape and colour on every surface.

## Where to see it

Linear issue ACO-42 and Rollbar item #1042 with the area 10 seed; a dashboard panel of tasks on Home
(add one, and delete it after).

## The fix

One rule: a toned `Badge` with a sentence-case word.

- `plugins/linear/src/tree/LinearIssueView.tsx:141-151`: the state `Chip` becomes a `Badge` toned by
  `state.type`: triage `warn`, backlog and unstarted neutral, started `accent`, completed `ok`,
  canceled neutral (`Badge` has no muted tone). Keep the team's name for the word. Priority: urgent
  `danger`, high `warn`, the rest neutral. Put the helpers in `plugins/linear/src/shared/triage.ts`.
- `plugins/rollbar/src/tree/RollbarItemView.tsx:29-34, 63-67`: label maps for level and status, in
  place of the regex.
- `packages/dashboards-core/src/mapping.ts:266-270`: with no board columns, keep the source's declared
  `values`, and take field names from the source's labels.

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `RollbarItemView.tsx:64-66` | error / production / active | Rewrite | Error, Warning, Critical, Info. The environment stays as the user wrote it. Active, Resolved, Muted. |
| `LinearIssueView.tsx:141` | Ticket status (aria) | Rewrite | Issue status |

## Risk and checks

- Before you start, list Linear's state types and Rollbar's levels and statuses, so each has a word and
  a tone.
- The dashboards mapping change reaches every panel built from a source with a status. Check a table,
  list, board, and chart.
- Screens: ACO-42, #1042, and a Home panel of tasks.
- Tests: `plugins/linear`, `plugins/rollbar`, `packages/dashboards-core`.
