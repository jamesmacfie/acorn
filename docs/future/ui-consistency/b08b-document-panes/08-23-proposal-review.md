# 08-23. The memory proposal review: four equal buttons and the machine's words

**Status:** not started. Batch B08b. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

When an agent suggests memory, the review shows **Approve**, **Edit**, **Dismiss**, and **Snooze** as
four equal outline sm buttons, so nothing marks **Approve** as the main action. A candidate shows its
raw status ("conflict", "applying"), and history rows print the action enum ("dismiss-reason"). The
update preview is a hand-built "--- / +++" string, though the kit has `StackedDiff`. Alerts put their
buttons in the body. Evidence rows print ids ("Managed turn {id}").

## Where to see it

The Memory page and Context's Memory section, when suggestions exist. It needs a review model to
render, so check it by test. From `plugins/memory/src/client/FindingsBundleReview.tsx`.

## The fix

In `plugins/memory/src/client/FindingsBundleReview.tsx`:

- `:88-99`: **Approve** solid; **Edit**, **Dismiss**, and **Snooze** ghost; all md.
- `:141, 170`: one label map for status and history words.
- `:47-51, 148`: `StackedDiff` for the update preview.
- `:206-213`: the alert buttons go in `actions`.
- `:205`: a plain count, not a `Badge`.
- History becomes a `SegmentedControl` **Waiting** | **History**.
- `:34-36, 219`: ids move into the tip.

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `:26-30` | Managed agent / … / Legacy proposal | Rewrite | Agent / Workflow / Schedule / This device / {plugin name} / Older suggestion |
| `:34-36, 219` | Managed turn {id} / Workflow {id} / Observation {id} | Rewrite | An agent turn / A workflow run / A finding (ids in the tip) |
| `:96, 97, 98` | Undo dismissal / Edit conflicted change / Retry approval | Rewrite | Undo / Fix the conflict / Try again |
| `:139` | Invalid memory candidate / This candidate cannot be previewed. | Rewrite | Can't show this suggestion |
| `:141` | {status} (raw) | Rewrite | Needs a fix (conflict) / Saving (applying) / Dismissed |
| `:146` | {groupingExplanation} · {n} source occurrence(s) | Rewrite | From {n} findings. {groupingExplanation} |
| `:148` | Update diff | Rewrite | What changes |
| `:161` | Snooze until date / Cancel snooze | Rewrite | Snooze / Cancel |
| `:170` | {action} (raw) | Rewrite | Approved / Edited / Dismissed / Snoozed / Restored, with the reason after |
| `:175` | Suggestion dismissed / Task-specific / Already covered / Not useful | Keep | |
| `:205` | History / Active suggestions | Rewrite | A segmented **Waiting** and **History** |
| `:206` | Could not prepare suggestions / Preparation failed. | Rewrite | Couldn't prepare suggestions / Something went wrong while preparing them. |
| `:207` | {n} observations remain. | Rewrite | {n} findings left to read. |
| `:208` | Preparation cancelled / Completed suggestions were kept. {n} observations remain. | Rewrite | Stopped / The suggestions so far are kept. {n} findings are left. |
| `:210-212` | Earlier unfiltered review / This bundle was prepared without a model and may contain one suggestion per observation. / Dismiss this bundle | Rewrite | Unfiltered suggestions / These were made without a model, so there can be one per finding. / Dismiss all of these |
| `:219` | Omitted observations / Restore to open change | Rewrite | Findings left out / Add back |
| `:222` | No memory suggestions are awaiting review. The latest review either found nothing durable or its suggestions have already been resolved. | Rewrite | Nothing to review. The last review found nothing worth keeping, or you've handled it all. |

The scope words at `:20` are [08-21](./08-21-memory-form.md)'s.

## What earlier batches give you

- **`pluginLabel`** (K5), from `@acorn/plugin-api/client`, for "{plugin name}". K5 noted
  `FindingsBundleReview.tsx:30` still prints an id.

## Risk and checks

- Before you start, find a test that renders the review with a candidate; extend it rather than
  driving the app.
- Never approve a suggestion in the app: approving writes memory.
- Tests: `plugins/memory`.
