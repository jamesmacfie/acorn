# 09-4. The merge box has no primary button, wraps, and offers the wrong verbs

**Status:** not started. Batch B09. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

Every button in the merge box is md outline, and **Merge** is outline with accent text, so nothing reads
as the main action. The box is a right-aligned actions toolbar in a 332-pixel column, so it wraps. A
draft still offers **Merge**, which GitHub refuses. The method repeats in the button label, "(squash)",
beside the select that says it. Merging is the most consequential click in this plugin.

## Where to see it

GitHub with the area 09 seed: #42 (open), #43 (draft), #44 (conflicting), #45 (blocked), #46
(auto-merge on).

## Already done

- K1a's 03-21 gave **Close** an armed label in the "{Verb} {thing}?" pattern.

## The fix

The partial fix. What a blocked pull request's primary is (**Merge when ready** turns on auto-merge,
which fails on repositories that do not allow it) is a product call, deferred (see
[deferred.md](../deferred.md)). The blocked state keeps today's behaviour.

In `plugins/github/src/client/pullDetail/PrOverview.tsx:103-150`, two left-aligned rows:

1. **Merge** solid, with the method `Select` beside it and no "(squash)" suffix. On a draft, **Ready for
   review** is the solid primary and there is no **Merge**. With conflicts, **Merge** is disabled with
   its tip.
2. **Convert to draft**, then **Close**, as ghost sm.

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `PrOverview.tsx:118` | Disable auto-merge | Rewrite | Turn off auto-merge |
| (new) auto-merge on | (none) | Rewrite | Merges on its own when checks pass. |
| `PrOverview.tsx:130` | Resolve merge conflicts before merging | Keep | |
| `PrOverview.tsx:132` | Merge | Keep | Solid. |
| `PrOverview.tsx:136` | Close? | Rewrite | Close pull request? |
| `PrOverview.tsx:143` | Ready for review / Convert to draft | Keep | |

Held with the blocked-state decision: `PrOverview.tsx:124` ("Enable auto-merge ({method})" → "Merge when
ready", with "Waiting for required reviews or checks." under it).

## Risk and checks

- Before you start, read how the box decides between **Merge** and **Enable auto-merge**.
- Screens: #42, #43, #44, #45, and #46.
- Tests: `plugins/github` (`PrOverview.test.tsx`).
