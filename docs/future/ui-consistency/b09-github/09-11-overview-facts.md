# 09-11. The overview repeats reviewers and file counts, and leaves out the review decision

**Status:** not started. Batch B09. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

The overview facts are State, Author, Branch, Files, Updated, and Reviewers. The Reviewers section below
lists the same people, and the Files section header has the same count. What the facts do not say is
that one reviewer requested changes and another approved, or that a check is failing. Both answers sit
below the fold.

## Where to see it

GitHub with the area 09 seed › #42's overview.

## The fix

- `plugins/github/src/client/pullDetail/PrOverview.tsx:51-81`: facts become State, Author, Branch,
  Review, Checks, and Updated. Review is "Changes requested" (a danger `Badge`, reviewers named in its
  tip), "Approved", or "No reviews". Checks uses `checksSummary` from
  [09-2](./09-2-status-words.md). Drop Files and Reviewers.
- `prModel.ts`: `reviewDecision`, from each author's latest review, derived on the client.

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `PrOverview.tsx:78` | none requested | Remove | The Reviewers fact leaves. |
| (new) Review fact | (none) | Rewrite | Changes requested / Approved / No reviews |

## What earlier batches give you

- **`Badge tip`** (K3's P14), for naming the reviewers.

## Risk and checks

- Before you start, check the review data the client holds: it must include each review's author and
  state, in order.
- Screens: #42 (approved and changes-requested reviews) and #47 (no reviews).
- Tests: `plugins/github` (`PrOverview.test.tsx`, a `prModel` case for `reviewDecision`).
