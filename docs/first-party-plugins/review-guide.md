# The review guide plugin

`plugins/review-guide` turns a task's primary change request into a guided review. The person picks
an agent harness, such as Claude Code or Codex. The harness reads the change in the task's worktree and
groups its hunks into sections in reading order, with core changes first and supporting changes, such
as tests, docs, and wiring, after them. Each section says why its change exists and shows its hunks.

It ships as a bundled loaded package, so it reaches the Node only through its manifest. It's part of
[first-party plugins](../first-party-plugins.md).

## What it reads

- The task's primary change request, through `tasks.changeRequests` to decide whether the pane has
  anything to show, and `tasks.changeRequestDetail` for its target branch
  ([code hosts](../plugins/code-hosts.md#agent-context)). GitHub, GitLab, and Bitbucket all work,
  because nothing after this step involves the code host.
- The task's worktree, through core's `git` facet. It fetches the target branch from `origin`, finds
  where HEAD leaves it with `git merge-base`, and runs `git diff` from there to HEAD with fixed prefixes
  and no external diff or text conversion. A failed fetch, such as offline, falls back to the last
  fetched copy of the branch.
- The profiles the person may pick from, through `agents.profiles`. With no saved choice it uses the
  first, which is the Agents plugin's default.

It asks for no network, no processes, and no secrets.

## What it spends

One managed agent turn per guide, through `agents.sessionExecute`
([running a turn from a plugin](../managed-agents/session-control.md#running-a-turn-from-a-plugin)). The
turn runs gated, with a read-only tool ceiling, so the harness's own permission checks stay on and it
can read the worktree but not change it.

The turn's context is one block that lists every hunk with its ID. Past 256 KiB of hunk text, each hunk
shows only its `@@` header, and the prompt tells the harness to read the files itself. The answer must
match a JSON schema: a summary, and sections with a title, a "why" in Markdown, a kind (`core` or
`supporting`), and hunk IDs in reading order. The prompt and the schema are in `src/server/prompt.ts`.

Generating is something the person starts. A new commit marks a guide stale and doesn't regenerate it.
A retry on the same commits with the same harness reuses its session.

## The coverage check

`checkCoverage` in `src/server/coverage.ts` holds the answer to the diff before anything is stored, so a
guide shows every hunk exactly once:

- A hunk in no section goes to **Not covered by the guide**, last, in file order.
- A hunk in two sections stays in the first.
- An ID that names no hunk is dropped.
- A section left with no hunks is dropped.

The pane shows a line for each count that isn't zero, such as "3 hunks weren't covered by the guide".
This is the reason a reviewer can trust a guide: it can arrange code, but it can't hide any.

A hunk's ID is its path and its position in the file, such as `src/billing/invoice.ts#2`. A binary file,
a pure rename, a mode change, or an empty file is one item with no hunk text, and the pane shows its
path and what changed. The parser is `parseDiff` in `src/server/diff.ts`.

## Storage

One table, `review_guides`, in the plugin's own database, keyed by task, base commit, and head commit.
A row holds the profile, the status, the checked guide as JSON, the error, the session ID, and its times.
A task keeps one guide: generating a new one removes the guide for any earlier commits. The rows of a
deleted task are removed.

| Status | Meaning |
| --- | --- |
| `generating` | The turn is running. A restart marks it `failed`, because a restart ends every turn |
| `ready` | The checked guide is stored |
| `failed` | The turn didn't answer, or the person stopped it. The pane shows the error and **Try again** |
| `stale` | `head:changed` named a different commit. A turn that finishes after HEAD moved stores `stale` too |

One generation runs per task at a time. A second request while one runs gets the running one.

## Routes

Each answers the pane's whole view: whether the task has a change request, the profiles, the chosen
profile, and the newest guide. A task-scoped caller is held to its own task.

| Route | What it does |
| --- | --- |
| `GET /v1/p/review-guide/guide?taskId=` | Reads the view |
| `POST /v1/p/review-guide/guide/generate` | `{ taskId, profileId? }`. Saves the profile, reads the change, and starts the turn |
| `POST /v1/p/review-guide/guide/stop` | `{ taskId }`. Aborts the running turn |

A status change sends `plugin:review-guide:changed`, and the pane reads the view again.

## The pane

**Guide** is a task pane drawn as a remote tree, so the desktop and the terminal client draw the same
one. Its header has the harness picker and **Generate guide**, **Regenerate**, or **Stop**. Each section
is a fold with its "why" and each hunk in `StackedDiff`. A tree batch is capped at 1 MiB, so the first
draw opens sections only until their hunk text reaches 256 KiB, and the rest open on demand. While a guide
generates, the pane links to the session's transcript through its `session` destination.

The same tree fills the `review-panel` point on GitHub, GitLab, and Bitbucket, so a task's change
request view has a **Guide** tab beside the diff
([shared review views](../plugins/change-request-ui.md#extension-points)). The pane stays for a task
with no change request view open.

## Limits

- Only the primary change request has a guide, because only it has a checkout.
- A diff larger than core's git output cap, 16 MiB, fails with a message instead of a partial guide.
- The guide covers the worktree's HEAD, which can differ from the change request's head when a commit
  hasn't been pushed.
