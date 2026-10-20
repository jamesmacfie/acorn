# Phase 6: first-party triggers and acceptance

Date: October 20, 2026. Status: proposed. Needs phase 5.

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
