# Workflows & run targets

How acorn launches a task's app (**run targets**) and orchestrates multi-step, multi-agent work
(**workflows**). These are two related layers: a run target is the simplest unit (a command acorn can
start/stop/reach), and a workflow is the composable multi-step machine that consumes those units.

> **Maturity — read this first.** Everything on this page is **desktop-only** — it needs the
> preload bridge, so it's always on in the Electron app and absent in a plain browser
> (`capabilities()`, `apps/desktop/src/client/features/capabilities.ts`).
> Two different maturities live here:
> - **Run targets + layout recipes are implemented and working** (config reader, runtime service,
>   IPC, MCP tools, palette, recipes).
> - **The workflow engine has real, wired scaffolding** (schema, a main-process `WorkflowRunner`, a
>   headless step runner, a `.acorn/workflows` loader, a read-only settings inspector, palette
>   launch, an Agents-panel viewer) but is **young and in progress** — it drives real agent CLIs,
>   depends on capabilities that are still being fleshed out (context assembly, notes handoff), has
>   **no GUI authoring**, and its loops run **only while the app is open** (no daemon). Do not read
>   this as a finished orchestrator — anything marked **design** below is intent, not a shipped
>   guarantee.

---

## 1. Overview

Two related ideas, both flag-gated:

- **Run targets** — the answer to *"how does this task's app run?"* acorn allocates **no ports** and
  assumes no single launch shape. A docker-compose stack, `pnpm dev`, a custom `./scripts/dev.sh`, or
  a one-shot `pnpm db:seed` are all modeled by the same tiny shape: a **command**, an optional
  **stop**, and an optional way to **reach** what it starts (`url` or `url_command`). Each becomes a
  ▶/■ button, a `Run:`/`Stop:` palette entry, and an MCP `run_*` tool.
- **Workflows** — a durable state machine of named **steps** (agent runs, gates, loops, fan-out/join)
  run by the Electron **main process**, where steps hand off through acorn's notes/memory/context
  substrate rather than terminal scrollback, and the composable unit is a **headless step** that
  captures a structured result. Workflows *consume* run targets (a step can declare `requires_run`).

Run targets are the simplest (one-shot) end of the same spectrum workflows extend.

---

## 2. Run targets

### The model

A run target is a **command + optional `stop` + at most one of `url` / `url_command`**. There is no
`kind` enum: a long-running target is one whose process stays alive (a terminal session, the ▶
behaviour); a one-shot exits. The presence of `url`/`url_command`/`stop` tells acorn everything it
needs. The renderer shape is `RunTargetInfo` (`apps/desktop/src/shared/terminal.ts:88`); status is
`RunStatus = { running, url?, exitCode? }` (`:98`).

acorn **allocates no ports**. Isolation across parallel tasks is the *script's* job, informed by the
stable identity env acorn injects into every session — notably **`ACORN_TASK_SLUG`**
(`apps/desktop/src/main/terminalUtils.ts:153`), the branch-derived handle a compose target namespaces
with (`docker compose -p acorn-$ACORN_TASK_SLUG …`) or a dev script uses to pick a free port and
report it back via `url_command`.

### Where targets are configured

Three layers, highest precedence first (`loadRepoConfig`, `apps/desktop/src/main/runConfig.ts` —
the canonical layering comment lives at its merge point):

| Layer | Source | Notes |
| --- | --- | --- |
| repo | `./.acorn/config.toml` (committed, team-shared) | **canonical** — `[scripts.run.<id>]` tables |
| user | `~/.acorn/config.toml` (personal defaults) | same shape, personal overrides |
| db | `repo_paths.runTargets` JSON, else `workspaces.devScript` as a base `dev` target | fallback layers only; `legacyRunTargets` (`runConfig.ts`) parses the JSON column. (The old scalar `run_command`/`dev_port` columns were folded into the JSON by migration `0017` and dropped in `0018`.) |

The committed `.acorn/config.toml` file (`[scripts.run.<id>]` with `command` / `stop` / `url` /
`url_command` / `icon` / `default`) is the canonical shape; the reader (`runConfig.ts`) parses it
today, surfacing malformed files as visible error rows rather than silently dropping them.

Per-workspace scripts on the `workspaces` table also feed targets: `devScript` maps to a `dev` run
target, and `devRestartScript`, when set, is what `run_restart` runs instead of stop+start
(`apps/desktop/src/server/db/schema.ts:282-283`). The DB fallback JSON lives on
`repo_paths.runTargets` (`schema.ts:262`).

### How targets run

The **`RuntimeService`** in the main process owns run-target instances per task
(`apps/desktop/src/main/runtime.ts:51`). An instance is *just a terminal session in the task's
worktree*, so `running` derives from the session map, and reachability comes from the target's `url`
(fixed) or `url_command` (run-a-command-and-parse-stdout — the same shape as `term:previewUrl`;
`parseUrlOutput`/`resolveTargetUrl`, `runtime.ts:29-47`). Each target shows in the terminal drawer
with **one ▶/■ per target**. `start` is idempotent for an already-running instance (`runtime.ts:78`).

### Who consumes run targets

- **Command palette** — `Run: <id>` / `Stop: <id>` rows (toggling on `running`) come from
  `composeItems` (`apps/desktop/src/client/features/palette/model.ts:26`); `CommandPalette.tsx`
  calls `api.run.start` / `api.run.stop`.
- **Layout recipes** — auto-start a target and point the browser at its URL (§3).
- **MCP `run_*` tools** — `run_targets`, `run_start`, `run_stop`, `run_restart`, `run_status`
  (`apps/desktop/src/mcp/server.ts:233-251`), so an agent can bring a stack up, learn where it
  listens (`{ running, url? }`), drive the browser at it, and tear it down — without knowing whether
  it's compose or pnpm. See [mcp.md](./mcp.md).
- **Workflow steps** — a step's `requires_run` starts the target and hands its resolved URL to the
  step (§4).

### The harness endpoints

The client bridge is `window.acorn.terminal.run.*`
(`apps/desktop/src/client/features/terminal/terminalClient.ts:27-40`), backed by IPC (`run:targets`,
`run:start`, `run:stop`, `run:status`, `run:defaultUrl`) into the `RuntimeService`.

The **loopback HTTP surface** the MCP server calls lives on the harness router
(`apps/desktop/src/server/routes/harness.ts`):

| Route | Effect |
| --- | --- |
| `GET  /:id/run` | list targets + live status + config errors + layout recipes |
| `POST /:id/run/:target/start` | start a target in the task worktree |
| `POST /:id/run/:target/stop` | run its declared `stop`, then kill |
| `POST /:id/run/:target/restart` | the target's `restart` command if set, else stop+start |
| `GET  /:id/run/:target/status` | `{ running, url?, exitCode? }` |

These delegate through the `RunBridge` sub-bridge (`harness.ts`) the main process injects
(`main/harnessWiring.ts`); under `dev:node` (no Electron) the bridge is absent and every route
degrades to a clean `503 bridge-unavailable` (bridge-up domain failures map to typed
`404`/`400`/`500` — see docs/api-reference.md).

---

## 3. Layout recipes

A `[layout.<id>]` config block ties panes ([`03`]/[panes.md](./panes.md)) to run targets. It seeds a
`TaskLayout`, auto-starts a named run target in the drawer, and points the browser pane at that
target's resolved URL. The pure executor is `invokeLayoutRecipe`
(`apps/desktop/src/client/features/tasks/recipes.ts:31`):

1. `recipeToLayout` validates `panes` against `PaneId` (unknown/duplicate panes dropped; none valid →
   the recipe fails).
2. If `terminal = "<id>"` is set, it `startTarget`s that run target and opens the drawer.
3. If `browser = "run:<id>"` is set, it ensures that target is up (start is idempotent), resolves its
   URL via `run.status`, and points the browser pane at it.

Recipes surface as **`Layout: <id>`** palette rows (`model.ts:27`); `CommandPalette.tsx` wires the
real layout/runtime/browser services into `invokeLayoutRecipe`. The `[layout.<id>]` TOML block itself
(`panes` / `terminal` / `browser`) is the **design** shape; `runConfig.ts` parses these `layouts`
today. (A `ratio` key in the file is tolerated but not parsed — panes split equally.)

---

## 4. Workflows

A workflow is a small enforced state machine of named steps, run by the main process, persisted every
transition so a run survives an app restart. This section describes **what the schema and runner
encode**; treat the loops/fan-out as young in-progress code, not a proven orchestrator.

### The data model

Two machine-scoped tables (no `user_id`, like `tasks`).

**`workflow_runs`** (`apps/desktop/src/server/db/schema.ts:445-456`) — the durable checkpoint for the
run:

| Column | Meaning |
| --- | --- |
| `taskId` | → `tasks.id` — the worktree/agent scope the run executes in |
| `name` | the workflow's name |
| `status` | `running` \| `gated` \| `done` \| `failed` \| `safety-rail` |
| `posture` | `gated` (default) \| `autonomous` |
| `trigger` | how it started (default `manual`) |
| `defJson` | the `WorkflowDef` this run executes, **frozen at start** |
| `error` | failure detail |

**`workflow_steps`** (`schema.ts:460-481`) — one row per step; the row set is the checkpoint:

| Column | Meaning |
| --- | --- |
| `runId` / `idx` | parent run + sequence position |
| `kind` | `agent` \| `gate-human` \| `gate-policy` \| `ci-loop` \| `fan-out` \| `join` |
| `mode` | `headless` (default) \| `interactive` |
| `profileId` / `model` | which agent CLI and model — lets a workflow build with one model, review with another |
| `status` | `pending` \| `running` \| `waiting-gate` \| `done` \| `failed` \| `skipped` |
| `worktreePath` | **first-class working context** — a step in the wrong cwd is a whole bug class |
| `inputsJson` | the assembled context bundle handed to the step |
| `resultJson` | the captured `HeadlessResult` (sans events) |
| `structuredJson` | the schema-conforming output — **the edge currency** passed between steps |
| `sessionId` | for `--resume` (open the step in a terminal) |
| `iteration` | loop-bound bookkeeping |
| `parentStepId` | fan-out lineage |
| `costUsd` | per-step cost |

Fan-out children are materialised as **child tasks** via `tasks.parentId` (`schema.ts:351`), so a
PRD-style step can emit a task list and spawn N children, each on its own branch/worktree.

### The design principles it encodes

- **The composable unit is a headless step** that captures a structured result. The headless runner
  (`apps/desktop/src/main/headless.ts`) runs an agent CLI to completion in a worktree and captures
  `{ result, structuredOutput, sessionId, costUsd }` — modeled on the `term:previewUrl` capture. It
  drives real CLIs (`claude -p --output-format stream-json --json-schema …`, `codex exec
  --output-schema …`); tests use a committed `fake-agent.sh` through the same argv-template path.
- **`structuredJson` is the edge currency.** Branching, joining, and fan-out read a step's structured
  output (a JSON field), never free text.
- **Gates are enforced in the main process, not in prompts.** A `gate-human` step pauses the run until
  the approve IPC; a `gate-policy` step **re-derives** its verdict in main and ignores whatever the
  step claimed (e.g. the `checks-green` policy polls the `checks` mirror —
  `apps/desktop/src/main/terminal.ts:957-964`). This is roboco's "enforce outside the agent" lesson.
- **Handoff is via the shared substrate.** A step's result is appended as a `workflow-handoffs` note
  (author `workflow`, `terminal.ts:943-946`) and the next step's input bundle — assembled over
  loopback from `/api/tasks/:id/context` (`terminal.ts:947-955`) — includes it. No chat-scrollback
  dependency. See [notes-and-memory.md](./notes-and-memory.md).
- **Safety rails are first-class terminal states.** Hitting a `ci-loop` `maxIterations` bound is a
  `safety-rail` status, not a `failed` — a thrashing loop is the only real failure.
- **Runs are the checkpoint.** `WorkflowRunner.reconcile()` (`terminal.ts:1027`) resumes or
  fail-cleanly closes runs across app restarts, mirroring the tmux reconciliation pattern.
- **Ceiling, named:** the runner ticks only while the app is open — no daemon, no background jobs.
  This is acceptable for a local single-user app and is the deliberate limit.

### Where workflows are defined

Committed `.acorn/workflows/*.toml`, layered repo → user like `config.toml` (`workflowFiles.ts`). A
step body can reference another workflow (`workflow = "<id>"`, one level of nesting to start; cycles
rejected with a surfaced error). Malformed files become visible error rows.

### The runner

`WorkflowRunner` (`apps/desktop/src/main/workflowRunner.ts`) implements the state machine with
dependency injection (fakeable in tests): `start` freezes the def and persists rows; `tick` advances;
`executeStep` runs a headless agent step; `runFanOut`/`runJoin`/`runCiLoop` handle the parallel and
loop kinds; `resolveGate` handles the human gate; `reconcile` recovers on restart. It is wired with
live deps in `terminal.ts:926-` (real headless runner, handoff notes, the loopback context assembler,
the re-derived `checks-green` policy, gate/run-done notices, `requires_run` target startup, and child-
task creation for fan-out).

### Client surfaces

| Surface | File | What it does |
| --- | --- | --- |
| Bridge | `terminalClient.ts:60-68` | `workflow.defs/start/runs/steps/gate` + `onNotice` on `window.acorn.terminal` |
| Palette launch | `model.ts:28`, `CommandPalette.tsx:114-119` | `Workflow: <name>` rows; selecting one calls `workflow.start` |
| Settings inspector | `features/settings/WorkflowsSettings.tsx` | **read-only** list of the committed/user workflow defs the active task would load + parse errors; a viewer, not a launcher |
| Agents panel | `features/agents/AgentsPanel.tsx:36-81` | polls `workflow.runs`/`steps`, folds steps into the roster, renders gate prompts, and offers "open in terminal" (`--resume <sessionId>`) for any step with a session |

Gate/run-done notices are broadcast to the renderer bell via the `workflow:notice` IPC channel
(`terminal.ts:909-912`).

---

## 5. What exists today vs planned

**Implemented and working (desktop-only):**

- **Run targets** end-to-end: the layered config reader (`runConfig.ts`), the `RuntimeService`
  (`runtime.ts`), IPC + client bridge, `Run:`/`Stop:` palette entries, the MCP `run_*` tools, and the
  harness `/:id/run*` HTTP surface.
- **Layout recipes** (`recipes.ts`) surfaced as `Layout:` palette entries.
- The **workflow schema** (`workflow_runs` + `workflow_steps`).
- A main-process **`WorkflowRunner`** + **headless step runner** wired with real deps, the
  **`.acorn/workflows` loader**, the read-only **`WorkflowsSettings`** inspector, **`Workflow:`**
  palette launch, the **`terminalClient` workflow bridge**, and the **Agents-panel** surfacing of
  workflow steps and gates.

**In progress / young (real code, but not a finished orchestrator):** the workflow runner is early.
Fan-out/join, the CI-fix loop, and autonomous posture exist in `workflowRunner.ts` but lean on
capabilities still being fleshed out (context assembly, notes handoff, the agent CLIs' headless
modes), and there is **no GUI workflow builder** — you author in files. Loops run only while the app
is open. Treat autonomous, multi-agent runs as experimental.

**Design-stage (not built), with a sharpened shape** — see
[docs/next/agent-runtime.md](./next/agent-runtime.md) and its rationale doc
[agent-runtime-influences.md](./next/agent-runtime-influences.md) (a design study of
[agentfield](https://agentfield.ai)):

- **cancel-tree** — stop a run and cascade to fan-out children (steps + child tasks); no way to
  stop anything exists today;
- a **`decide`/branch step kind** — cheap one-shot structured routing (conditional branching),
  vs today's linear + fan-out/join only, with `${steps.<name>.output}` templating for named edges;
- **per-run tool allowlists / risk ceilings** — an autonomous run declares which agent tools its
  steps may use;
- **triggers** — start a run from something acorn already observes (a PR opened, checks red) or a
  while-app-open schedule, riding the poll scheduler (the shippable slice of "Pulse");
- **concurrency ceilings** — a `MAX_CONCURRENT_HEADLESS` semaphore, per-step turn caps, and a
  fan-out depth cap.

**Deliberate non-goals** (what the design studied in agentfield and rejected): no control plane
or agent fleet, **no daemon / background execution** (the runner ticks only while the app is
open), **no cost budgeting** (acorn drives Claude/Codex on subscriptions), no cryptographic
identity/audit governance, and no inter-agent message bus (the notes/memory/DB substrate stays
the only channel). Also still unbuilt: a general DAG engine, sub-workflow depth beyond one level,
saved-prompt/skills-as-steps polish, and acorn-as-a-Linear-agent-host.

---

## Source

- Schema: `apps/desktop/src/server/db/schema.ts:445-481` (`workflow_runs`, `workflow_steps`),
  `:248-270` (`repo_paths.runTargets`), `:282-283` (`workspaces.devScript`/`devRestartScript`),
  `:351` (`tasks.parentId`)
- Run targets: `apps/desktop/src/main/runConfig.ts`, `apps/desktop/src/main/runtime.ts`,
  IPC in `apps/desktop/src/main/runIpc.ts`, wire shapes in `apps/desktop/src/shared/terminal.ts`
  (canonical `RunTargetInfo`/`RunStatus`)
- Workflow engine: `apps/desktop/src/main/workflowRunner.ts`, `apps/desktop/src/main/headless.ts`,
  `apps/desktop/src/main/workflowFiles.ts`, wiring + `workflow:*` IPC in
  `apps/desktop/src/main/workflowWiring.ts`
- Harness routes: `apps/desktop/src/server/routes/harness.ts`
- Client: `apps/desktop/src/client/features/palette/{model.ts,CommandPalette.tsx}`,
  `.../features/tasks/recipes.ts`, `.../features/terminal/terminalClient.ts`,
  `.../features/settings/WorkflowsSettings.tsx`, `.../features/agents/AgentsPanel.tsx`
- MCP tools: `apps/desktop/src/mcp/server.ts:233-251`
- Flag: `apps/desktop/src/client/App.tsx:39`

## See also

- [terminal-and-agents.md](./terminal-and-agents.md) — the terminal drawer and agent sessions run
  targets and workflow steps live in
- [mcp.md](./mcp.md) — the `run_*` and feature tools workflows and agents call
- [panes.md](./panes.md) — the pane model layout recipes arrange
- [command-palette-and-shortcuts.md](./command-palette-and-shortcuts.md) — the `⌘K` palette surface
- [data-layer.md](./data-layer.md) — the SQLite schema and app-state tables

