# Docker

acorn's Docker plugin has two presentations over one Node-side service: an always-visible
fleet **Source** and a conditional task **pane**. It shells out to the local Docker CLI; there is no
daemon SDK, remote Docker endpoint, or Docker state in SQLite.

## Surfaces

The Docker Source is an OrbStack-style master/detail browser. It groups containers by Compose
project and also exposes images, volumes, and networks. From it an interactive user can inspect
metadata, follow logs and stats, open an exec terminal, start/stop/restart/pause/unpause containers,
run Compose lifecycle actions, remove resources, and prune unused resources. Built-in networks are
not removable. Settings control stopped-container visibility and destructive confirmations.

The task pane uses the same container detail component but only shows containers matched to the
task. It is absent when there are no matches. A rail slot and a task-footer slot show running/total
counts even when the pane is closed. Archiving a task can ask to tear down its linked containers:
Compose projects receive `docker compose -p <project> down`; loose running containers are stopped;
volumes are deliberately retained.

## Task matching

Matching is pure and ordered from strongest signal to weakest:

1. A container's `com.docker.compose.project.working_dir` equals or is inside the task worktree.
2. `[docker].compose_project` exactly matches the Compose project.
3. Any label named in `[docker].match_labels` has a value equal to the task branch slug.
4. When `match_name` is true (the default), the container or Compose-project name contains the
   branch slug. Slugs shorter than six characters are rejected to avoid matches such as `main`.

Configuration layers as defaults ← `~/.acorn/config.toml` ←
`<worktree>/.acorn/config.toml`:

```toml
[docker]
compose_project = "acorn-feature"
match_labels = ["acorn.task"]
match_name = true
```

These values are declarative names/label keys, not commands. They therefore do not use the
repo-authored executable-config trust gate. Commands that start Docker belong in trusted
`[scripts.run.*]` targets.

## Runtime and event flow

`plugins/docker/main/dockerService.ts` owns a small in-memory cache: daemon info for 10 seconds and
resource lists for 5 seconds. The list TTL is only a backstop. A long-running `docker events`
process invalidates affected scopes and emits a debounced `docker:changed` frame through the shared
authenticated WebSocket; clients then refetch the relevant list or task summary. The watcher
restarts with exponential backoff.

Logs and stats also stream through that WebSocket. Exec uses a separate interactive channel with
input and resize frames. The service caps concurrent Docker stream children at 32 and kills all
watchers/streams during app teardown. No log, stats, or exec output is persisted.

## Internal routes

All routes sit behind the normal cookie/CSRF/user gate and delegate through the Node-side Docker
bridge. A missing bridge returns `503`; missing CLI/daemon and Docker conflicts are typed errors.
Every resource reference is shape-checked, including a leading-dash guard, before it reaches argv.

| Method and path | Purpose |
| --- | --- |
| `GET /api/docker/info` | CLI/daemon availability, version, context |
| `GET /api/docker/containers` | Container inventory |
| `GET /api/docker/containers/:ref/inspect` | Normalized container detail |
| `POST /api/docker/containers/:ref/action` | Start/stop/restart/pause/unpause |
| `POST /api/docker/containers/:ref/remove` | Remove, optionally forced |
| `GET /api/docker/images` · `volumes` · `networks` | Resource inventories |
| `POST /api/docker/{images|volumes|networks}/:ref/remove` | Remove a resource |
| `POST /api/docker/prune` | Prune containers/images/volumes/networks/builder cache |
| `POST /api/docker/compose/action` | Compose start/stop/restart/down by project |
| `GET /api/docker/task-summary` | Counts/projects for all active tasks |
| `GET /api/docker/tasks/:id/containers` | Containers linked to one task |
| `POST /api/docker/tasks/:id/teardown` | Compose-down/stop the task's linked containers |

## Boundaries

The server router contains validation and error envelopes but no Docker state. The plugin's
`main/` layer owns
CLI execution, parsing, matching, streams, and the cache. Client code owns only presentation,
ephemeral detail selection, preferences, and contributed source/pane/slot/archive descriptors.
The bridge and WebSocket handlers require only Node, SQLite, the filesystem, and child processes.
Both the Electron utility-service composition root and `dev:node` install them through
`wireServerBridges`; the
plugin therefore works in either runtime when the Docker CLI and daemon are available.

Source: `apps/desktop/src/plugins/docker/{client,main,server,shared}/`.

See also: [panes.md](./panes.md) · [workspaces-and-tasks.md](./workspaces-and-tasks.md) ·
[plugins.md](./plugins.md) · [security.md](./security.md) · [api-reference.md](./api-reference.md)
