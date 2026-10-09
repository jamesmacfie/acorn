# Git refs, remotes, comparison, and settings

The Git plugin reads and changes repository refs through the selected Node. **Git > Refs**, **Remotes**, and **Compare** use the project's mapped repository. Checkout remains a Core task operation; selecting a branch in Git does not change a task's recorded branch. Launch a task or workflow from a ref through the pinned launch contract described in [Git worktrees](./worktrees.md).

## Refs and remotes

The ref roster distinguishes local branches, remote-tracking branches, and tags. It includes immutable object and commit IDs, upstreams, checked-out worktrees, and task reservations. Branch creation takes a pinned start ID. Rename, delete, and upstream edits include the observed branch ID and recheck it at write time. The Node refuses mutations of branches checked out in any worktree or reserved by a task across aliases of the same object store, including pending and archiving tasks. Tags can be lightweight or annotated; deletion rechecks the tag object ID.

The remote roster includes fetch and push URLs and the last fetch success or failure per remote. Add, remove, URL edit, and fetch use an explicit remote name and recheck the observed URL. The Node accepts HTTPS, SSH, Git, file, and absolute local URLs. Git receives argument arrays and an explicit protocol allowlist, so an executable remote helper cannot run. Manual fetch and scheduled fetch report failures with the refreshed remote roster.

Task pull and push remain Changes operations. Git uses Changes' public remote contract and selects a task explicitly. Changes retains its before-push hooks, fast-forward or rebase pull behavior, and force-with-lease checks. A force push carries the remote object ID observed by the person as an explicit lease; a later fetch cannot silently broaden that lease.

## Pinned comparisons

**Compare** resolves the selected source and destination refs or full commit IDs once, then uses their pinned IDs in the URL. Direct mode compares the source tree with the destination. Merge-base mode compares their shared ancestor with the destination. The direction, mode, and base ID stay visible. Comparison uses the history viewer's bounded topology, segmented diff, search, and file reads. Refreshing the view does not move either endpoint when a branch advances.

## Settings and scheduled fetch

The Node settings page reads effective `user.name` and `user.email` with their Git scope and origin, plus local and Node-user-global values. The form selects one write scope explicitly. A repository-local value can override a global write; readback shows that override. Name and email writes report success separately so a partial failure leaves the unsuccessful input in the form. The Node user global config is used; Acorn does not write the client's home directory.

Pull policy is fast-forward only by default or rebase when selected. Device settings control graph visibility and the shared diff presentation. Automatic fetch is off by default. When enabled, a Node timer checks every five minutes, groups project aliases by Git common directory, and fetches at most two repositories concurrently. A disabled or disposed scheduler cancels its work. Client reads, mounts, and refreshes do not start a fetch. The remote roster exposes the most recent success and failure.

## Routes

All routes require a paired device and resolve `:projectId` through the Node project mapping. Wire types live in `plugins/git/src/shared/api.ts`.

| Route | Result |
| --- | --- |
| `GET, POST /v1/p/git/projects/:projectId/refs` | Ref roster or guarded ref mutation with post-state |
| `GET, POST /v1/p/git/projects/:projectId/remotes` | Remote roster or guarded remote operation with post-state |
| `POST /v1/p/git/projects/:projectId/comparison` | Pinned source, destination, mode, and base IDs |
| `GET, POST /v1/p/git/projects/:projectId/settings` | Scoped identity and Node preferences, or identity write and readback |

See [Git history and revision diffs](./history.md) for revision and segmented diff routes.
