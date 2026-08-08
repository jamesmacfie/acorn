# Phase 5 — Drop legacy tables + docs rewrite (COMPLETED; completed record)

Prerequisite: ALL other phases shipped and soaked. This is the point of no return for the legacy
model — do it last, after at least one release has run on Phases 2-4 without reaching for the
`.bak`.

## Migration 0048

1. **Rekey `config_acks`**: `repo` TEXT ("owner/name") → nullable `project_id`. Rebuild the table;
   backfill by joining `repo = github_owner || '/' || github_name` (oldest project wins, same
   rule as everywhere). **Preserve the hashes and snapshots verbatim** — trust is keyed by hash;
   the project id only scopes it. Getting this wrong either re-prompts the user for every repo
   (annoying) or silently re-trusts changed config (dangerous). A migration test asserting
   hash survival is mandatory.
   - Code: `packages/node-core/src/main/repoConfigTrust.ts` (where `assertConfigTrusted`
     reads acks — follow it from `CoreServices.repos`) moves to project-keyed reads.
2. **Drop** `repo_paths`, `workspace_repos`, `ignored_repos`.
3. **Rename** `workspace_projects` → `workspace_external_projects` — the name collision with the
   new project concept was called out at planning time; these are Linear/Rollbar EXTERNAL
   projects. Rename the protocol types too: `WorkspaceProject` → `WorkspaceExternalProject`,
   `WorkspaceProjectsResponse` → `WorkspaceExternalProjectsResponse`, and the route
   `GET|PUT /v2/core/workspaces/:id/projects` → `/external-projects` (client callers: the
   workspace settings surface that links Linear/Rollbar projects).
4. **Drop** `tasks.repo_owner`, `tasks.repo_name` (table rebuild). By now nothing reads them —
   the github plugin works off the project facet and `task.github` on the wire (Phase 2/3).

Keep the pre-migration backup posture: this migration is destructive; `openDb` should take a
fresh timestamped `.bak` before it runs (extend the structural detection in
`packages/node-core/src/main/bindings.ts` — e.g. "repo_paths exists" is again the trigger, since
this is the migration that removes it).

## Code deletion sweep

- `packages/node-core/src/main/repoPaths.ts` — the whole module (`getRepoPath`, `setRepoPath`,
  `setRepoConfig`, `setRunTargets`, `remoteMatches`). Anything still importing it is a bug this
  sweep exposes; config reads/writes live on `main/projects.ts` + `/v2/core/projects` by now.
- The dual-write helpers in `main/projects.ts` (`syncLegacyMembership`, `syncLegacyCheckout`,
  `syncLegacyConfig`) and `reconcileLegacyProjects` + its `openDb` call.
- `workspaceIdForRepo` and any remaining legacy-pair fallbacks in `taskWorktree.ts`.
- The **v1 importer** (`packages/node-core/src/main/v1Import.ts`) writes
  `repo_paths`/`workspace_repos`/`tasks` directly. Either rewrite it to mint projects (small —
  it already has paths + github ids) or retire it; it cannot survive the table drops unchanged.
  Decide with the owner: v1 installs may all be migrated by then.
- `packages/protocol`: delete `WorkspaceRepo`, `RepoAssignment`, the `RepoPath`/repo-config wire
  types in `terminal.ts` superseded by project config, and `Workspace.repos` (the workspace's
  project list comes from `GET /v2/core/projects` filtered by workspaceId, or embed
  `projects: string[]` — pick one during Phase 2 and finish it here).
- `apps/desktop/test/*` and node-core route tests that exercise deleted routes.

## Docs rewrite

- `docs/workspaces-and-tasks.md` — the product model: Workspace → Project (folder; optional git;
  optional GitHub) → Task (project + optional branch + optional worktree). Repository
  configuration section becomes project configuration; note branchless tasks and that setup
  scripts only run on worktree creation.
- `docs/architecture-overview.md` — the Product model diagram and "A repository belongs to one
  workspace" paragraph; task origins list; the data-ownership section's mention of repo
  configuration.
- `docs/data-layer.md` — table inventory (projects in, the trio out; plugin project_id columns).
- `docs/authentication.md` — already rewritten in Phase 0; re-read for stragglers.
- `docs/github-integration.md` — GitHub as importer + PR viewer; not required; disable-able.
- Delete or archive this `docs/projects/` folder's phase files into a completed-record note
  (the repo keeps completed implementation records under `docs/legacy/` — follow that
  convention).

## Verification

- Migration test: seeded pre-0048 DB → matched and unmatched acks survive with hashes/snapshots
  intact, tables gone, rename done.
- `grep -rn "repo_paths\|workspace_repos\|ignored_repos\|repoOwner\|repo_owner" packages plugins apps`
  returns only the github plugin's PR-domain uses (PR head/base repos are GitHub's, not ours) and
  historical migrations.
- Full `pnpm lint`, all suites, boundaries test, desktop e2e, and a manual upgrade test: take a
  real pre-migration `core.sqlite` (or the `.pre-projects.bak` from Phase 1), boot the app on it,
  confirm workspaces/tasks/config/trust all survive the whole chain 0046→0049.
