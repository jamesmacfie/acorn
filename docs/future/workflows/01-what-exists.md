# What exists: the verified inventory

Part of [docs/future/workflows/](./README.md). Checked against the tree on 2026-09-08. Paths are
hints; run each phase's verify list before trusting one.

## The engine

`plugins/workflows` is the owner. Its pieces, and what each one settles for this programme:

| Piece | Where | What it does today |
| --- | --- | --- |
| Definition shape | `plugins/workflows/src/shared/workflowContracts.ts` | `WorkflowDef { name, posture?, trigger?, tools?, budget?, steps[] }`. A step is `{ name, kind?, profileId?, model?, prompt?, schema?, policy?, maxIterations?, requiresRun?, childStep?, joins?, branches?, with?, tools?, budget? }`. Built-in kinds use named fields; a contributed kind reads its opaque `with` table. |
| File loader | `plugins/workflows/src/server/workflowFiles.ts` | `parseWorkflowToml` maps snake_case keys to the shape above. `loadWorkflowFiles(repoDir, userDir)` scans `.acorn/workflows/*.toml` in the checkout or worktree, then `~/.acorn/workflows`; the first id wins, so repo shadows user. A step with `workflow = "<id>"` expands another definition inline, one level, cycles refused. A malformed file is an error row, never a silent skip. |
| Validation | `plugins/workflows/src/server/workflowValidation.ts` | Names unique, kinds known, ceilings and budgets narrow, `decide` branches point forward, `join` names a preceding `fan-out`, `${steps.<name>.output}` points backward. `renderWorkflowPrompt` substitutes `structuredJson` or `resultJson.result`. |
| Runner | `plugins/workflows/src/server/workflowRunner.ts` | `tick()` finds the first `pending` step by `idx`, runs it to completion, repeats. A `failed` or `safety-rail` row ends the run. `decide` marks skipped rows. Budgets intersect workflow over step with a persisted-usage sum. `reconcile()` sweeps `running` steps back to `pending` after a restart. `cancelRun`, `killStep`, `resolveGate`. Per-run abort controllers keyed by step. |
| Built-in kinds | `plugins/workflows/src/server/workflowBuiltins.ts` | `agent`, `gate-human`, `gate-policy`, `ci-loop`, `fan-out`, `join`, `decide`. `fan-out` creates one child task with its own worktree per item from an agent's JSON list, capped at 12, and runs children under a semaphore of 4. `runAgent` honours `requiresRun` by starting a run target and appending its URL to the prompt. |
| Rows | `plugins/workflows/src/node/schema.ts` | `workflow_runs` (`taskId`, `status`, `posture`, `trigger`, `defJson` frozen at start). `workflow_steps` (`idx`, `kind`, `mode`, `profileId`, `model`, `status`, `inputsJson`, `resultJson`, `structuredJson`, `sessionId`, `agentSessionId`, `costUsd`, `iteration`, `parentStepId`). The plugin's own SQLite file, migrated at init. |
| Extension points | `plugins/workflows/src/contract/extensions.ts` | `workflows:step-kind` takes `{ handler, validate? }`. `workflows:policy` takes a verdict function. `workflows:trigger` takes an `evaluate()` polled every 300 s on the node's scheduler. A contributed kind is addressed `<pluginId>:<entryId>`. The worked example is `plugins/http/src/server/workflowStep.ts`, registered in `plugins/http/src/node/index.ts`. |
| Routes | `plugins/workflows/src/server/routes/workflow.ts` | `GET /v2/p/workflows/tasks/:id/workflows` lists file definitions for a task. `POST` on the same path starts a run and takes the whole definition in the body. `GET .../tasks/:id/workflows/runs`. `GET /v2/p/workflows/workflows/runs/:runId/steps`, `POST .../gate`, `.../cancel`, `.../kill`. `GET /v2/p/workflows/runs` feeds the merged run list. Run-scoped paths check ownership through `taskIdForRun`. |
| Node entry | `plugins/workflows/src/node/index.ts` | Wires the runner to `AGENTS_SESSION_EXECUTE`, the notes store for handoffs, the terminal run targets, `core.tasks.createChild`, and `core.projects.assertConfigTrusted`. Sends `workflow:notice` and `workflow:step:event` frames and `plugin:workflows:run-changed`. |
| Client | `plugins/workflows/src/client/` | One palette search, "Run a workflow" (`commands.ts`). A read-only Settings page (`WorkflowsSettings.tsx`). The HTTP wrapper `workflowsClient.ts`. Provides the `WORKFLOW_CONTROL` client capability (`runs`, `steps`, `gate`) that `plugins/agents/src/contract/workflowControl.ts` declares. |

## How an agent step runs

`AGENTS_SESSION_EXECUTE` (`plugins/agents/src/contract/sessionExecute.ts`) takes `{ taskId,
profileId, title, prompt, schema?, model?, tools?, timeoutMs?, managedSessionId?, runId?, stepId?,
onEvent?, signal? }` and returns a `HeadlessResult` or `null` when the profile has no managed
driver. The implementation (`plugins/agents/src/server/sessions/sessionExecute.ts`) creates a
session with `kind: 'workflow'` and `config: { workflowRunId, workflowStepId, toolCeiling }`,
enqueues one turn with `source: 'workflow'`, and polls `runtime.wait` until the turn settles. The
final text is `capture.result`; the parsed JSON block is `capture.structuredOutput`.

Model and thinking level are not a static list. Each provider advertises `AgentConfigOption[]` with
`category: 'model' | 'reasoning' | 'mode' | 'permission'` on its `session_metadata` event, and the
runtime stores them on the session. The Codex driver reads `effectivePolicy.model` and `.effort` at
turn time. The Claude driver applies an option only through `driver.setConfig`, which
`runtime.patchSession(id, { config: { configOptions } })` triggers and validates against the
advertised list. The request type carries `model` and nothing for reasoning. `GET
/v2/p/agents/providers` lists the descriptors with their options.

## The agent pane

`plugins/agents/src/client/paneContribution.ts` registers the `agents` pane, `list-detail`, with a
per-task model. The detail header is `AgentDetailHeader` in
`plugins/agents/src/client/sessions/AgentPane.tsx` (provider glyph, title, state, Stop, actions
menu, usage). The list is `AgentTaskSidebar.tsx`; its "Terminals and workflows" section draws
workflow step rows from `buildRoster` in `sessions/model.ts` and opening one spawns a terminal on
the step's resume command. Nothing in the client reads a session's `kind` or its
`config.workflowRunId`. `openManagedSession(taskId, sessionId, requestId?)` in
`sessions/managedSelection.ts` is how any pane opens a session.

## Primitives a step kind can use

- `ctx.core.proc.runProcess(spec)` in `packages/node-core/src/server/core/proc.ts`: a captured
  child process with a required absolute `cwd`, a 30-second default timeout, a 1 MiB output cap, an
  environment allowlist, and SIGTERM then SIGKILL. `runScript()` in
  `plugins/terminal/src/server/runChannel.ts` is the `/bin/sh -c` in a task's checkout pattern.
- `ctx.core.tasks.resolveCwd(task, undefined, ctx.core.identity.active())` and `tasks.root(taskId,
  userId)` return the checkout and create a worktree lazily.
- `TERMINAL_RUN_TARGETS` (`plugins/terminal/src/contract/runTargets.ts`): `targets`, `start`,
  `stop`, `status`, `defaultUrl`. A run target is a PTY session, not a captured command.
- `TERMINAL_SESSIONS` (`plugins/terminal/src/contract/sessions.ts`): `create({ taskId, command,
  title })` opens a visible terminal and returns its id.
- `ctx.core.models.generateText({ userId, connectionId, input: { system, prompt, modelId?,
  maxOutputTokens, signal? } })` in `packages/node-core/src/server/core/models.ts`, and
  `models.available(userId)`.
- `ctx.core.tasks.createChild(parentTaskId, { title, branch })` and `tasks.cancel(taskId)`.
- `ctx.core.projects.assertConfigTrusted(taskId)` and `isRepoConfigTrustError`.

## The database plugin

A loaded plugin. Its node entry (`plugins/database/src/node/index.ts`) opens its store and
registers a portable route carrier; it provides no capability and has no `contract/` folder.
`DatabaseBridge.query(taskId, sql)` in `plugins/database/src/server/database.ts` returns `{
columns, rows, rowCount, command }`. Pools are keyed by task because the connection URL comes from
the checkout's `dbUrlScript` or `.env`. Saved queries are project-scoped rows in
`db_saved_queries`. `plugins/database/src/server/generateSql.ts` builds the prompt for the AI-SQL
route over `core.models.generateText`. A loaded plugin may provide a capability only inside its own
`database.` namespace.

## Shell seams the UI phases use

| Seam | Where | Note |
| --- | --- | --- |
| Task pane with regions and a model | `packages/client-core/src/host/registries/panes/panes.ts` | `PaneLayoutContribution<M> = PaneCommon & { layout, model?, regions, tabs?, hidden? }`. The model is built once per task in its own root (`paneModels.ts`). Example: `plugins/changes/src/client/paneContribution.ts`, `list-detail` with four lazy regions. |
| Rail source | `packages/client-core/src/host/registries/sources/sources.ts` | `SourceContribution { id, order, glyph, label, providerId?, requires?, when?, projectScoped?, component? \| regions?, routes?, promotion?, tracksRef? }`. Example with regions: `plugins/github/src/client/index.ts`. Gating: `packages/client-core/src/features/tabs/railSources.ts`. Workspace scope: `features/tabs/sourceScope.ts`. |
| Project surface | `packages/client-core/src/host/registries/panes/projectSurfaces.ts` | `{ id, path, item, order, component }`; `path` is confined to `/p/:projectId/x/<pluginId>/`. `projectSurfacePath(surface, projectId, item)` builds a URL. |
| Navigation | `packages/client-core/src/host/registries/commands/clientEvents.ts` | `openPane(taskId, paneId, intent?, mode?)` with retained intents; `requestTerminalFocusIntent`. Deep link `/t/:taskId?pane=&item=` in `features/tasks/taskDeepLink.ts`. |
| Context menus | `packages/client-core/src/host/registries/panes/contextMenus.ts`, `packages/protocol/src/contextMenus.ts` | `CONTEXT_MENU_LOCATIONS = ['task.row']`. A contribution is `{ id, location, label, icon?, order, when?, run }`. The descriptor twin is `contextMenuDescriptor` in `packages/protocol/src/plugin/contract.ts`. |
| The three row menus | `packages/client-core/src/host/chrome/ChromeSourcePanel.tsx`, `plugins/github/src/client/PullList.tsx` | Rollbar and Linear ship no client code; their `shared/rail.ts` returns a `PluginRailItem` with `task?: PluginRailTask { origin?, title?, branch?, body?, link? }` and the host draws "Create task…". GitHub draws its own `RowActions`. `PluginRailTask.body` is on the wire and unread. |
| Promote modal | `packages/client-core/src/features/integrations/PromoteToTaskModal.tsx` | Tabs "New task" and "Attach to task". Driven by `sourceRegistry.get(providerId).promotion` (`prepare`, `create`, `afterCreate?`, `attachToCurrentTask`). |
| Task creation | `POST /v2/core/tasks` in `packages/node-core/src/server/routes/projects/tasks.ts` | Body `{ title?, icon?, origin, projectId, branch?, pullNumber?, links? }`. `branch` absent means the project folder with no worktree. Client wrapper `createTask` in `packages/client-core/src/features/tasks/taskMutations.ts`. |
| Notices | `packages/client-core/src/features/notifications/deliver.ts` | `initWorkflowNotices` turns a `workflow:notice` frame into a notice with no target. `registerNoticeTargetHandler(kind, handler)` is how a target kind learns to open. |
| Attention rows | `packages/client-core/src/host/registries/rail/attention.ts` | `AttentionItem { id, taskId?, projectId?, title, detail?, glyph?, severity, at, target }`. `target` is required, the id must be stable and must not include `at`, and `info` is the only tier the owner can acknowledge away. Example: `plugins/agents/src/client/index.ts`. |
| Host-drawn forms | `packages/protocol/src/integrations.ts`, `packages/protocol/src/collections.ts` | `CredentialField { id, label, type, placeholder?, hint?, required }` drawn in `features/settings/IntegrationsSettings.tsx`; `collectionParam { id, name, type, values?, multiple? }`. No plugin hands the shell a component. |
| The closed kit | `docs/ui-design.md` § The closed kit; `tools/arch/boundaries.test.ts` | Plugin client code may not emit raw DOM. A canvas needs a kit node with both projections. |

## The gaps, in one table

| Need | State | Lands in |
| --- | --- | --- |
| Two agents in parallel on one task, then a third | `fan-out` only, one child task and worktree each | Phase 0 |
| A node fed by the item that started the run | Nothing; only `${steps.x.output}` | Phase 0 |
| Thinking level per agent step | `model` only; Claude ignores it at turn time | Phase 0 |
| Retry a failed node | Cancel, kill, gate | Phase 0 |
| A contributed kind describes its form | Opaque `with`, validator only | Phase 1 |
| Shell command step | None | Phase 1 |
| Database query steps | None, and no capability | Phase 1 |
| Definitions in the database | TOML only | Phase 2 |
| Editor | None | Phase 3 |
| Run surface | Sidebar rows that open a terminal | Phase 4 |
| Agent pane names its workflow | Data on the row, unread | Phase 4 |
| Bell row opens something | Notice has no target | Phase 4 |
| Start from a Rollbar, Linear, or GitHub row | "Create task…" only; GitHub's menu is hand-written | Phase 5 |
| A picture of the graph | Nothing | Phase 6 |
