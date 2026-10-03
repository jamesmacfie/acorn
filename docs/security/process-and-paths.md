# Process, path, and configuration controls

This page covers how a Node confines filesystem paths, spawns children, and decides when repository
configuration may run. Read it before you touch a path, a spawn, or a script column. It's part of the
[security model](../security.md).

## Paths

Plugins use `CoreServices` for filesystem access and Git. The filesystem service applies one
symlink-aware confinement policy to the data root and worktrees, `resolveInRoot` in
`packages/node-core/src/server/core/fs.ts`. A worktree holds arbitrary checked-out content, including
a symlink an untrusted branch added that points at `~/.ssh`, so a lexical check alone isn't enough.

`resolveInRoot` tells an absent entry from a dangling symlink with `lstat`, and refuses a link it
can't resolve rather than approving its parent. A new path under a real in-root directory, and an
alias that resolves inside the root, stay valid. Editor writes, Changes disk reads and unstaged diffs,
and both ends of worktree file copies use it. The one exception is the Docker plugin's container-label
matcher, which compares paths the daemon reports inside a container namespace, where resolving
against this host's filesystem would be wrong.

**A known limit.** `resolveInRoot` is check-then-use. Nothing validates again between the check and
the open, so an agent that can write in its own worktree can swap a path component for a symlink in
that window. It's hard to hit, and the fix is an `O_NOFOLLOW`-style open rather than a tighter check.
Process isolation wouldn't fix a race in the Node's own filesystem service.

## Processes

Short-lived work goes through the process broker, `packages/node-core/src/server/core/proc.ts`. It
uses explicit working directories, environment allowlists, process-group termination, bounded
output, and production timeouts ([child environments](./credentials.md#child-environments)).

Long-lived engines own their own children under the same environment rules: a PTY, a JSON-RPC agent
driver, a `docker logs -f` stream, a ripgrep scan, or a Postgres client. Each outlives a request and
streams as it goes, which doesn't fit "run a bounded command and kill its group". They're an
enumerated set: `tools/arch/boundaries.test.ts` lists every file allowed to import
`node:child_process`, each with its reason.

## Executable configuration

Executable configuration is hash-gated: the repository's own `.acorn/config.toml`, workflow files,
and URL scripts, **and the project row's script columns**. The exact snapshot must be acknowledged
before execution, and a changed snapshot fails closed with `needs-trust` or `config-changed`
(`server/repoConfigTrust.ts`).

The project row is in the snapshot because the gate assumes only the owner can write the database.
`PUT /v1/core/projects/:id/config` is device-only, so that holds, and the row in the hash is the belt
behind that gate. A write the owner didn't make changes the hash, and the next thing that asks for
trust shows the script instead of running it. `run_targets` is hashed with the five script columns,
because its JSON holds `command`, `stop`, and `restart` strings the run pane executes.

Three call sites assert trust, the ones where the checkout authored what runs: a run target whose
winning layer was the repository's config file, a `db_url_script` from the same place, and a
workflow defined in the repository. Setup and teardown scripts run from the project row without
asking, because the owner typed them into the settings form.

Run-target resolution captures the snapshot before it parses the repository config, and returns its
hash through `core.tasks.runConfig`. Terminal passes that hash to `core.projects.assertConfigTrusted`
for repository-authored starts and restarts, so the gate rejects drift even when the file on disk has
gone back to acknowledged bytes. A running instance keeps its admitted URL and stop commands.

Snapshots accept regular files inside the repository root, including internal symlink aliases.
Nonblocking opens reject special files before reading. Each file and the project settings entry are
capped at 1 MiB, the formatted snapshot at 8 MiB, and the snapshot at 256 files
(`server/repoConfigSnapshot.ts`). Workflow directory scans stop after 1,024 entries. Unsafe or
oversized input fails closed. These static checks don't remove a path swap between check and use.

`.acorn/config.toml` reports `[scripts] setup` and `[scripts] archive` as unread. Wiring them would
make a committed file run a command on worktree creation and on archive, and neither path asks this
gate. The `[docker]` table is read without the gate, but its bounded read contributes summary hints
only. Task listing and cleanup work out association without those hints.

## Workflows

- A definition stored as a `workflow_defs` row has no committed bytes to hash, so it's owner-typed
  instead. Every route under `/v1/p/workflows/defs` is device-only. Root workflow starts over HTTP
  need a device principal for file and row definitions alike, and refuse task and service tokens
  before reading the body. Trusted schedules and child dispatch enter through their own admission
  capabilities.
- A gate answer is device-only. `POST …/runs/:runId/gate` refuses a task token with 403 even on its
  own run, because the agent in the run holds that run's credential. Retry is refused for the same
  reason. Cancel and kill stay open to the run's own task, because both only stop work. A foreign or
  unknown run answers 404 first.
- A child workflow resolves in its parent task's workspace and project before any child task exists.
  Repository definitions go through the trust check again. The child gets its own task token, never
  the parent's. Its tool ceiling, turn, token, and cost limits, and deadline can only narrow the
  root's. The resolved graph and limits are persisted, so restart recovery can't gain authority from
  an edited definition. Cancellation closes admission before it stops descendants.

[workflows.md](../workflows/definitions.md#database-definitions) owns the definition model.

## Docker, URLs, and Git

- Docker task listings and teardown use host-stored worktree roots and the daemon's working-directory
  metadata. Cleanup targets full container IDs, never a project-wide name. Global Docker HTTP actions
  need a device. Docker WebSocket channels admit device and service principals and refuse a
  task-confined socket. See [Docker](../docker.md).
- External URLs opened through the OS pass a scheme allowlist. Preview navigation is limited to HTTP
  and HTTPS URLs without userinfo.
- **Force push uses `--force-with-lease`, never a bare `--force`** (`pushArgs` in
  `plugins/changes/src/server/localDiff.ts`). The lease compares the remote ref with this Node's
  remote-tracking ref, so a commit someone pushed since the last fetch fails the push instead of
  disappearing. The reader arms the menu item and presses it again, the lease holds, and no
  `changes:before-push` handler vetoes. The payload carries `force`, so a branch-protection plugin can
  refuse that push alone ([plugins.md](../plugins.md#hooks)).
- The abort verb is offered only while the Node's status read says a merge or rebase is in flight, and
  which one to abort is read off the worktree rather than the request.

## Why

Before the broker, about sixteen call sites spawned children their own way. Terminal's preview
capture ran a repository script through `/bin/sh -c` with the Node's full environment, secrets
included, and no output cap. A Docker denylist pointed at a file that no longer existed. Only one site
killed the process group, so a hung child's grandchildren kept the pipes open. An allowlist with
explicit passthrough replaced all of it.
