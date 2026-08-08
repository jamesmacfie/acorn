# Phase 2 — Protocol + client cutover (IMPLEMENTED; completed record)

The break-the-wire phase: tasks stop being keyed by `(repoOwner, repoName, branch)` and become
`(projectId, branch?)`. The client moves to project-based URLs, task creation, and settings.
Ship node + desktop together; older paired clients break (accepted — user base is tiny).

**Read phase-1-projects-schema.md first.** Everything here assumes the dual-key state it
describes, and this phase's job is to retire the "dual" half of it.

## Deliverables

1. Migration 0047: rebuild `tasks` — `repo_owner`, `repo_name`, `branch` become **nullable**;
   `project_id` effectively required (enforced in code, not by NOT NULL — see below).
2. `taskWorktree.ts` resolves everything through the project row instead of `repo_paths`.
3. Task creation accepts `{projectId, branch?}`; branchless tasks run in the project root with
   no worktree.
4. Protocol reshape + client compile-fix sweep.
5. New URL scheme; core owns the primary routes.
6. Projects manager UI (replaces `WorkspaceRepoAssignments`) with "Add folder…".
7. Delete the legacy `(owner,name)` server routes and the dual-write mirrors that only they used.

Recommended order: 1 → 2 → 3 (server, testable in isolation) → 4 → 5/6 (client) → 7 (cleanup last).

## 1. Migration 0047 — tasks rebuild

Schema change in `packages/node-core/src/server/db/schema.ts`: drop `.notNull()` from
`repoOwner`, `repoName`, `branch` on `tasks`. Then `pnpm --filter @acorn/node-core db:generate`.

- drizzle will emit a table rebuild (`CREATE __new_tasks` + `INSERT INTO __new_tasks SELECT …` +
  drop/rename). Verify the generated SELECT lists only existing columns (the NOT-NULL rebuild
  quirk documented in README applies in reverse too — usually fine when only relaxing, but the
  check script will tell you).
- Do NOT add `NOT NULL` to `project_id` in this rebuild. Every code path stamps it since
  Phase 1, the backfill filled it, and `reconcileLegacyProjects` repairs strays — but a NOT NULL
  would make the rebuild fail on any row the reconcile hasn't seen (a DB restored from backup,
  for example). Enforce at the route boundary instead: task create 500s/400s without a resolvable
  project.
- Semantics after this migration:
  - `branch = NULL` → "this task runs in the project root; no worktree is ever created". This
    REPLACES the old `branch='HEAD'` + `worktreePath === checkout` marker convention
    (`use-checkout` route + `TabRail.tsx` seeding `'HEAD'`). Migrate those rows:
    `UPDATE tasks SET branch = NULL WHERE branch = 'HEAD'` is tempting but wrong — the marker
    was `worktreePath == the mapped checkout path`, not the branch string. Correct backfill:
    null out `branch` where `worktree_path` equals the owning project's `path`. Append it to
    0047 by hand.
  - `repo_owner`/`repo_name` stay POPULATED (from the github facet) for github-backed projects
    until Phase 5 drops the columns — the github plugin still keys its adoption and PR flows on
    the pair.

Extend `packages/node-core/src/server/db/projectsBackfill.test.ts` (or add a sibling) with a
seeded 0046-state DB asserting the 0047 rebuild + the HEAD-marker backfill.

## 2. `taskWorktree.ts` cutover

`packages/node-core/src/main/taskWorktree.ts` is the single choke point — every pane, terminal,
agent, and tool resolves its cwd through `taskRoot` → `resolveTaskCwd`. Today it reads
`getRepoPath(t.repoOwner, t.repoName)`. Replace with project resolution:

```ts
// The task's project: by id, with the legacy pair as fallback until Phase 5.
const project = t.projectId ? await getProject(db, t.projectId)
                            : await projectByGithub(db, t.repoOwner!, t.repoName!)
```

Then, function by function:

- **`taskRoot`**: base checkout = `project.path` (isDir-checked). Null project or null path →
  null root, exactly as an unmapped repo behaves today. Panes already handle null.
- **`resolveTaskCwd`**: add the branchless short-circuit BEFORE ensureWorktree:
  `if (!t.branch) return { cwd: baseCheckout, isWorktree: false, created: false }`.
  For branched tasks the flow is unchanged, but `ensureWorktree`'s dir-name inputs
  (`owner, repo`) must come from the project when the task has no pair:
  `owner = t.repoOwner ?? 'p'`, `repo = t.repoName ?? slugify(project.name)` (reuse
  `slugifyBranch` from `@acorn/protocol/branch.ts` for the slug; `worktreeBranchDirName` in
  `pathGuards.ts` builds the final name). Existing worktrees are untouched — tasks hold
  absolute `worktreePath`s.
- **`baseRefPref`**: key becomes `base_ref:<projectId>`. Append a prefs rewrite to 0047:
  `UPDATE prefs SET key = 'base_ref:' || p.id FROM projects p WHERE prefs.key = 'base_ref:' || p.github_owner || '/' || p.github_name`
  (oldest project wins when two clones share a pair — match the `projectByGithub` rule by
  joining on the min-created row, or accept the ambiguity: the pref is a convenience).
- **`repoSetup(owner, repo)`** → `projectSetup(project)`: read `setupScript`/`setupScriptTrigger`
  off the project row. Caller is `worktree.ts` `/tasks/:id/on-created`.
- **`copyConfiguredFiles`**: config from the project row instead of `getRepoPath`.
- **`taskRunConfig`**: same swap; `loadRepoConfig`'s DB-fallback fields come from the project.
- **`workspaceIdForRepo`/`workspaceIdFor`**: single-hop `project.workspaceId`. Keep the legacy
  join as fallback only while `projectId` can be null (pre-0047 rows repaired by reconcile).
- **`taskContext`** (session `repo`/`pull` fields): `repo` becomes undefined when the task has no
  pair. Check `TerminalSession` consumers in plugins/terminal for null-safety.
- **`computeTaskStatuses`**: no change needed — it keys on `worktreePath` being set, and
  branchless tasks never set it. But CHECK the archive path (below).
- **`buildSessionEnv`** (`packages/node-core/src/main/taskEnv.ts`): add `ACORN_PROJECT_ID` and
  `ACORN_PROJECT_NAME`; keep `ACORN_REPO`/`ACORN_BRANCH` populated when the facets/branch exist —
  users' setup/teardown scripts may reference them.

### The archive guard — subtlest correctness risk in this phase

`packages/node-core/src/main/archive.ts` must NEVER delete a folder that is the project itself.
Today the guard is `borrowsCheckout`: `worktreePath === mapped checkout path` (via
`getRepoPath`). Generalize it to `worktreePath === project.path` (project resolved as above).
Branchless tasks keep `worktreePath` null so they present nothing to delete, but the OLD
checkout-marker rows (pre-0047 `use-checkout` tasks) have `worktreePath == project.path` and the
guard must keep holding for them after `getRepoPath` is gone. Write a test for exactly this
before touching archive.

### Workflow fan-out

`createChild` (`packages/node-core/src/main/core/tasks/service.ts`) derives + dedupes a branch
unconditionally. For a child of a task on a **non-git project**, skip branch derivation and
create the child branchless. Gate on `parent project.vcs !== 'git'` (not on parent.branch — a
branchless parent in a git project may still want branched children; decide and document in the
code, but the simple rule "children inherit branchlessness from the PROJECT's vcs facet" is
defensible and easy).

## 3. Task creation contract

`packages/protocol/src/api.ts`:

```ts
export type TaskSeed = {
  title?: string
  icon?: string
  origin: Task['origin']
  projectId: string          // REQUIRED going forward
  branch?: string            // absent/empty → branchless (run in project root)
  pullNumber?: number
  links?: TaskLinkSeed[]
}
export type Task = {
  …
  projectId: string
  branch: string | null
  // Server-derived display convenience so the client never joins:
  github: { owner: string; name: string } | null
  // repoOwner/repoName REMOVED from the wire (the DB columns survive until Phase 5)
}
```

`routes/tasks.ts` POST: validate `projectId` resolves; derive and store the legacy pair from the
project's github facet (nullable); default title falls back to `project.name` when there's no
pair/branch. `use-checkout` route and `createCheckoutTask` client mutation are superseded by
branchless creation — delete both once TabRail is cut over.

## 4. Client compile-fix sweep

Flipping the protocol types makes `tsc` enumerate every affected site — that IS the work plan.
Known hot spots from exploration:

- `packages/client-core/src/tabs/TabRail.tsx` — new-task dialog: repo dropdown becomes a project
  dropdown (from `GET /v2/core/projects`, hidden-filtered, workspace-scoped); branch
  derivation (prefix → slugify → dedupe, lines ~91-101) only for projects with `vcs === 'git'`;
  the "use current checkout" toggle disappears (branchless replaces it); origin icon map keys
  off task origin as before.
- `apps/desktop/src/app/client/App.tsx` — active-workspace derivation (`workspaceForRepo`,
  ~line 218) becomes project-based; the workspace-restore effect (`activeWorkspace`) keys off
  project ids. **Respect the memory note: rail source restore is owned by ONE activeWorkspace
  effect in App.tsx — don't add selectedSource writes elsewhere.**
- `packages/client-core/src/workspaces/mutations.ts`, `queries.ts` — `setRepoWorkspace` etc.
  become project mutations against `/v2/core/projects/:id`.
- `packages/client-core/src/workspaces/WorkspaceRepoAssignments.tsx` — becomes the Projects
  manager: list projects with facet badges (plain / git / GitHub), workspace dropdown, hide
  toggle, **"Add folder…"** (native picker via the existing `api.repoPath.pick()` bridge —
  `plugins/terminal/src/main/pickerIpc.ts`, desktop-gated), and a "clone or pick folder" action
  on path-NULL projects (PATCH `:id` with `path`). Used by both onboarding modal and Settings.
- Panes reading `task.repoOwner`: changes pane header, github plugin PR pane, docker matcher
  label, http/database saved scopes. The github plugin client keeps working off `task.github`.
- **IndexedDB persisted-query gotcha**: `Task` gains required fields → bump the tasks query key
  (see memory/README note) or stale cached task shapes will hydrate into the new components.

## 5. URL scheme

Core takes over the primary routes (today the github plugin contributes `/:owner/:repo{,/new,/:number}`
as the app's URL space — `plugins/github/src/client/routes.ts`, mounted in
`apps/desktop/src/app/client/index.tsx`):

```
/                          restored last view (existing workspaceView memory)
/p/:projectId              project home (task list / new task)
/p/:projectId/new          create task
/t/:taskId                 task view (projectId derivable; keeps task links short)
/p/:projectId/pulls        github plugin contribution (gated: github facet + connected)
/p/:projectId/pulls/:n     PR viewer
/settings/projects         projects manager
```

- `SourceRouteContribution.kind 'repo'` → `'project'`; `sourcePath()` param maps become
  `{projectId}`.
- Old `/:owner/:repo` deep links die. The persisted last-view state will hold dead routes for one
  release: verify the restore path in App.tsx falls back to the default view instead of
  404-looping (it already has a fallback for unresolvable state — confirm it fires).
- `useParams()` returns `string | undefined` — key panels on a memo of the param or a project
  switch leaks the previous draft (this exact bug existed before; see the HTTP panel).

## 6. Delete the legacy surface (end of phase)

Once the client no longer calls them: `PUT /v2/core/repos/path`, the repo-config/run-target
routes keyed by (owner,repo) in `server/routes/worktree.ts` (move their bodies onto
`/v2/core/projects/:id/config` + `/run-targets` — same Zod schemas, project-keyed),
`use-checkout`, `createCheckoutTask`, and the parts of `repoPaths.ts` + dual-write mirrors that
only those routes used. `setRepoPath`'s github-remote validation dies with it. Keep
`repo_paths` TABLE and `reconcileLegacyProjects` until Phase 5 (the v1 importer still writes
legacy rows).

## Verification

- Unit: extended backfill test (0047 + HEAD-marker), archive-guard test, resolveTaskCwd
  branchless test, createChild non-git test.
- e2e (`apps/desktop/e2e/desktop.smoke.spec.ts` is the model; it already seeds a workspace +
  repo + local task with a dummy GitHub client id):
  1. Add a plain temp folder as a project → create task → terminal opens with cwd = folder,
     editor lists files, find-in-files works, changes pane shows an explicit "not a git repo"
     empty state (NOT a silent empty list — that's a Phase 2 UI decision, gate the pane or give
     it a real empty state).
  2. `git init` folder → detect → create branched task → worktree created, changes pane works.
- **UI cannot be verified from a git worktree checkout** (no `.env`; port 4317 may be a live
  instance) and vitest cannot render Solid components. Run the app from a full checkout
  (`pnpm dev` per docs/local-development.md) and click through the flows above before calling
  this phase done.

## Risks recap

- Archive deleting a project folder (guard test first).
- Branchless × rail dirty markers / footer: `worktreePath` stays null so markers just skip —
  confirm the footer's "no worktree" copy makes sense for a folder project ("runs in project
  folder" beats "no worktree yet — open a terminal first").
- Setup scripts: the WORKTREE_CREATED hook never fires for branchless tasks, so setup scripts
  silently don't run. Surface that in the projects UI (config section note) rather than
  pretending they will.
- Stale IndexedDB query cache (bump keys).
- Older paired clients break at the wire — ship node + desktop together.
