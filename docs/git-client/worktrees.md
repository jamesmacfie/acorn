# Git worktrees

The compiled Git plugin shows registered worktrees for the selected project's repository. This page
covers its first slice: inventory, task checkout identity, and guarded cleanup.
For commit browsing and revision diffs, see [Git history](./history.md).

## Ownership and routes

`plugins/git/src/server/worktreeRoster.ts` reads Git's NUL-delimited worktree roster on the selected
Node. The route resolves a project ID through core, then asks Git for the repository root. It does
not accept a client-supplied working directory. The Git source registers a project-scoped list and
detail region; the task pane has one model per task and shows its recorded branch beside its own
checkout branch and HEAD. Inspecting another worktree labels it separately.

The plugin uses the public core facade for project mappings, active task projections, and Git
subprocesses. Core remains the owner of task creation and archive. Open a task from its worktree row
to inspect or archive it. The external worktree manager remains installed until the replacement
acceptance in phase 04.

## Inventory

The Node reads `git worktree list --porcelain -z`. It resolves existing paths through the filesystem
and resolves missing registrations through their nearest existing ancestor. That gives symlinked
project mappings and task paths the same identity. The list includes the main checkout, detached
HEAD, locked and prunable registrations, task owners, last commit, and up to 100 changed file paths
per worktree. A truncated list says so. Git reads have bounded output and use batches of eight
worktrees. Each row has a stable ID made from the canonical repository and worktree paths. A
separate observation token includes mutable roster fields and is used only for cleanup. Moving HEAD
keeps the selected row while making an old cleanup request stale.

The client caches each inventory by Node and project. Refresh, selected-Node reconnect, worktree
events, and local or broadcast task changes invalidate it in both the source and task pane. Reads
stay local; refresh does not fetch from a remote. A failed refresh leaves previous rows visible with
a stale-data alert; the first read has a loading state and then an error if it fails. Selection clears
when its worktree leaves the roster or the selected Node/project changes. A cleanup response updates
only its original Node and project cache, and leaves a later selection in place.

## Cleanup

The Node accepts a worktree's observation hash, not a path. It permits only a paired device. Before
calling Git, it re-reads the roster and task ownership inside a repository-local cleanup guard.
It refuses the main checkout, locked, dirty, unreadable, and task-owned worktrees. Task-owned
cleanup uses core's archive flow. For a missing registration, Git's `worktree prune` affects the
repository; cleanup checks every prunable registration for task ownership or locks first. It prunes
with `--expire=now` so a newly missing registration is eligible, then checks the refreshed roster
before reporting success. It never uses force removal.

The response contains a fresh inventory even when Git refuses the command. Another process can
change a repository after the check; Git's refusal and the refreshed inventory show the actual
result. Acorn's cleanup guard serializes this plugin's requests on one Node process, not external
Git clients.
