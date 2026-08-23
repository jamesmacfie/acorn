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

## Routes and UI

Node routes are under `/v2/p/workflows/` and core task run-target routes under
`/v2/core/tasks/:id/run/*`. The desktop contributes Settings inspection/problems, command-palette
rows, task activity, gate controls, and attention items. Workflow notices use `/v2/events`; durable
run history is paged from the plugin database.

## Configuration trust

Workflow files and executable URL/run-target scripts are repo-authored executable configuration. The
Node hashes the exact snapshot, requires an acknowledgement, and fails closed if the snapshot changes.
Declarative Docker matching data is separate from this gate, but commands that start/stop services
remain executable actions and are trust-checked.

## Gaps

Authoring is file-based. The desktop must be open for app-open-triggered reconciliation and UI
interaction, although the Node continues work while the renderer is closed. There is no general DAG
editor, and no automatic retry of an operation whose external outcome is unknown.

An agent cannot start or drive a run: no workflow or session tool is registered, so orchestration is
declarative only. [`docs/future/orchestration.md`](./future/orchestration.md) analyses what an
agent-driven path would cost, including database-truth definitions and an extensible step-kind
registry.
