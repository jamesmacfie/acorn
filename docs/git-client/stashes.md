# Git stashes and checkout admission

The Git source and task pane list repository stashes. This page describes their write contract and
the Node guard that coordinates checkout changes with Agents and Workflows.

## Browse and inspect stashes

Open **Git > Stashes** for the selected project, or choose **Stashes** in a task's Git pane. The
roster comes from Git on the selected Node and includes each stash's immutable object ID, current
selector, message, origin branch, creation time, base commit, and captured untracked paths.
The detail compares tracked changes with the stash's base through the same segmented revision
viewer as [Git history](./history.md). **Captured untracked content** opens the untracked parent
as an empty-tree comparison in the same viewer. The stash's index and untracked parents are not
history merges.

The source asks you to choose a target task. The task pane fixes that target to its task. Each
dialog shows its captured Node, project, task, and stash identity. A moved target or changed Node
or project requires a new dialog. Failed writes leave the message and option values in place.

## Change a checkout

`plugins/git/src/server/routes/stashes.ts` accepts paired-device requests with strict typed bodies.
The Node resolves project and task IDs through Core, verifies their common Git directory, and
checks the target's mapped checkout path. An unmaterialized task worktree cannot become a request
to change its project's main checkout.

**Create stash** requires a message. It stashes tracked changes by default. **Include untracked**
adds untracked files, excluding ignored files. **Keep staged changes** keeps the index. The Node
refuses an empty selection, unresolved conflicts, or an active Git operation. **Apply** and **Pop**
refuse a dirty target and offer an explicit **Restore staged changes** option. Apply uses the
immutable stash object and keeps the stash. Pop applies the object, then removes the selected
roster entry only after a fresh selection check. A conflict retains the stash and reports files to
resolve through **Changes** or Editor. **Drop** requires a destructive confirmation and does not
touch a checkout. No stash operation resets, cleans, or discards a checkout automatically.

The request carries object ID, current selector, and a fingerprint of the entire stash roster.
`plugins/git/src/server/stashes.ts` rechecks all three under a Git common-directory write queue before
using the selector. Identical stash objects in different roster entries remain separate actions.
Git and Changes refresh after attempted checkout writes, including failures that may have changed
files. A failed pop can therefore leave applied files and a retained stash; the response says so.

## Admit work and writes

`packages/node-core/src/server/core/checkoutAdmission.ts` owns the guard. It serializes Acorn's
durable work admissions and checkout writes by the Git common directory, including project aliases.
Within a write, it resolves the target checkout again and asks Agents and Workflows for activity on
every task sharing that checkout, including archived tasks whose owner work is still settling.
Agents reads durable nonterminal turns and live session states;
Workflows reads durable nonterminal runs. Missing readers and unknown states block a write. An idle
session with no work does not block it.

Agents admits a queued turn or a Codex plan continuation under the guard. Workflows admits a new
run or retry under it. The Workflow runner releases admission before ticking the graph, since a
tick can enqueue an Agent turn. Core uses the same guard for lazy task-root preparation and archive
claims. An archive claim remains visible until teardown settles. The guard releases in `finally`
after a write, even when Git refuses or throws.

This is a process-local coordination rule. External Git clients and terminals do not participate.
An external process can change a stash reflog between Acorn's final check and Git's command. The
roster fingerprint narrows that interval but cannot make two processes transactional. Inspect the
refreshed roster and checkout after a refusal.

## Routes

All routes live under `/v1/p/git/projects/:projectId/stashes`:

| Method and suffix | Result |
| --- | --- |
| `GET /` | Current stash roster and fingerprint |
| `POST /` | Create from an explicit task checkout |
| `POST /apply` | Apply an immutable object to an explicit task |
| `POST /pop` | Apply, then remove the freshly checked roster entry |
| `POST /drop` | Confirmed repository stash removal |

The wire types are in `plugins/git/src/shared/api.ts`. They include the captured target path as a
comparison token; the server never uses that client value as a working directory.
