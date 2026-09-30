# Docker

The Docker plugin exposes Node-local Docker state through a bounded CLI adapter using the shared
broker's environment filter. Docker itself is
authoritative; acorn caches short-lived projections and never stores the full inventory as application
data.

## Surfaces

- Docker Source: Compose projects, containers, images, volumes, and networks.
- Task pane: containers associated with the host-stored task worktree by daemon metadata.
- Logs, stats, inspect, and exec.
- Start/stop/restart/pause/unpause/remove, Compose lifecycle, and prune.
- Task badges, summaries, and archive-time teardown prompts.

## Client

Both surfaces are host layouts filled with kit nodes, and the plugin ships no stylesheet. For more
information, see the layout model in [the panes doc](./panes.md).

The task pane is `header-body-footer` with no footer. The header is a `ChipRow`, one chip per linked
container, and the body is the shared container detail. The Docker Source is a `list-detail`: a tab
strip over containers, images, volumes, and networks in the list column, and the same container detail
in the other.

The container detail is a `Tabs` node. Info is a `Facts` list, Logs is a `Log` with a `FindBar`, Stats
is a run of `Meter`s, and Terminal is a `Rectangle kind="pty"` wrapping the exec surface. A rectangle
is the kit's admission that a PTY owns its own pixels: the node owns the box and the way in and out of
it with the keyboard, and xterm owns everything inside.

Two extension points sit on these surfaces. `docker:stats-beside` is a `remote` slot on the Stats tab,
for a plugin with a graph or a cost estimate to put beside the numbers. `docker:container` is an
`annotation` point keyed by container id, drawn under the rows of the Source list. For more
information, see the cooperative extension points in [the plugins doc](./plugins.md).

## From the command palette

Two rows, registered by the plugin in `plugins/docker/src/client/commands.ts`.
[command-palette-and-shortcuts.md](./command-palette-and-shortcuts.md) covers how the palette runs a
search, and [plugins.md](./plugins.md) § Command kinds holds the vocabulary.

**Open Docker** selects the rail source. **Find a Docker resource** is one search over all four
lists — containers, images, volumes, and networks — with a badge on each row saying which list it came
from, because a reader looking for `postgres` does not know whether they are about to find a container
or an image. The containers come from the store this plugin already keeps in step with the daemon; the
other three are read when the frame opens, and the filtering after that is local
(`packages/client-core/src/host/registries/commands/localSearch.ts`), so nothing is debounced and an
empty query is the whole list. A row id is `<scope>:<id>`, because a volume is keyed by its name and
everything else by an id, and a bare id could collide across the four namespaces.

A pick names the rail source, never the task pane, and that is the correction the design took during
implementation rather than the shape it started in. The pane draws one task's containers and appears
only on a task that has some (`plugins/docker/src/client/paneContribution.ts`), so an image, a volume,
and a network have nowhere in it to be revealed, and a container has no pane either on a task the
matcher linked nothing to. Selection therefore sets the source and leaves the browse surface a reveal
to land on (`plugins/docker/src/client/dockerViewStore.ts`). The surface consumes it whether it was already
mounted or opens because of the pick, and taking it clears it, so a later remount does not jump
somewhere the reader has since navigated away from.

Lifecycle actions are not attached to results. Start, stop, and restart wait for result actions to be
designed. Remove, prune, and Compose down stay pane operations behind their confirmation, where what
is about to be destroyed is on screen.

## Matching

Task listings and cleanup require the daemon's `com.docker.compose.project.working_dir` metadata to
equal or sit beneath the host-stored task worktree path. Matching uses normalized absolute path
components, with POSIX, Windows drive and UNC forms supported. Relative paths, traversal, invalid
paths, sibling prefixes, missing roots and missing working-directory metadata confer no association.
Daemon path strings are compared directly; they are not resolved against this Node's filesystem.

The device-only task summary can additionally suggest containers using declarative project, label and
branch-name hints from the layered home/repository configuration. Explicit foreign or invalid
working-directory metadata always defeats those hints. Suggested containers do not gain access
through task-addressed listing or cleanup. Repository configuration reads require a regular file
canonically within the checkout, accept internal aliases, and cap input at 1 MiB. Unsafe, oversized or
malformed files contribute no hints. No second container inventory is persisted.

## Execution

All Docker commands use fixed argument arrays and the shared broker's environment filter. The Node caps
output and operation time, propagates teardown failures, and does not claim a multi-resource action
succeeded when one part failed. Events and log/stat streams use `/v1/events` with reconnect/refetch
behavior.

Global HTTP lifecycle and Compose actions require owner device authority. Docker WebSocket streams
and exec permit device and service principals; task-confined sockets cannot open Docker channels.
Explicit global actions can manage resources outside any task. Task credentials can list and tear down only their
own task through the host task-scope gate. Declarative hints do not authorize these actions. Run
targets that execute repository commands use the separate repository configuration trust gate.

Every exec frame validates its payload before native PTY calls. Exec IDs contain one to 128 string
characters, input is a UTF-8 string of at most 64 KiB, and dimensions must be finite integers when
present. Missing or zero dimensions default to 80 columns and 24 rows. Integer dimensions clamp to
2–500 columns and 2–300 rows. Docker refs retain their 256-character argument-safe grammar.
Malformed frames are ignored. Native write, resize, kill, and cleanup failures stay within the
connection, and disconnect attempts every stream and exec teardown independently.

Manual task teardown and archive cleanup refresh daemon metadata and target full immutable container
IDs associated with that task root. Active containers are stopped (paused containers are first
unpaused), and associated Compose containers are then removed without force or volume deletion.
Loose associated containers are only stopped. Cleanup never runs project-wide `compose down` and
leaves networks and volumes for explicit owner management, so a shared project name cannot widen the
operation. The archive checkbox counts only associated active containers. Partial failures invalidate
the inventory cache and propagate to the caller without reporting success.

Working-directory labels are daemon metadata, not cryptographic ownership or isolation from a caller
who already controls Docker. Static path validation also does not eliminate concurrent filesystem
replacement during repository configuration reads.

## Availability

If Docker is unavailable, the source reports daemon/version health and the task pane shows an explicit
unavailable state. Node-local Docker state does not aggregate across Nodes except through the normal
fleet partial-result behavior.
