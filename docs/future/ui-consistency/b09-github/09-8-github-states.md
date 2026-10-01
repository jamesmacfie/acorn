# 09-8. GitHub's empty, loading, and error states: a mascot, corner text, and failures that say "none"

**Status:** not started. Batch B09. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

With nothing selected, the GitHub detail draws the ASCII acorn mascot, which reads as the app still
starting. The list says "No matching PRs." even with an empty filter. The Closed tab's failure is one
line with no reason and no retry. Three states say something false: a branch picker that fails says
"No matching branches.", a check run whose jobs fail to load says "No steps.", and the conflict alert
blames a missing checkout for a repository that is mapped.

## Where to see it

GitHub in the left rail with and without the area 09 seed: nothing selected, the filter with no match,
the Closed tab (it stays loading in the driver; judge the failure from code), #47 (empty sections), the
new pull request form, and the check run dialog.

## The fix

The partial fix. A `reason` on `PullConflicts` and the checks route answering an empty list on failure
are server and wire changes, deferred (see [deferred.md](../deferred.md)).

- `plugins/github/src/client/GithubBrowse.tsx:109`: the mascot becomes a centred `EmptyState`, "Choose
  a pull request".
- `GithubBrowse.tsx:43-44` and `browseScope.ts`: no project is centred and titled, and shown once.
- `PullList.tsx:216`: "No open pull requests." with no filter, "No pull requests match." with one.
- `PullList.tsx:200`: a titled failure with **Try again**, and **Reconnect GitHub** for reauth. Loading
  is one line.
- `PullDetail.tsx:72, 79`: "Couldn't find pull request #{n}.".
- `PrFiles.tsx:29`: "No changed files".
- `ComparePreview.tsx:51`: centred and titled.
- `CreatePullForm.tsx:113`: pass "Loading branches…" or "Couldn't load branches." through `Picker`'s
  existing `status`.
- `checks/ChecksPanel.tsx:70`: a neutral "This run has no steps.", and "Couldn't load this run's steps."
  when the request fails.
- `prSections.tsx:69`: one line above the linked-issue rows, with **Connect Linear** (opens Settings ›
  Services). Rows show only the issue id.

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `GithubBrowse.tsx:109` | (the acorn mascot) | Rewrite | Title: Choose a pull request |
| `browseScope.ts:40` | Select a project from the project menu to browse pull requests. | Rewrite | Title: Choose a project. Body: Pick one in the project menu to see its pull requests. |
| `browseScope.ts:41` | {name} has no GitHub remote. | Rewrite | Title: {name} isn't on GitHub. Body: Its folder has no GitHub remote, so there are no pull requests to show. |
| `PullList.tsx:200` | Failed to load PRs. | Rewrite | Couldn't load pull requests. Action **Try again**. One line serves both tabs (the plan's overrule on row 559). |
| `PullList.tsx:200` | Loading… | Keep | One line, `size="sm"`. |
| `PullList.tsx:204` | Not connected to GitHub | Rewrite | GitHub isn't connected |
| `PullList.tsx:207` | Connect GitHub | Keep | |
| `PullList.tsx:211` | This node has no GitHub credential, so it cannot list pull requests. | Rewrite | Connect GitHub to see this project's pull requests. |
| `PullList.tsx:216` | No matching PRs. | Rewrite | No filter: No open pull requests. With a filter: No pull requests match. |
| `PullList.tsx:124` | Could not create a task for this PR. | Rewrite | Couldn't create a task for this pull request. |
| `PullDetail.tsx:71` | Select a PR. | Rewrite | Choose a pull request (centred title) |
| `PullDetail.tsx:72, 79` | Not found. | Rewrite | Couldn't find pull request #{n}. |
| `PrOverview.tsx:154` | Merge conflicts | Rewrite | This branch has conflicts |
| `PrOverview.tsx:158` | Checking for conflicting files… | Keep | |
| `prSections.tsx:69` | Connect Linear to see titles. | Rewrite, one line above the rows | Connect Linear to see these issues' titles. Action **Connect Linear** |
| `PrFiles.tsx:29` | No files. | Rewrite | No changed files |
| `CreatePullForm.tsx:113` | No matching branches. | Rewrite | Loading branches… / Couldn't load branches. / No branches match. |
| `CreatePullForm.tsx:165`, `ComparePreview.tsx:55` | Nothing to compare — branches are identical. | Rewrite | These branches are the same, so there's nothing to merge. |
| `ComparePreview.tsx:51` | Pick a branch to compare. | Rewrite | Title: Choose a branch. Body: The changes it would merge show here. |
| `ChecksPanel.tsx:67` | Loading steps… | Keep | |
| `ChecksPanel.tsx:70` | Failed to load steps. | Rewrite | Couldn't load this run's steps. |
| `ChecksPanel.tsx:70` | No steps. | Rewrite | This run has no steps. |
| `PullRefPanel.tsx:56` | Not a pull request reference. / Could not load this pull request. | Rewrite | acorn can't read this pull request link. / Couldn't load this pull request. |

Held with the conflict `reason`: `PrOverview.tsx:159` ("Map this repository to a local checkout…"),
whose rewrite has one sentence per reason.

## What earlier batches give you

- **The empty-state rule** (K2's 00-9), in `docs/ui-design.md` § States.

## Risk and checks

- Before you start, check `Picker`'s `status` prop still exists and what it draws.
- A failing request may sit on "Loading…" forever in the driver. Judge failure states from code.
- Screens: nothing selected, filter no match, #47, the new pull request form, the check run dialog.
- Tests: `plugins/github`.
