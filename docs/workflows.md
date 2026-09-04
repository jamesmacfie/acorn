# Workflows

Workflows are durable Node orchestration defined in `.acorn/workflows/*.toml`. The file is the source
of definitions; SQLite stores expanded runs, steps, gates, trigger cursors, and recovery state.

## Execution model

The workflow loader parses and validates a definition, rejects cycles, expands static branches, and
checks the exact repository configuration trust snapshot before starting a run. Steps can invoke
managed agent sessions, terminal/run targets, GitHub checks policies, or human gates. Structured step
output is the only value that controls branching and joins; transcript prose cannot satisfy a gate.

Runs and steps persist state transitions. A restart reconciles persisted operation IDs and never
blindly repeats an external side effect with unknown outcome. Ambiguous work parks in an explicit
recovery/gated state. Cancellation propagates to child sessions and process groups.

A step that fans out into parallel branches creates each branch as a child task under the workflow's
own task, through `CoreServices.tasks.createChild()`. `resolveCwd()` creates the child's worktree
lazily, when its first step runs, the same path every other task-worktree consumer takes. Cancelling
one branch calls `CoreServices.tasks.cancel()`, a separate verb from the general task lifecycle so a
plugin cannot use this seam to archive or restore a task outside core's own routes. A child's
proposed branch name is checked against every task, not only its siblings, because a worktree is
keyed on the branch and a collision with an unrelated task would hand two tasks one checkout.

Workflow files load from the repo checkout or worktree and layer over `~/.acorn/workflows` the same
way `config.toml` layers repo before user, so a repo-defined id wins over a user one. A step can
reference another workflow by id. The reference expands inline, one level of nesting, and a chain
that revisits an id is rejected as a cycle rather than followed into a hang. A malformed file
surfaces as an error row instead of being skipped silently.

## Limits and capabilities

The runtime enforces workspace/provider concurrency ceilings, per-step tool ceilings, time budgets,
and task ownership. Agent steps use the agents capability; run targets use terminal capabilities;
GitHub checks are optional. A disabled provider leaves the corresponding step unavailable and visible
as a problem rather than silently selecting another implementation.

## Contributed step kinds

The seven built-in kinds — `agent`, `gate-human`, `gate-policy`, `ci-loop`, `fan-out`, `join`,
`decide` — are not all there can be. Workflows opens three node extension points
([plugins.md](./plugins.md) § Node-side extension points) and any plugin may fill them:

| Point | What it adds | Named in a file as |
| --- | --- | --- |
| `workflows:step-kind` | a kind the runner dispatches to | a step's `kind` |
| `workflows:policy` | a verdict source for `gate-policy` | a step's `policy` |
| `workflows:trigger` | something that decides which workflows should start | nothing; the sweep asks it |

**A contributed kind is addressed by its qualified id, a built-in by a bare word.** `kind = "agent"`
is the built-in; `kind = "http:request"` is the http plugin's. That is deliberate: the file says which
package will run the step, and two plugins can both call their entry `request` without either
shadowing the other.

A contributed kind's inputs go in `[steps.with]`, an opaque table the runner passes through unread.
The contributing plugin validates it — at load time, so a bad step is a red row in the workflow list
rather than a run that starts and fails on its third step — and reads it in its handler. Built-in
kinds do not use `with`; their inputs are named fields, which is what keeps them checkable by the
host.

The worked example is `http:request`, contributed by the http plugin, where the post-interpolation
scheme check, the 5 MB response cap and the project's variable layers already live
([http-client.md](./http-client.md)):

```toml
[[steps]]
name = "notify"
kind = "http:request"

[steps.with]
method = "POST"
url = "{{deploy_hook}}"
body = '{"ref": "{{branch}}"}'
```

4xx and 5xx are *answers*, not failures: the step succeeds so a later `decide` can branch on the
status. Only a transport failure, a bad URL, or a smuggled scheme fails the step. An unattended send
writes an audit row ([security.md](./security.md) § The vocabulary is closed) carrying the target's
origin and not the URL, because a query string is where a token ends up when someone puts one there.

## Triggers

A trigger contributed to `workflows:trigger` is asked, on each sweep, which workflows should start.
The sweep runs on **the node's** scheduler at the plugin cadence floor (300s), not on a client clock,
so a trigger fires on a machine nobody is looking at — which was the whole point, and was not true
until 2026-08-28: the sweep used to be a client schedule that skipped ticks while the window was
hidden and never ran at all on a node with no client attached.

There is no separate "check now" route. It is the scheduler's own run-now on Settings → Schedules,
which every schedule already has.

## Routes and UI

Node routes are under `/v2/p/workflows/` and core task run-target routes under
`/v2/core/tasks/:id/run/*`. The desktop contributes Settings inspection/problems, one command-palette
search, task activity, gate controls, and attention items. Workflow notices use `/v2/events`; durable
run history is paged from the plugin database.

## From the command palette

One row at the palette root, **Run a workflow**, registered by this plugin's client half
(`plugins/workflows/src/client/commands.ts`). It is a `search` over the definitions this task's
repository commits: a row carries the workflow's name and its step count, a parse or cycle error is a
badged row at the top of the list rather than a row that is quietly missing, and picking a definition
starts it. There is no group, because one row does not need one.
[command-palette-and-shortcuts.md](./command-palette-and-shortcuts.md) covers how the palette runs a
search, and [plugins.md](./plugins.md) § Command kinds holds the vocabulary.

The command is task-scoped and gated on the terminal plugin, because the runner is a node engine and
these routes answer 503 on a node that does not run terminals. Definitions load once when the frame
opens and are filtered on the device after that, through the same load-once adapter the terminal's
searches use (`client-core/host/registries/commands/localSearch.ts`): no debounce and no minimum
query, because a read of the repository is not something a keystroke moves. Starting is unchanged from
the row source this replaced — the whole definition goes to the start route rather than its id, and a
refusal keeps the frame open with the node's own message on it.

Approving a gate, cancelling a run and killing one stay in the run surface. Each needs the run's
status and its consequences in front of the person doing it, and a row in a list carries neither.

**Finding an active or recent run is deferred, because there is nowhere to open one.** This plugin
ships no pane and no run surface on either host. The only client that reads its `runs` route is the
agents plugin's task sidebar (`plugins/agents/src/client/sessions/AgentTaskSidebar.tsx`), which draws a
run's *steps* into its roster and keys selection on a managed-session id that a workflow step does not
have; opening a step there spawns a terminal that resumes the step's provider session. A row that
cannot name where it goes is worse than no row, so the search reopens when there is a run surface to
point it at, and not before.

## Configuration trust

Workflow files and executable URL/run-target scripts are repo-authored executable configuration. The
Node hashes the exact snapshot, requires an acknowledgement, and fails closed if the snapshot changes.
Declarative Docker matching data is separate from this gate, but commands that start/stop services
remain executable actions and are trust-checked.

## Gaps

Authoring is file-based. The desktop must be open for UI interaction, although the node continues
work while the renderer is closed — including the trigger sweep, which moved onto the node's own
scheduler. There is no general DAG
editor, and no automatic retry of an operation whose external outcome is unknown.

An agent cannot start or drive a run: no workflow or session tool is registered, so orchestration is
declarative only. [`docs/future/orchestration.md`](./future/orchestration.md) analyses what an
agent-driven path would cost, including database-truth definitions.
