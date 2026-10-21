# Phase 6: first-party triggers and acceptance

Date: October 20, 2026. Status: built on branch `phase-6-first-party-triggers`, not merged. Needs
phase 5.

## Completion note

Built October 21, 2026. Every shipped source the phase names suggests its triggers, GitLab and
Bitbucket call `changed()`, and the walks are recorded in
[the October 21 walk](../../testing/triggers-2026-10-21.md). The threshold walk passes through
`acme-alerts`. None of the four real-account walks ran.

### What landed

- **Suggested triggers.** GitHub pull requests: **A pull request asks for your review**, **A new pull
  request**, and **Checks fail on a pull request**, each on open pull requests. GitLab and Bitbucket:
  **A new merge request** and **A new pull request** only, because neither source has review
  requests or checks. Linear issues: **A new issue with a label**, with "Bug" as the label, and **An
  issue is assigned to you**. Rollbar error groups: **An error seen more than once**, at least 2 and
  active, and **A new error**. Workflow runs: **A run fails**. Agent sessions: **A session needs
  you**, as `attention` not equal to `none`. Each plugin's tests run `starterTriggerCheck` over the
  real description and expect nothing dropped.
- **Fields and operators.** Linear issues gain `team` (`/team/id` with `eq` and project-scoped
  choices, `/team/name`), `labels` (`contains`, choices by name), and `assignedToViewer`. The issue
  page reads `team`, `labels(first: 25)`, and `assignee { isMe }`, and `consistency` says what that
  costs. Rollbar's `totalOccurrences` takes `gt`, `gte`, `lt`, and `lte`, applied after the read.
  GitHub's `checks` takes `eq`.
- **Change signals.** `gitlabEmitter` and `bitbucketEmitter` call `changed('merge-requests')` and
  `changed('pull-requests')` beside `pulls-changed` and `pr-synced`, as `githubEmitter` does, with a
  test each.
- **Run titles.** Each Workflow runs record carries the workflow's name as its display title.
- **Two shapes in `acme-alerts`.** Beside the **Load alerts** feed, the example serves **Host load**,
  one record per host with its newest alert's load, which `src/hosts.ts` builds from the feed on each
  read through `ctx.dataSources.invoke`. It suggests **A host's load goes above 4** with **Starts
  matching**. The feed's suggestion is **A high-load alert arrives**, with **Is new**. The raise route
  calls `changed('hosts')`, so a host trigger checks within a second. Plugin triggers' `testTrigger`
  example runs over **Host load**, because a feed can't reuse a host's ID across reads.
- **Revisions.** GitHub pull requests go to 7, Linear issues to 3, and Rollbar error groups to 2.
  Rollbar's pages read the description's revision instead of a literal.
- **Docs.** Say when records changed and plugin triggers name Linear and Rollbar as sources with
  nothing to signal. The Workflow runs source section, workflow gaps (the file-trigger item points
  at [triggers](../../workflows/triggers.md)), the docs index, and the future index. On the site,
  **Start and schedule runs** describes **Start from a suggestion**. `sourceFields.json` is
  regenerated.

### Decisions and deviations

- **"Assigned to you" is its own field.** A suggestion's operands must be literals, so `assignee` is
  you can't be written. Linear reports `isMe` on each assignee, so `assignedToViewer` is a boolean,
  the way GitHub's `reviewRequestedFromViewer` is, and it costs no extra call. Only `true` narrows
  Linear's read.
- **`checks` isn't sent to search.** The phase said to add it to the search if `eq` was missing. A
  read-only check on real pull requests showed search's `status:` misses some whose combined state
  matches, so a qualifier would drop real matches. The exact check after the read decides, inside the
  250-match cap.
- **Label choices are workspace-wide.** The options list every label whose name matches, by name,
  once each, rather than filtering to the project's teams.
- **The run title was found live.** **A run fails** started a follow-up whose `issue` input was empty,
  because run records had no title. That's a field a useful trigger needs, so it's fixed here.
- **The 5-minute default was already there.** The dialog sets every suggestion to check every 5
  minutes, so nothing changed for Linear and Rollbar.
- **Host load is hand-written, not derived.** `defineDerivedSource` gives its fields no query
  operators, so the Node would drop a "load above 4" suggestion on it. A hand-written source that
  reads the feed and applies `gt`, `gte`, `lt`, and `lte` itself is about 130 lines. Letting a
  derived source declare operators would be an SDK change of its own.
- **Host records need a title too.** The first host walk started runs whose `issue` input was empty,
  the same gap the run records had. Neither source set a display title. The Node could fill one from
  a registration's `titlePointer` for every source, which would close the gap for third-party
  sources as well. That's broader than this phase, so each source sets its own.
- **The phase files stay.** The phase asks to remove them, but this note has to land in this file.
  Removing the folder, moving the future index row to **Completed plans removed**, and fixing the
  links into the folder are the last step after the phases merge.

### For whoever closes the programme

The row for **Completed plans removed**: owners are [triggers](../../workflows/triggers.md),
[say when records changed](../../data-sources/changes.md), [plugin triggers](../../plugin-authoring/triggers.md),
[event feeds](../../data-sources/event-feeds.md), and [schedules](../../schedules.md#policies) for
`wake`. Still open:

- The four real-account walks, each needing a change on a real service.
- A source that omits `display.title` leaves a trigger's `issue` input empty. The Node could fill the
  title from `titlePointer`.
- **A session needs you** wasn't walked. It needs a live agent session asking for attention.
- `docs/workflows/triggers.md` and `docs/plugin-authoring/triggers.md` hold the trigger behavior, so
  nothing needed moving out of the phase files.
- Service size: the Node's static graph is 1,930,369 bytes on this branch, under the 1,931,900
  ceiling. Phase 5 measured 1,929,849, so this phase adds about 520 bytes. The ceiling isn't raised.

## Goal

The plugins Acorn ships use the kit the way a third-party author would: suggested triggers on their
sources, `changed()` where they know their data changed, and the fields a useful trigger needs. Then
the examples that started this programme are checked end to end with real accounts.

## Starting point

- GitHub's `pull-requests` source has `reviewRequestedFromViewer`, `state`, and `checks`
  (`plugins/github/src/shared/pullSourceDescription.ts`). Its search reads up to 250 matches and
  returns nothing past that. Phase 3 wired its `changed()` call.
- GitLab and Bitbucket mirror change requests and emit `pulls-changed`, `pr-synced`, and
  `checks-changed`, with no `changed()` call yet.
- Linear's `issues` source has no labels or team field (`plugins/linear/src/shared/issueSource.ts`).
  It isn't incremental, and Linear has no mirror.
- Rollbar's `errors` source describes `totalOccurrences` with no query operators, so no filter can
  use it (`plugins/rollbar/src/shared/errorSource.ts`). Its `firstOccurrenceAt` and
  `lastOccurrenceAt` filters run after the read, over at most 5,000 items.
- The Workflow runs source filters `status` with `eq`. The agents `sessions` source filters
  `attention` with `eq` and `ne`.

## The design

### Suggested triggers

| Source | Suggestion | Filter | Rule |
| --- | --- | --- | --- |
| GitHub pull requests | A pull request asks for your review | `reviewRequestedFromViewer` is true, state open | Starts matching |
| GitHub pull requests | A new pull request | State open | New |
| GitHub pull requests | Checks fail on a pull request | `checks` is `FAILURE`, state open | Starts matching |
| GitLab and Bitbucket change requests | The same three, where the fields exist | | |
| Linear issues | A new issue with a label | `labels` contains a label the person picks | New |
| Linear issues | An issue is assigned to you | `assignee` is you | Starts matching |
| Rollbar errors | An error seen more than once | `totalOccurrences` at least 2, status active | Starts matching |
| Rollbar errors | A new error | Status active | New |
| Workflow runs | A run fails | `status` is `failed` | Starts matching |
| Agent sessions | A session needs you | `attention` is set | Starts matching |

A suggestion's literal, such as Rollbar's 2, is a starting value the person edits.

### Missing fields and operators

- **Linear.** Add `labels`, a list of label names with `contains` and dynamic choices, and `team`, with
  `eq` and dynamic choices. Read both on the issue list query the source already makes, and document
  the API cost in the source's `consistency`.
- **Rollbar.** Give `totalOccurrences` `gt`, `gte`, `lt`, and `lte`, applied after the read the way
  the first and last seen filters are, and say so in `consistency`.
- **GitHub.** Confirm `checks` accepts `eq`. If it doesn't, add it to the search the source builds.

### Change signals

GitLab and Bitbucket call `changed()` beside `pulls-changed` and `pr-synced`, as GitHub does. Linear
and Rollbar have no moment to signal, so their triggers run on the cadence. Their suggested triggers
default to checking every 5 minutes, and the authoring guide names them as the example of a source
with nothing to signal.

### Acceptance with real accounts

The person's own four examples, each on a real account in a `pnpm dev:agent` session:

1. **A Rollbar error seen twice** starts a triage workflow once, then again only after the error
   resolves and comes back.
2. **A new pull request** starts a review workflow within seconds of opening it on GitHub, through
   `changed()`, and within one cadence with the GitHub pane closed.
3. **A pull request asks for your review** starts a workflow when a teammate requests you, and again
   when they request you after you've reviewed.
4. **A new Linear issue with a label** starts a workflow within one cadence.

Then the threshold example through `acme-alerts`: a script raises load above 4 for `web-1`, the
workflow starts once, the load stays high for two more raises without another start, drops, rises,
and starts again.

Record each walk in `docs/testing/triggers-<date>.md`, with what wasn't checked.

### Close the programme

- Move the trigger behavior into reference pages, if earlier phases left any of it here.
- Remove the phase files, and list the programme under **Completed plans removed** in the
  [future index](../README.md), with its reference owners and anything still open.
- Point the file-trigger item in [workflow gaps](../workflows-gaps.md) at the trigger reference page.

## Steps

1. Add the fields and operators, each with a source test and a `consistency` update.
2. Add the suggested triggers, each with a test that runs `checkStarterTriggers` over its source's
   description.
3. Add the GitLab and Bitbucket `changed()` calls.
4. Run the walks and record them.
5. Close the programme.

## Acceptance

- Every shipped suggestion passes `checkStarterTriggers` and appears in the dialog for a project
  linked to that provider.
- The five walks above pass, or the record says which step failed and why.
- The phase files are gone, and the future index lists what's still open.
