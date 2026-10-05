# Phase 14: resolve the remaining provider coupling decision

Completion note, October 6, 2026: **retain** the GitHub-shaped core project facet, task primary
pull, and durable agent pull relations. The maps below find no present blocked consumer that earns
an additive schema and wire migration. Core remains the shared owner of local project identity,
operational task state, and Acorn-authored provenance; GitHub owns its disposable mirror. No schema,
route, protocol, or runtime code changed. The compiled-tier proposal remains a revisit trigger, not
an approved migration. Phase 15 accepts this documented disposition and runs its combined gates;
it does not depend on provider generalization. Deviation: no future migration assignment was opened
because the migration threshold was not met.

Date: 2026-10-06. Status: DONE (retention). Risk: low for this decision task; a migration would be high risk.
Prerequisite: accepted [phase 13](./13-agent-composition.md). Next: [phase 15](./15-acceptance.md).
Planning revision: `2ae55abb5`; no schema migration is authorized by this assignment.

## Task and context

Decide whether the remaining GitHub-specific core/protocol model warrants a separate migration now.
This was the audit's least immediate recommendation: it is architectural debt with a substantial
compatibility cost, not a demonstrated need to rewrite storage during a cleanup programme.
Produce a concrete consumer map and decision a developer can act on later.

Core projects hold GitHub repository identity; tasks and task pull relations retain PR identity and
managed-agent provenance. Public project/task transport exposes GitHub fields, and client rail/task
features consume them. Meanwhile core already has generic connections, external item/task links, and
workspace external-project mappings. Do not invent a second generic model without comparing these.

## Starting points

- `packages/node-core/src/server/db/schema.ts`: project GitHub columns, task pull identity, task pulls.
- `packages/protocol/src/transport/api/projects.ts`: project/task GitHub fields and creation payloads.
- `packages/node-core/src/server/core/projectRefs.ts`, `server/core/tasks.ts`, `server/projects.ts`,
  provider stores/routes and their current public exports.
- `packages/client-core/src/features/tabs/TabRail.tsx` or the phase 07 owner, task detail/context,
  GitHub plugin, Changes plugin, workflow policies, and managed-agent PR linking.
- [Core DB](../../data-layer/core-database.md), [integrations](../../integrations.md),
  [project sources](../../integrations/project-sources.md), [GitHub](../../github-integration.md),
  [migrations](../../data-layer/migrations.md), and [compiled tier](../compiled-tier.md).

## Implementation steps

1. Inventory every writer/reader of repository identity, primary pull number, task pull relations,
   and GitHub-shaped transport. Include server adapters, public routes, caches, rendered markers,
   import/export/backup, workflow policy, and provenance. Record actual source paths and contracts.
2. Trace ownership: canonical durable relation vs disposable provider mirror; connection identity vs
   repo identity; workspace/project/task scope; read projection vs mutation. Identify invariants such
   as composite uniqueness, disconnect/delete cascade, multiple pulls, offline reads, and provenance.
3. Compare existing generic mappings and external-item/task-link models against those invariants.
   A normalized shared read model may legitimately belong to core. Moving it into the GitHub DB
   cannot require core to join that database or lose durable task provenance when a mirror is pruned.
4. Find a concrete present consumer that is blocked or repeatedly complicated by the GitHub shape.
   Another hypothetical provider alone is insufficient. Record the actual change and maintenance
   burden, or explicitly state that no current blocker was found.
5. Write the decision in this file's delivery section and `evidence.md`:
   - **Retain:** identify legitimate shared-core ownership, remaining leaks, and a precise trigger
     for revisiting them. State which references are historical conveniences and which are required.
   - **Propose migration:** give exact existing/target ownership, additive wire projection, mappings,
     new/old client behavior, backfill/cutover sequence, rollback, and deletion conditions. Identify
     the first real consumer and the existing generic owner to extend instead of creating a parallel one.
6. For a proposed migration, make a separate future implementation assignment with its own scope,
   compatibility fixtures, commands, and acceptance. Mark any new source path as new. Index the
   assignment in both future indexes. Do not execute it during this phase or make phase 15 depend on
   unapproved schema work. This programme completes with the decision and actionable follow-up.
7. Correct owning documentation only if current behavior/ownership was described inaccurately.
   Describe prospective contracts in future docs. No public API removal, schema edits, plugin-tier
   changes, new abstraction framework, or data migration ships in this task.

## Verification

Cross-check the inventory against current schema, routes, exports, and consumers. For a migration
proposal, enumerate actual fixtures needed: populated legacy DB, two connections/repos with matching
pull numbers, multiple task links/provenance, disconnected provider, offline reads, old/new wire
clients, interrupted migration, backup/restore, and rollback. Document expected observable results.

For this documentation-only phase run:

```sh
pnpm --filter @acorn/arch-tests test
```

No unchanged production suite needs to be rerun just to support a design decision. Any future
migration requires supported-runtime lint, affected packages/consumers, `pnpm db:check`, full tests,
and real-host acceptance in its own assignment.

## Acceptance and handoff

- Complete writer/reader and entity-invariant maps distinguish durable relations from provider cache.
- A dated retain/propose decision cites a concrete need, cost, compatibility, and existing owner.
- If migration is justified, its separate task can be picked up without this conversation. No code
  or schema has changed under this phase. Retention does not claim the coupling was removed.
- Update task/table/evidence and hand off final scope/dispositions to phase 15. Reversal is a revised
  decision record, not a destructive data operation.

## Verify before building

Inspect live core/protocol entities, generic mappings, and consumers after the prior refactors. Stop
short of implementation if compatibility/data ownership is uncertain; complete the documented decision.

## Delivery: ownership and entity invariants

| Entity and owner | Key, scope, and lifetime | Writers and readers |
| --- | --- | --- |
| Core `projects` GitHub facet | `project.id` owns the local project; `github_owner/name/repo_id` is a nullable, one-to-one detected or imported facet. `(owner,name)` is deliberately non-unique because two local clones can share a repo. Names are folded on write and compared case-insensitively for historical rows. The facet survives a missing remote while Git history remains; deleting the project deletes its tasks. | `server/projects.ts` detects, imports, updates, projects, and deletes it; GitHub import uses `CoreServices.projects`, not a core database handle. Core project/task routes and plugin `ProjectRef` project it. See `server/projects.ts`, `server/core/projectRefs.ts`, `server/routes/projects/{projects,tasks}.ts`, and `plugins/github/src/server/routes/repos/import.ts`. |
| Core `tasks.pull_number` | One nullable operational primary per task, interpreted with its owning project's GitHub facet. Task create/PATCH, branch adoption, and agent attachment can set it. A manual clear or replacement does not erase attachment history. It remains readable offline and after disconnect. | `server/routes/projects/tasks.ts` writes and projects it; `server/core/tasks.ts` adopts by branch across matching project clones or attaches an agent-created pull; worktree fetch reads it. See `server/worktrees/{taskWorktree,worktrees}.ts` and `plugins/github/src/server/pullDiscovery.ts`. |
| Core `task_pulls` | Primary key `(task_id,repo_owner,repo_name,pull_number)` permits several related pulls and prevents duplicate attachment. A partial unique index permits one `primary` row per task. An attach transaction checks the project repo, normalizes names, demotes the prior primary, sets an empty scalar, and records `agent`, session, and optional request provenance. Project deletion explicitly removes the rows; connection deletion does not. | `CoreServices.tasks.attachPull/pulls` in `server/core/tasks.ts` is the sole product write/read seam. `plugins/github/src/server/agentTools.ts` writes after a managed `github_pull_create`; `plugins/github/src/server/routes/pulls/taskPulls.ts` projects read-only relations for the strip. |
| GitHub plugin mirror | `repos` key `(user_id,repo_id)`; `pull_requests` key `(user_id,repo_id,number)`. Detail children and freshness remain in `github.sqlite`, with no core foreign key. Refresh/replacement may prune mirror rows without touching core identity or provenance. | `plugins/github/src/node/schema.ts`, `server/routes/mirror/{repoMirror,prMirror}.ts`, and `server/routes/pulls/pullRefresh.ts` own refresh. `server/mirrorQueries.ts` joins only inside the plugin after resolving a core task/project through services. |
| Generic core connection and external models | `integrations.id` identifies a credential, not a repository. `workspace_external_projects` keys workspace, connection, external project, and optional local project (`''` for workspace-wide). `task_links` keys task, connection, and item identifier; `issues` keys user, connection, and item. Disconnect cascades these connection-owned rows. | `server/core/projectRefs.ts`, `server/routes/projects/tasks.ts`, `server/integrations/connections.ts`, and `server/db/cascade.ts`; see [project sources](../../integrations/project-sources.md) and [core database](../../data-layer/core-database.md). |

GitHub repository identity and `task_pulls` have no stored `connectionId` in core: a local Git remote or deferred import
can identify a repository independently of a credential. The GitHub plugin chooses a usable GitHub
connection for provider calls. `githubRepoId` is a provider mirror identifier, while the owner/name
pair also supports local and offline routing. The generic workspace map scopes external projects
offered by one connection; it cannot replace a project's local repository facet without changing
its lifetime and duplicate-clone rule. `task_links` can represent a connection-scoped external
reference, but its disconnect cascade would delete Acorn-authored pull provenance. A manual task
PATCH can leave an historical `primary` relation whose role differs from the scalar; the scalar
continues to control operations, and the next attachment reconciles the relation role. `issues` is a
refreshable external-item projection. Neither is the task's operational primary or its durable agent
history. Core must not join `github.sqlite` to recover either ([schema](../../data-layer/core-database.md)).

## Delivery: writer and consumer map

| Flow | Source to consumer and contract |
| --- | --- |
| Project discovery and import | Folder add/detect parses `origin` and `origin/HEAD`; GitHub importer maps or clones a mirrored repo and stamps its ID through the narrow project service. Public `Project.github`, plugin `ProjectRef.github`, `byGithub`, and `projectDetectRoute` expose the facet. See `server/projects.ts`, `server/routes/projects/projects.ts`, `plugins/github/src/server/routes/repos/import.ts`, `packages/protocol/src/transport/api/projects.ts`, and `packages/plugin-types/src/contracts/coreProjects.ts`. |
| Primary pull writes | Public `TaskSeed.pullNumber` and task PATCH accept a positive number; GitHub promotion and pull creation call those paths. Open-pull refresh and focused discovery adopt a branch's pull only into active tasks with a null scalar. Agent creation attaches through `CoreServices.tasks.attachPull`, preserving session provenance. See `server/routes/projects/tasks.ts`, `server/core/tasks.ts`, `plugins/github/src/client/pullTasks.ts`, `plugins/github/src/server/routes/pulls/pullRefresh.ts`, `server/pullDiscovery.ts`, and `server/agentTools.ts`. |
| Public reads and cache | Task list projects `Task.github` from its project and `Task.pullNumber` from the task; archived list uses the same shape. `tasksKey` v3 and `projectsKey` v2 identify the wire projections. Task/project change events invalidate client queries; GitHub has a separate `taskPullsKey(taskId)` and pull-list/detail keys, with PR sync events. See `server/routes/projects/{tasks,projects}.ts`, `packages/protocol/src/transport/api/projects.ts`, `plugins/github/src/client/{queries,pullDetail/prTabs,pullDetail/prModel}.ts`. |
| Rendered navigation | GitHub's task source provides PR pane path, reference tracking, promotion, and import; pull tabs merge durable agent relations with mirror-derived stack and mention evidence. The client rail displays checks by `pullNumber`, the project table shows a GitHub badge, palette subtitles use `Task.github`, and task mutations can set/clear the scalar. See `plugins/github/src/client/{index,pullDetail/taskPullTabs,pullDetail/prTabs}.ts` and `packages/client-core/src/{features/tabs/TabRail.tsx,features/workspaces/ProjectTable.tsx,features/tasks/taskMutations.ts,host/palette/navigationCommands.ts}`. |
| Node, workflow, and agent | Core task context and MCP/tool projections carry repository and primary pull; worktree creation can fetch `pull/<n>/head`. The Changes plugin reads local task Git state through core's worktree service, without reading `task_pulls`. GitHub's task context, review/check tools, and mirror queries require both core identity and plugin detail. Workflow headless execution passes `project.github` to `buildSessionEnv`; its GitHub checks policy reads the plugin mirror capability. See `server/agentTools/{contextSections,coreTools}.ts`, `server/worktrees/{taskWorktree,worktrees}.ts`, `plugins/changes/src/server/localGit.ts`, `plugins/github/src/server/{contextSection,mirrorQueries}.ts`, and `plugins/workflows/src/server/runs/activation.ts`. |
| Retention and recovery | Archive keeps the task and scalar; restore uses the scalar when deciding branch recovery. Project delete removes `task_pulls`; disconnect removes connection-scoped generic rows but leaves local project/task identities and agent history. Online backup copies `core.sqlite` and each plugin SQLite file, then scrubs credentials. A restored core still has durable relations if the mirror is absent or stale. See `server/storage/{archive,backup}.ts`, `server/projects.ts`, and `server/db/cascade.ts`. |

## Delivery: decision and revisit conditions

The shared core ownership is justified by two present requirements: worktree/check/context navigation
needs a stable task primary when the provider is offline, and agent-created pull relations must outlive
mirror pruning or a credential disconnect. The GitHub shape still leaks into `Project` and `Task`
transport, plugin project/task services, core task context and worktree fetch, and the workflow
headless environment. Core's default task title uses the GitHub repo name, and `byGithub` picks the
oldest matching clone; those are historical conveniences, not requirements for a general provider
model. `integrationFlows` also lacks a loaded-plugin manifest form, separately from storage
([compiled-tier proposal](../compiled-tier.md)).

No present feature change is blocked or repeatedly complicated by the GitHub shape. The compiled-tier
proposal identifies a possible GitHub loaded-tier move, but does not schedule that move or establish
a second provider with the same repository and pull semantics. Migrating today would add a core
repository binding and task association, dual-read/write wire compatibility, a populated-data
backfill, cross-database recovery fixtures, and a deletion policy, with no consumer to exercise the
new contract. That cost outweighs the measured benefit of zero unblocked changes.

Revisit only when an approved loaded-tier GitHub move needs a manifest-backed repository binding,
or a named feature/provider cannot use the present project/task contracts and records the blocked
call path. First test whether `integrations`, `workspace_external_projects`, and `task_links` can
carry its scope without losing offline identity or provenance. A future assignment must name the
consumer, use the existing generic owner, specify additive old/new wire behavior, backfill and
cutover from populated core rows, rollback, deletion conditions, and fixtures for duplicate clones,
two connections with equal pull numbers, multiple pulls, offline/disconnected reads, interrupted
migration, and backup/restore. Keep phase 15 on combined acceptance and list this retention as debt;
do not claim the coupling was removed.
