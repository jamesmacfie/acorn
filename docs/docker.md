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
