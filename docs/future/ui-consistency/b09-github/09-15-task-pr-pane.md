# 09-15. The task's PR pane says the number twice and hides that a related pull is read-only

**Status:** not started. Batch B09. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

In a task's pull request pane, the related-pull strip says "#42" and the eyebrow under it says "#42"
again. A related pull is read-only, and nothing says so: the merge box and pickers just vanish.

## Where to see it

A task with a primary pull and related pulls, from the area 09 seed. Select a related pull in the
strip (a DOM `.click()` works where the driver's click does not).

## Already done

- K3 routes `Tabs`' `title` to the styled tip, so the strip tabs' explanations ("Parent of #42") show as
  styled tips.

## The fix

The partial fix. Moving the strip into the navigator's bar depends on 09-5's header bar, which is
deferred (see [deferred.md](../deferred.md)).

In `plugins/github/src/client/pullDetail/PrPane.tsx:39-127`:

- Drop the eyebrow when the strip shows.
- A read-only related pull shows one muted line under its facts: "Related pull request. Open it from its
  own task or the pull request list to act on it."

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| (new) read-only notice | (none) | Rewrite | Related pull request. Open it from its own task or the pull request list to act on it. |
| `prTabs.ts:181` | This repository has several mapped projects; create the task from the repository pull-request list. | Rewrite | More than one project uses this repository. Create the task from the pull request list. |
| `prTabs.ts:182` | Import or map this GitHub repository before creating a task. | Rewrite | Add this repository as a project first. |
| `prTabs.ts:184` | The pull request could not be loaded. | Rewrite | Couldn't load this pull request. |
| `prTabs.ts:185-186` | Loading the pull request branch… / Create a task for #{n} | Keep | |
| `taskPullTabs.ts:145-150` | Created by an agent in this task / Parent of #{n} / Child of #{n} / Mentioned in #{n}'s {surface} / Open in {title} / Open one of {n} linked tasks | Keep | Already the styled tip. |
| `taskPullTabs.ts:151` | Primary pull request / Related pull request | Rewrite | This task's pull request / Related pull request |

## Risk and checks

- Before you start, confirm how the pane knows a pull is read-only.
- Screens: the PR pane with the strip, primary selected, then a related pull selected.
- Tests: `plugins/github` (`PrPane.test.tsx`, `taskPullTabs.test.ts`).
