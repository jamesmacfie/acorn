# Docker panel in the browser extension

This page is a plan for a Docker panel in the browser extension's sidebar. The panel shows the task's
containers, their published ports, and recent logs. Read it before you build the panel.

Proposed October 16, 2026, against `afb826ee3`. Implemented October 16, 2026, with part 1 of the pull
request panel plan. The check in a real browser against a Compose project is still open. The
reference is [Browser panel](../docker.md#browser-panel).

## Why

Runn's panel shows a Runn stack's services and logs beside the app you're testing. Every other
project that runs its services in Docker Compose gets nothing in the sidebar. When the page breaks,
you have to switch to the desktop app to see whether a container died and what it logged.

The Docker plugin already matches containers to tasks. A container belongs to a task when its
`com.docker.compose.project.working_dir` label is the task's worktree or a folder inside it
([matching](../docker.md#matching)). The plugin can already list a task's containers, and Runn's panel
shows how to read a log tail. This panel puts the two together with the blocks the extension already
has. The extension needs no changes.

## Before you start

Docker is a built-in plugin, and only a loaded plugin can declare a panel today. Do
[part 1 of the pull request panel plan](./extension-github-panel.md#part-1-let-a-built-in-plugin-declare-a-panel)
first, unless it has already shipped.

## Declare it

In `plugins/docker/src/node/index.ts`:

```ts
browserPanel: { label: 'Docker', glyph: 'container', pane: 'docker', route: '/v1/p/docker/browser-panel' },
```

The plugin's router mounts at `/v1/p/docker`. Add the route in `plugins/docker/src/server/routes/docker.ts`,
behind `requireDevice` like every route there except the task routes. Container logs can hold
credentials, and the extension's bridge holds a device credential, so no task-scoped caller needs it.
The route test that walks Hono's route table catches a missing gate.

Add a `browserPanel(taskId, source)` method to the bridge in `plugins/docker/src/server/dockerBridge.ts`,
and keep the code that builds the view in a new pure module, `browserPanel.ts`, in `plugins/docker/src/server/`.
It takes the containers and the log lines and returns a `BrowserPanelView`, so tests need no daemon.

## What the route answers

`GET /v1/p/docker/browser-panel?taskId=<id>[&source=<id>]`.

1. List the task's containers with `taskContainers`, the same list the task pane uses. Suggestions
   from project, label, and branch hints don't count, as they don't for any task-addressed read.
2. Answer 404 when the task has no containers. The desktop's Docker pane appears only on such a task
   too, so the nav item and the pane appear together.
3. Read the chosen container's last 200 log lines (see [the logs block](#the-logs-block)).
4. If the daemon can't be reached, answer the error, not a view. The sidebar then keeps its last view
   and shows why above it.

## The blocks

The view has up to four blocks, in this order. Leave out a block that would be empty.

Each container gets one severity, which the status block and the container rows share:

- `danger` for a dead container, one that exited with a non-zero code, or one marked "(unhealthy)".
- `pending` for a created or restarting container, or one with "(health: starting)".
- `warn` for a paused container.
- `info` for everything else, including one that exited with code 0.

The status text in `DockerContainerSummary.status`, such as "Up 3 hours (healthy)" or
"Exited (1) 2 minutes ago", carries the health and the exit code. The daemon's events watcher drops
health events as noise, so this text is the only place to read health.

### The status block

- The label is "Containers".
- The state counts what runs, such as "3 of 4 running".
- The severity is the worst of the containers' severities.
- The detail names each container that isn't `info`, one per line, such as "api: Exited (1) 2 minutes
  ago". When `workingDirMissing` is set, add a line saying the worktree behind the stack is gone.

### The containers block

A `rows` block with one row per container, ordered by Compose project and then service name:

- The label is the Compose service name, or the container name without one, cut to 80 characters.
- The state is the status text, cut to 40 characters.
- The severity is the container's.

### The ports block

A `links` block, titled "Ports", with one link per published TCP port, at most 16:

- The address is `http://localhost:<hostPort>`.
- The label is the service name and the container port, such as "web 3000".
- `ready` is false when the container isn't running.

Every port gets an `http` address, including a database's. The extension offers every link to copy,
and opening one that isn't a web server does no harm.

### The logs block

A `logs` block, titled "Logs", with one source per container:

- The source ID is the container name in lowercase, with any character outside `a-z`, `0-9`, `.`,
  `_`, and `-` changed to `-`, cut to 64 characters. Compose names containers
  `<project>-<service>-<n>`, so the ID survives a container being recreated, and the sidebar's
  remembered choice keeps working.
- The label is the service name, or the container name.
- With no `source`, or one that names no container, pick the first `danger` container. If none,
  pick the first running one. If none is running, pick the first container.
- Read the lines with `docker logs --tail 200 <id>` through the process broker, with fixed arguments
  and a deadline, like every other Docker command. Add the read to `dockerService.ts`. Don't reuse the
  log stream, which keeps a child running for its viewers.
- Cut each line to 1,000 characters. The host refuses an answer over 512 KiB, so if the view's JSON
  is over 480 KiB, drop the oldest lines until it fits.
- If the log read fails, show the error as the only line and keep the rest of the view. Runn's panel
  does the same.

## Keep an open panel current

The extension never polls. It reads an open panel again when the Node's tasks change, or when a
plugin that declares a panel sends `term:status` (`apps/cli/src/browser/bridge.ts`).

The Docker service already watches daemon events. It collects them for `BROADCAST_DEBOUNCE_MS` and
then broadcasts `docker:changed` (`markDirty` in `plugins/docker/src/server/dockerService.ts`). When
that broadcast includes the `containers` scope, also call `ctx.events.status()`. Pass it from the
plugin's `init` into `dockerBridge` beside `ctx.events.send`. The debounce already limits how often
it fires.

A container that starts, stops, or dies then updates an open panel. New log lines don't. Those show
on **Refresh** or when you pick the source again.

## Out of scope

- Any action, such as start, stop, restart, remove, or Compose up and down. The panel is read-only by
  contract. **Open in Acorn** goes to the Docker pane for these.
- Stats, inspect, and exec.
- Containers that only the project, label, or branch hints suggest.
- Images, volumes, and networks.

## Acceptance

- A task with matched containers shows a **Docker** nav item. A task without them shows none.
- The panel shows the status, containers, ports, and logs above. A test feeds container fixtures for
  a healthy stack, a stack with an exited container, an unhealthy container, a starting one, and a
  missing worktree, and checks each view against `browserPanelView`.
- Picking a log source shows that container's lines. The choice survives the container being recreated.
- 200 log lines of 1,000 multi-byte characters each still produce a view under the host's limit.
- Stopping a container from the desktop updates an open panel without **Refresh**.
- **Open in Acorn** opens the task on the `docker` pane.
- A test checks that `pane: 'docker'` matches the ID in `plugins/docker/src/client/paneContribution.ts`.
- The route test that walks Hono's route table still passes with the new route.
- `docs/docker.md` lists the panel under its surfaces.
- Check it once in a real browser against a dev Node running a Compose project.

## Limits

- The port addresses use `localhost`. They're right only when the Node runs on the same computer as
  the browser. The desktop's Docker pane rewrites them for a remote Node
  (`plugins/docker/src/client/nodeAddress.ts`), but the Node can't tell which address the browser
  reaches it on. A remote Node's ports still show and copy, but open the wrong machine.
- `docker logs` writes a container's standard output and standard error separately. Read through the
  broker, the two can come back out of order relative to each other.
- A Runn task matches the same containers, so it shows both a **Runn** and a **Docker** nav item. The
  desktop shows both panes for such a task too. If that reads as noise, have the Docker panel answer
  404 for a task that Runn's panel covers. That needs a way for one plugin to ask another, so it's left
  out of this plan.
