# Shared review views

This page covers `@acorn/change-request-ui`, the package of review views every code host plugin draws:
a change request's list, its overview and sections, its conversation, its diff with review threads,
and its checks. Read it before you add a code host or change one of those views. It's part of the
[plugin reference](../plugins.md).

## What it holds

The package is `packages/change-request-ui/`. It has two entrypoints:

| Entrypoint | What it exports |
| --- | --- |
| `@acorn/change-request-ui/model` | The neutral types, the check status vocabulary and roll-up, `reviewDecision`, `inlineReviewThreads`, `filterChangeRequests`, `branchReferenceCandidates`, and the two point declarations. No Solid, so a rail marker or a Node test can read it. |
| `@acorn/change-request-ui/views` | `createChangeRequestModel`, `ChangeRequestView`, `ChangeRequestOverview`, `changeRequestSections`, `ChangeRequestConversation`, `ChangeRequestDiff`, `ChecksPanel`, `ChangeRequestList`, and `useChangedFiles`. |

The views never fetch from a code host. Each plugin keeps its queries, mutations, routes, and query
keys, and maps its own records onto the neutral types. The one exception is Linear enrichment of the
**Linked issues** section, which goes through the host's ref resolution
(`refResolutionsOptions` in `@acorn/plugin-api/client`), as GitHub's pane did.

The GitHub and GitLab plugins draw from it. GitHub's mapper is
`plugins/github/src/client/changeRequest.ts`. GitLab's routes answer the neutral model directly, from
`plugins/gitlab/src/server/mirror/detail.ts`.

## The neutral model

The types are in `packages/change-request-ui/src/model/types.ts`. A change request has a number,
title, provider-rendered HTML body, state (`open`, `closed`, or `merged`), draft flag, author, and
branches. It has labels with a CSS color, reviews with a verdict, the people asked to review,
conversation comments, commits, checks, and threads pinned to a file, a side (`old` or `new`), and a
line.

A field one host lacks is optional, and the view hides what's absent:

- `autoMergeEnabled` and `mergeBlocked` drive GitHub's auto-merge controls. GitLab sends neither.
- `conflicting` says the source branch conflicts. A host that can list the files passes `conflicts`.
- A review's `changes-requested` verdict comes from GitHub only. GitLab approvals are `approved`.
- A check's `status` is one word from the table in `packages/change-request-ui/src/model/checkStatus.ts`,
  compared without case. GitHub's words are the table, and GitLab maps its job statuses onto them.
- A check's `runId` opens its log and re-runs it. GitHub's is a workflow run, and GitLab's is a job.
- A thread's `outdated` must be `false`, with a side and a line, before the diff places it.

## Build a model

`createChangeRequestModel(input)` returns the model every detail view reads. A plugin calls it inside
a reactive root it owns, one per change request, as `prModel` in
`plugins/github/src/client/pullDetail/prModel.ts` does. The input names:

- The scope: the repository's namespace as `owner` (a GitHub owner or a GitLab group path), its
  name as `repo`, the number, and the task when there is one.
- The host: its plugin id, label, noun (`pull request`), number prefix (`#`), avatar function, and a
  function that turns a failed write into a sentence. A failure with code `reauth` offers to reconnect.
- Accessors for the detail, the changed files, the people who can be mentioned, and the repository's
  labels.
- The diff document and its segment loader, which the conversation reads for thread snippets once a
  thread has a line to quote.
- The verbs. `comment`, the label and reviewer verbs, `close`, and `reopen` are required. `review`
  lists the review events the host has (`comment`, `approve`, `request-changes`). `merge` lists its
  merge methods. `autoMerge`, `setDraft`, `setViewed`, and `rerun` are optional, and the view draws no
  control for one that's missing.

`ChangeRequestView` draws the model as the kit's `Sections`: the overview as the header, the sections,
and the host's diff as the main region. The host passes its own diff, its own check panel, and an
optional header such as GitHub's strip of related pull requests.

`ChangeRequestDiff` takes a `DiffSource` without its threads, inline chat, or line opener, and adds
those. It maps `old` and `new` to the viewer's `LEFT` and `RIGHT`, opens an added line in the
`editor` pane, and anchors agent conversations to a line through the agents plugin's
`agents.inlineDiff` capability, which the host passes in.

`ChangeRequestList` draws the Open and Closed tabs, the filter, and one row per change request. The
host owns the reads, the search past the loaded pages, each row's checks, and the row menu.

## Extension points

Each code host opens its own `diff-line` and `summary-badges` points, so GitHub's are
`github:diff-line` and `github:summary-badges` and GitLab's are `gitlab:diff-line` and
`gitlab:summary-badges`. Register both with `changeRequestPoints(noun)`. `DIFF_LINE_KEY` is the
`diff-line` key, `file`, `line`, and `side`. A `summary-badges` contributor gets
`{ owner, repo, number }`, where `owner` is the repository's namespace. A contributor that wants every
host files the same code against each host's point
([cooperative extension points](./cooperative-extension-points.md)).

## Limits

- The terminal client draws these views through `apps/tui/src/roster.ts` and its kit aliases, as it
  drew GitHub's.
- A loaded plugin can't use the package. Loaded plugins draw remote trees, not Solid components.
- The browse source, the project importer, the reference panel, the push action, the create form, the
  commands, and the keybindings stay in each plugin.

## Why

A shared shape guessed from GitHub alone tilts toward GitHub, so the views moved here as the GitLab
plugin needed them, and the model keeps only what both hosts send. When a view needs something one host
does differently, the host passes a slot or a verb rather than the view branching on the host.
