# Agent-driven orchestration: one agent running acorn's agents

Analysis, 2026-08-21. Nothing here is scheduled. This file is the standing answer to "what would it
take for an agent inside a task to spawn other acorn agents, wait on them, collect their results, and
have all of it visible in the panes."

The reference point is herdr (`references/herdr`), whose agent skill is the thing people actually
enjoy. Its whole vocabulary is five verbs against a live session: `agent start`, `agent prompt
--wait`, `agent wait --until`, `agent read`, `agent send-keys`. There is no workflow language. The
orchestrator is a normal agent that calls a CLI, reads JSON back, and decides what to do next.

acorn already has the durable half of this and none of the conversational half. The gap is narrower
than it looks.

## What is already built (verified 2026-08-21)

`plugins/workflows` is a real orchestration engine, not a sketch. `server/workflowRunner.ts` owns
validation, ordering, persistence, branching, cancellation, and restart reconciliation. Rows are the
checkpoint, so a step interrupted by a restart is swept back to `pending` rather than repeated blind.

| Primitive | Where | What it does |
| --- | --- | --- |
| `fan-out` step | `server/workflowBuiltins.ts` | An agent step emits a JSON task list. The runner creates one child task per item through `core.tasks.createChild()`, then runs a headless agent in each. Capped at `MAX_FAN_OUT_TASKS = 12`. |
| `join` step | same | Collects every child's structured output and status, fails the run if any child failed, and writes the collection as a handoff. |
| `decide` step | same | A one-shot structured call whose `verdict` string selects a branch. Prose cannot satisfy it. |
| Concurrency | `server/workflowSemaphore.ts` | `MAX_CONCURRENT_HEADLESS = 4`. Queued children stay `pending` until they hold a slot. |
| Budgets | `server/workflowRunner.ts` | Wall time, cost, input tokens, output tokens, and turns, intersected workflow over step, with a persisted-usage sum so a restart cannot reset the meter. |
| Tool ceilings | `server/workflowTools.ts` | Passed to the child process as `ACORN_TOOL_CEILING`, intersected the same way. |
| Value passing | `server/workflowValidation.ts` | `${steps.<name>.output}` renders an earlier step's output into a later prompt. Structured JSON is the only input to branching. |
| Handoffs | `node/index.ts` | Each step's result is appended to a task note, `workflow-handoffs-<runId>`, which is injected as context into later steps of the same run and de-included when the run ends. |
| Sessions | `plugins/agents/src/server/sessions/sessionExecute.ts` | A step runs as a real managed agent session with a durable event ledger, so it appears in the task's Agents sidebar. |

One route deserves calling out, because it is the piece everybody assumes is missing:

```
GET /v2/p/agents/sessions/:sessionId/wait?until=turn_completed&timeoutMs=30000
```

`until` accepts `ready`, `attention`, `turn_completed`, or `stopped`, and `timeoutMs` is capped at 30
seconds (`plugins/agents/src/shared/schemas.ts`). That is herdr's `agent wait --until`, already built,
already bounded, already owned by the task. `POST /sessions` and `POST /sessions/:sessionId/turns` are
both reachable by a task-confined principal acting on its own task.

## The four gaps

**1. No agent tools for any of it.** Thirty tools are registered today: task and pull-request context,
git changes, notes, memory, terminal run targets, browser automation, plus `plugin_authoring` and
`plugin_request`. None of them touch sessions, workflows, HTTP, the database, or Docker. An agent
cannot start a workflow or spawn another agent through MCP at all. This is the entire blocker and it
is the smallest of the four.

Fixed in [docs/mcp.md](../mcp.md) on 2026-08-28: the section used to claim the surface included
"terminal/session operations, workflows, database/Docker operations", and it never did.

**2. MCP is welded to one task.** `packages/node-core/src/mcp/server.ts` sends every call to
`/v2/core/tasks/${ACORN_TASK_ID}/tools/:name`, and `mayActOnTask` refuses a confined principal on any
other task. A fan-out child is another task. So "spawn a sub-agent and read its result" cannot lean on
task scope for authority. The handler runs in the node with node authority, so it can reach across, but
it has to model "the sub-agents I spawned" explicitly.

**3. ~~No API-call step, and step kinds are closed.~~ Closed 2026-08-28.** The builtins are still
`agent`, `gate-human`, `gate-policy`, `ci-loop`, `fan-out`, `join`, and `decide`, but they are no
longer all there can be. `WorkflowContributionRegistry` is deleted; workflows opens three node
extension points (`workflows:step-kind`, `workflows:policy`, `workflows:trigger`) and any plugin may
fill them. The HTTP plugin contributes `http:request`, where the scheme check after interpolation and
the body cap already live. See "Opening the step-kind registry" below.

**4. Visibility is half there.** A step on the parent task creates a managed session, so it shows in
that task's Agents sidebar. A fan-out child runs on a child task, so its session lives in the child's
pane instead. `tasks.parentId` is on the wire (`packages/protocol/src/api.ts`) but no client code reads
it, so a child task looks unrelated in the task list. There is no workflow pane either:
`docs/panes.md` lists twelve, none of them workflows. Run state is visible only in the sidebar's
"Terminals and workflows" section and in Settings.

## The decision that comes first: shared worktree or child task

herdr's unit of work is a sibling pane in the same tab, same working directory. acorn's fan-out unit is
a child task with its own git worktree. These are not interchangeable, and picking one for everything
is the mistake to avoid.

| | Shared, same task | Child task with worktree |
| --- | --- | --- |
| Cost | A session row. No git operation. | A task row plus a lazily created worktree. |
| Parallel writes | Collide. Two agents share one checkout. | Isolated by construction. |
| Where you watch it | The caller's own Agents pane. | The child task's pane. |
| Good for | Read, review, summarize, research, judge. | Write code on a branch. |

Most orchestration is the first column. Three agents each reading a subsystem and reporting back do
not need three checkouts, and paying a worktree for each is what makes fan-out feel heavy today.

**The call: build both, default to shared.** `isolation: 'shared' | 'worktree'` on the spawn tool, and
`shared` is the default.

## The proposed tool surface

Four tools, `scope: 'task'`, risk `execute`, deliberately named after herdr's verbs because that
vocabulary is the part people like:

| Tool | Arguments | Returns |
| --- | --- | --- |
| `agent_spawn` | `title`, `prompt`, `profileId?`, `isolation?`, `schema?` | `{ sessionId, childTaskId? }` |
| `agent_prompt` | `sessionId`, `prompt`, `wait?`, `timeoutMs?` | the turn id, and the settled state when `wait` is set |
| `agent_wait` | `sessionId`, `until`, `timeoutMs` | the session snapshot, or `still_running` on timeout |
| `agent_read` | `sessionId`, `afterSeq?`, `limit?` | assistant text plus any structured result |

Three notes on the shapes.

**Cap `timeoutMs` at 30 seconds and let the orchestrator loop.** The existing `wait` route already caps
there. A tool that blocks for 10 minutes fails on the client side anyway, because Claude Code's MCP
client applies its own tool timeout. Returning `still_running` and letting the caller poll is both
honest and what herdr does with `--timeout`.

**`agent_spawn` takes an optional result schema.** `sessionExecute` already appends a result contract
to the prompt and parses the fenced JSON block back out. Reusing it means a sub-agent's answer arrives
as data, which is the same rule the declarative half already enforces: prose is not control flow.

**No session names.** herdr needs `reviewer` because a human types CLI commands. The orchestrator gets
an id back from `agent_spawn` and has no keyboard.

## The spawn ledger, and why it is not optional

One new table. A row per spawn: owner task, session id, child task if any, and depth.

The handler then asks "did this task spawn that session" instead of "is that session in this task", so
`mayActOnTask` stays exactly as it is and `agent_read` on an arbitrary session id is not a hole. That
row is the whole authority model.

Depth and count caps belong on the same table, because nothing else bounds them. `MAX_FAN_OUT_TASKS`
bounds the declarative path, but an agent calling `agent_spawn` in a loop is unbounded, and every agent
it spawns holds the same tool. Suggested starting numbers, matching the ceilings already in the runner:
depth 2, and 12 live sub-agents per root task.

## The open question: implicit runs, or sessions only

This is the fork in the road and it wants a decision before any code.

**Sessions only** is less work. `agent_spawn` creates managed sessions, the ledger tracks them, done.
What you lose: no run record, no cost ceiling across the whole tree, no cancel-the-whole-thing, no
restart reconciliation. Each of those already exists in `WorkflowRunner` and would be reimplemented
badly or not at all.

**Implicit run** is the fuller version. `agent_spawn` from a task with no active run opens one with a
synthetic definition, and each spawn writes a step row under it. Budgets, cancellation, the step
ledger, and the existing sidebar rendering all apply for free. The cost is that `WorkflowRunner`
currently drives steps from a frozen `defJson`, and an agent-driven run has no definition up front, so
`tick()` would need a mode where steps arrive while the run is live rather than being expanded at
`start()`.

**Recommendation: implicit run.** The budget argument settles it. A tool that lets an agent spawn
agents that spawn agents needs a cost ceiling with the run, not with each session, and that ceiling is
already written.

## Workflow definitions in a table

The precedent is already in the repo and it is schedules. From `docs/schedules.md`: declared schedules
are registry truth, where the code is the definition and the database stores only the owner's overrides
and run state, and user schedules are database truth, full rows parsed tolerantly with unknown kinds
retained inert.

Do the same thing here:

- `.acorn/workflows/*.toml` stays repo truth, so a workflow can be reviewed in a pull request and
  travels with the branch that changed it.
- A `workflow_defs` table holds user-authored ones.
- One list read merges both, and repo wins on an id collision. That is the layering
  `loadWorkflowFiles()` already applies for repo over `~/.acorn`.

Do not move the TOML into the database. A workflow that runs an agent CLI in a worktree is executable
configuration, and the trust gate works by hashing the exact file snapshot
(`core.projects.assertConfigTrusted`). Rows have nothing to hash, so a user-authored workflow needs its
own answer to trust, and "the owner typed it into this app" is that answer. Repo-authored and
user-authored are different trust stories, which is the real reason they stay different stores.

## Opening the step-kind registry — done

For the agent-driven path, an API-call step is unnecessary. The agent has bash and curl.

For the declarative path it was worth one `http` step kind, and adding it was the moment to stop
having eight builtins forever. **Shipped 2026-08-28**, and not as `registerStepKind` on
`WORKFLOWS_RUNNER` as this file first proposed. A capability has one provider by construction, and
"many plugins each add a step kind" is many-to-many, so granting it through the runner capability
would have been the first of five private registries with slightly different lifecycles. The node
grew the twin of the client's extension points instead
(`docs/plugins.md § Node-side extension points`), and workflows was ported onto it. Hooks
(`docs/plugins.md § Hooks`) generalise the same shape again, with observe, transform, and veto modes; `workflows:step-kind` stays a registry-shaped point and `before-step` is
the hook.

Three points, opened by workflows and fillable by anyone: `workflows:step-kind`, `workflows:policy`,
`workflows:trigger`. The HTTP plugin contributes `http:request`, where the scheme check after
interpolation and the body cap already live (`docs/http-client.md`). A repo-authored HTTP step is
executable configuration and the existing trust snapshot already covers it.

Two things fell out that this file did not anticipate:

- **A contributed kind is addressed as `<pluginId>:<entryId>`.** Built-ins stay bare words, so a
  `.acorn/workflows/*.toml` that says `kind = "http:request"` names the package that will run the
  step, and two plugins can both call their entry `request` without either shadowing the other.
- **`[steps.with]`.** A built-in kind's inputs are named fields the host can check; a contributed
  kind needs somewhere to put its own, so a step carries an opaque `with` table that only the
  contributing plugin reads and validates.

## What this does not build

**A DAG editor.** ~~The declarative half covers fixed pipelines and the agent-driven half covers
dynamic ones. A visual editor serves neither, and `docs/workflows.md` already names its absence as a
current limit rather than a gap.~~ **Reversed**, and built. The argument above weighed an agent driving agents. It did not weigh a
person authoring a workflow in the UI, which is what the editor is:
[docs/workflows.md](../workflows.md) § Authoring owns it, and § What workflows refuses says why the
editor is a rail source rather than a pane or a Settings page.

**Cross-task MCP scope.** Widening `AgentToolContribution.scope` past `task` is a security change
bought for a convenience. The ledger gets the same result without touching the boundary.

**A workflows pane.** ~~Tempting, but the Agents sidebar already merges sessions with workflow steps,
and an implicit run makes agent-driven work appear there with no new surface. Revisit only if reading
a run turns out to need more than a roster.~~ **Reversed**, and built. Reading a run does need more than a roster: the sidebar keyed selection
on a managed-session id a workflow step does not have, and opening a step row spawned a terminal
instead of showing what the step was doing. [docs/workflows.md](../workflows.md) § The run pane owns
the pane that replaced it.

## Suggested phasing

1. Fix the `docs/mcp.md` tool-surface sentence. One line, and it is wrong today.
2. Decide implicit run against sessions only.
3. The spawn ledger, with depth and count caps and a test that a third-level spawn is refused.
4. `agent_spawn` and `agent_read`, `isolation: 'shared'` only. This is enough for the read-and-report
   case, which is most of the value.
5. `agent_prompt` and `agent_wait`, wrapping the existing `runtime.wait`.
6. `isolation: 'worktree'`, reusing `core.tasks.createChild()`.
7. Surface `tasks.parentId` in the task list, so a spawned child stops looking unrelated.
8. ~~`registerStepKind` on `WORKFLOWS_RUNNER`, then the `http` step in the HTTP plugin.~~ **Done**,
   through node extension points rather than the capability — see above for why.
9. ~~`workflow_defs` as database truth, merged under the repo layer.~~ **Done**.
   [docs/workflows.md](../workflows.md) § Database definitions owns it.

Steps 1 through 5 are the herdr experience. Everything after is acorn keeping the durability it
already has.
