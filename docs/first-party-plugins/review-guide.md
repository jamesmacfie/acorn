# The review guide plugin

`plugins/review-guide` turns a task's primary change request into a guided review. The person picks
an agent harness, such as Claude Code or Codex. The harness reads the change in the task's worktree and
arranges its hunks as a path of steps in reading order, starting where the data or the request enters,
with core changes first and supporting changes, such as tests, docs, and wiring, after them. Each step
says what the reviewer will know after it and why its change exists, shows its hunks, and can pin a few
short notes to single lines.

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
- The Node's bound owner, through `identity`, for the workflow step. A run has no request to take a
  person from, so the step uses the owner's saved harness choice.

It asks for no network, no processes, and no secrets. Its tree has one frame scope,
`core.changeRequests:reveal`, for the hunk links.

## What it spends

One managed agent turn per guide, through `agents.sessionExecute`
([running a turn from a plugin](../managed-agents/session-control.md#running-a-turn-from-a-plugin)). The
turn runs gated, with a read-only tool ceiling, so the harness's own permission checks stay on and it
can read the worktree but not change it.

The turn's context is one block that lists every hunk with its ID. Past 256 KiB of hunk text, each hunk
shows only its `@@` header, and the prompt tells the harness to read the files itself. The answer must
match a JSON schema: a summary, and steps. The prompt and the schema are in `src/server/prompt.ts`.

| Step field | What it holds |
| --- | --- |
| `title` | A short title |
| `goal` | The words that finish "After this step you'll know". The coverage check drops those opening words when the harness repeats them |
| `why` | Markdown, one to three sentences on why the change exists |
| `kind` | `core` or `supporting` |
| `hunks` | Hunk IDs in reading order |
| `notes` | Notes on lines of this step's hunks, in reading order |

| Note field | What it holds |
| --- | --- |
| `hunk` | The ID of a hunk in the same step |
| `side` | `new` for an added or unchanged line, `old` for a deleted one |
| `line` | The line number on that side. A hint, not the anchor |
| `text` | The line's whole text, without its `+`, `-`, or space marker. The anchor |
| `tone` | `explain`, `attention`, or `risk`. The pane labels them **Explains**, **Look closely**, and **Risk** |
| `title` | One sentence, at most 120 characters |
| `body` | Markdown, at most 600 characters |

The prompt asks for a note only where a careful reviewer would stop, and says most hunks need none. The
schema sets no lengths or counts, because an answer that broke one would fail whole. The note check
enforces them instead.

Generating is something the person starts, from the pane or from a workflow they start that reaches
the step below. A new commit marks a guide stale and doesn't regenerate it. A retry on the same commits
with the same harness reuses its session.

## In a workflow

The `review-guide:generate` step kind runs the pane's generation for the run's task and waits until
the guide is ready, failed, or stopped
([contributed step kinds](../workflows/step-kinds.md#the-kinds-other-plugins-contribute)). The guide is
stored the same way, so it's in the **Guide** tab, and the coverage check and staleness apply unchanged.
A workflow that reviews a pull request can add it so the guide is ready when the person opens the pull
request:

```toml
[[steps]]
name = "guide"
kind = "review-guide:generate"

[steps.with]
profileId = "codex"
```

- `profileId` is optional. Its choices come from `GET /v1/p/review-guide/profiles`. Empty means the
  Node owner's saved choice, then the first profile, as in the pane. The step doesn't save its pick.
- If a guide is already generating for the task, the step waits for that one instead of starting
  another.
- `${steps.<name>.output}` is the guide's summary, then one `- ` line per step title.
- Stopping the step, such as cancelling the run, stops the turn the way **Stop** does.
- The turn's cost and token usage go into the step, so the run's `max_cost_usd` counts them.
- With no change request, no target branch, an empty diff, or a failed or stopped turn, the step fails
  with the sentence the pane shows.

## The coverage check

`checkCoverage` in `src/server/coverage.ts` holds the answer to the diff before anything is stored, so a
guide shows every hunk exactly once:

- A hunk in no step goes to **Not covered by the guide**, last, in file order.
- A hunk in two steps stays in the first.
- An ID that names no hunk is dropped.
- A step left with no hunks is dropped with its notes.

The pane shows a line for each count that isn't zero, such as "3 hunks weren't covered by the guide".
This is the reason a reviewer can trust a guide: it can arrange code, but it can't hide any.

A hunk's ID is its path and its position in the file, such as `src/billing/invoice.ts#2`. A binary file,
a pure rename, a mode change, or an empty file is one item with no hunk text, and the pane shows its
path and what changed. The parser is `parseDiff` in `src/server/diff.ts`.

## The note check

`checkNotes` in `src/server/notes.ts` runs right after the coverage check and holds each note to the
line it quotes, because harnesses misnumber lines and a note on the wrong line is worse than none. For
each note, in reading order:

1. It's dropped if its hunk isn't one of its step's hunks after the coverage check. A hunk in **Not
   covered by the guide** has no step, so its notes go with it.
2. It stays if the row at its side and line has its quoted text.
3. Otherwise it moves to the one row on that side with the quoted text. If no row or more than one row
   has it, it's dropped. Text compares after trimming trailing whitespace, and the old side holds only
   deleted rows.
4. It's dropped past three notes on one hunk, or past 40 in the guide.
5. A title over 120 characters or a body over 600 is cut at the last word that fits.

The count of dropped notes, including those that went with a dropped step, is `misplacedNotes` on the
guide, and the pane shows a line for it beside the coverage lines. Both the check and the pane read a
hunk's rows and line numbers with `hunkRows` and `hunkStart` in `src/shared/hunk.ts`.

## Storage

One table, `review_guides`, in the plugin's own database, keyed by task, base commit, and head commit.
A row holds the profile, the status, the checked guide as JSON, the error, the session ID, and its times.
A guide stored before steps had goals and notes holds `sections` instead of `steps`. It reads as steps
with an empty goal and no notes, so a guide the person already paid for still shows.
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

The three guide routes each answer the pane's whole view: whether the task has a change request, the profiles, the chosen
profile, and the newest guide. A task-scoped caller is held to its own task.

| Route | What it does |
| --- | --- |
| `GET /v1/p/review-guide/guide?taskId=` | Reads the view |
| `POST /v1/p/review-guide/guide/generate` | `{ taskId, profileId? }`. Saves the profile, reads the change, and starts the turn |
| `POST /v1/p/review-guide/guide/stop` | `{ taskId }`. Aborts the running turn |
| `GET /v1/p/review-guide/profiles` | `{ options: [{ value, label }] }`, the workflow step's harness choices. Not a view |

A status change sends `plugin:review-guide:changed`, and the pane reads the view again.

## The pane

**Guide** is a task pane drawn as a remote tree, so the desktop and the terminal client draw the same
one. Its header has the harness picker and **Generate guide**, **Regenerate**, or **Stop**. Each step
is a fold with its goal, its "why", and each hunk in `StackedDiff`, under a link named by its path and
first line, such as `src/billing/invoice.ts:42`. Under each hunk, its notes draw as a plain list: the
tone, the title, the line, and the body as Markdown. A hunk with no new side, such as a deleted file's, starts on its
old side, and its link shows only the path. Pressing a link opens the task's change request diff at that
line ([showing a line in the change request](../plugins/frames.md#showing-a-line-in-the-change-request)).
In the terminal client it opens the file in the editor instead.

A tree batch is capped at 1 MiB, so the first draw opens steps only until their hunk text reaches
256 KiB, and the rest open on demand. While a guide generates, the pane links to the session's
transcript through its `session` destination.

The same tree fills the `review-panel` point on GitHub, GitLab, and Bitbucket, so a task's change
request view has a **Guide** tab beside the diff
([shared review views](../plugins/change-request-ui.md#extension-points)). The pane stays for a task
with no change request view open.

## Limits

- Only the primary change request has a guide, because only it has a checkout.
- A diff larger than core's git output cap, 16 MiB, fails with a message instead of a partial guide.
- The guide covers the worktree's HEAD, which can differ from the change request's head when a commit
  hasn't been pushed. A hunk link whose line the change request's diff doesn't have lands on the
  file's header.
