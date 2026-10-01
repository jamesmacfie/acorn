# 09-14. One thing, several names

**Status:** not started. Batch B09. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

The pull list is "Reviews" in its header and "Pull requests" everywhere else; the task pane is "PR
review". Making one is **+ New PR**, "New pull request", **Create pull request**, and **Open pull
request** in four places. The conversation section is "COMMENTS/COMMITS", and the Linear tickets
section is "Integrations". The row menu's **Create task** opens the task when one already exists, and
the related-pull strip's **+ Task** is a third spelling of that verb.

## Where to see it

GitHub in the left rail and a pull's sections (with the area 09 seed), the pane switcher in a task
with a pull request, and a pull row's menu.

## The fix

- `plugins/github/src/client/GithubBrowse.tsx:83` and `pullDetail/paneContribution.ts:19`: "Pull
  requests" for the list, "Pull request" for the pane.
- **New pull request** opens the form. In the list header it is **New**, with the full name as its tip
  ([09-7](./09-7-pull-list-rows.md)).
- `prSections.tsx:227`: "Conversation". `:206`: "Linked issues".
- `PullList.tsx:155`: **Open task** when `taskTracksRef` finds one, as two registrations with opposite
  `when` checks.
- `PrPane.tsx:117`: **+ Task** becomes **Create task**.
- **Open pull request** stays under the branch bar, because it starts from a branch.

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `GithubBrowse.tsx:119` | New pull request | Keep | |
| `PullList.tsx:155` | Create task | Rewrite | Open task, when one exists. Create task otherwise. |
| `PullDetail.tsx:101` | Refresh diff | Rewrite | Refresh pull request |
| `prSections.tsx:206` | Integrations | Rewrite | Linked issues |
| `prSections.tsx:227` | Comments/Commits | Rewrite | Conversation |
| `paneContribution.ts:19` | PR review | Rewrite | Pull request |
| `paneContribution.ts:21` | Overview, files & diff | Rewrite | Details, files, and diff |
| `PrPane.tsx:107` | Open creating agent session | Rewrite | Open the agent session that made this |
| `PrPane.tsx:117` | + Task / Creating… | Rewrite | Create task / Creating… |
| `pushActions.tsx:62, 72` | Open a pull request for this branch / Open pull request | Keep | |
| `PullRefPanel.tsx:97` | Open pull request | Keep | |

Held with 09-5 (deferred): `GithubBrowse.tsx:123`'s "Compare" header, which goes once the diff toolbar
is the column's header.

## What earlier batches give you

- **`taskTracksRef`** is the existing helper for "does a task already track this reference". Linear and
  Rollbar use the same two-registration pattern in [10-19](../b10a-linear-and-rollbar/10-19-task-panes.md).

## Risk and checks

- Before you start, search docs and tests for "PR review" and "Reviews"; some assert them, and
  `docs/github-integration.md` may quote them.
- Screens: the list header, a pull's section headers, the pane switcher, and the row menu on a pull
  with and without a task.
- Tests: `plugins/github`.
