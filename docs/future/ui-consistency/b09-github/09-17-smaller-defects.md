# 09-17. Smaller GitHub defects

**Status:** not started. Batch B09. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

Six small defects in the pull request view. Each is local and small.

## Where to see it

GitHub with the area 09 seed › #42's labels, reviewers, conversation, the Closed tab, and the reference
panel (from code).

## Already done

- e. K1a's 08-2 rule keeps a file name's width in a row, and K3 routes the viewed box's `title` to the
  styled tip.
- h. K3 routes `Chip`'s `title` to the styled tip, so the branch chips no longer use the native tooltip.

## The fix

- **a.** `plugins/github/src/client/pullDetail/prSections.tsx:100, 168`: `Picker size="sm"`.
- **b.** `prSections.tsx:86` "No labels", `:154` "No reviewers".
- **c.** `Conversation.tsx:96`: a review's card stripe carries its tone (Approved `ok`, Changes
  requested `danger`). Commit cards have none.
- **d.** `Conversation.tsx:132`: remove "No written summary.".
- **f.** `PullList.tsx:319-325`: **Load more** is ghost sm.
- **g.** `PullRefPanel.tsx:62`: `Heading level={2}`.

## Copy

| Item | Where | Current text | Decision | New text |
| --- | --- | --- | --- | --- |
| b | `prSections.tsx:86` | None. | Rewrite | No labels |
| b | `prSections.tsx:154` | No reviewers requested. | Rewrite | No reviewers |
| | `prSections.tsx:101-103` | Add label… / Filter labels… / Loading labels… / No labels available. | Keep | |
| | `prSections.tsx:169-171` | Request review… / Filter people… / Loading people… / No one to request. | Keep | |
| d | `Conversation.tsx:132` | No written summary. | Remove | |
| | `Conversation.tsx:101` | No commit message. | Keep | |
| e | `PrFiles.tsx:62` | Mark viewed (native title) | Rewrite | Viewed, as the styled tip |
| e | `completeness.ts:9` | GitHub shows only the first {n} changed files of a comparison. This one may have more. | Keep | |
| e | `completeness.ts:12` | GitHub returned {n} of {total} changed files. The remaining files are outside the GitHub API limit. | Rewrite | GitHub sent {n} of {total} changed files, which is the most it sends for one pull request. |
| e | `completeness.ts:14` | GitHub may have more changed files than the {n} returned by its API. | Rewrite | GitHub might have more changed files than the {n} it sent. |

## Risk and checks

- Before you start, check `Card stripe` takes a tone.
- Screens: #42's labels, reviewers, files, conversation; the Closed tab's **Load more** (from code).
- Tests: `plugins/github`.
