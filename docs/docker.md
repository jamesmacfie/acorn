# Docker

The Docker plugin exposes Node-local Docker state through the shared process broker. Docker itself is
authoritative; acorn caches short-lived projections and never stores the full inventory as application
data.

## Surfaces

- Docker Source: Compose projects, containers, images, volumes, and networks.
- Task pane: containers matched by Compose project, worktree, labels, or branch slug.
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

Matching configuration is declarative: project names, labels, and name patterns are stored in the
Node configuration. The matcher derives task association from the repo/worktree and Compose metadata.
It does not persist a second container inventory.

## Execution

All Docker commands use fixed argument arrays through CoreServices' process broker. The Node caps
output and operation time, reports each teardown failure, and does not claim a multi-resource action
succeeded when one part failed. Events and log/stat streams use `/v2/events` with reconnect/refetch
behavior.

Compose files and commands that execute developer code pass the repository configuration trust gate.
The declarative matcher does not, by itself, execute anything.

## Availability

If Docker is unavailable, the source reports daemon/version health and the task pane shows an explicit
unavailable state. Node-local Docker state does not aggregate across Nodes except through the normal
fleet partial-result behavior.
