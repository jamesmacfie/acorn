# Docker plugin migration

Status: **Normative**<br>
Coordinate: `acorn/docker`<br>
Requirement prefix: `CUR-DOCKER`

## 1. Current behavior and authoritative state

V1 browses and controls the local Docker daemon through the Docker CLI. It exposes an always-visible
Source, conditional Task pane, task-rail/footer badges, logs/stats, exec terminal, resource actions,
Compose lifecycle, pruning and archive-time teardown. Docker is authoritative; V1 persists no
daemon state. Task matching derives from Compose working-directory/project labels, configured label
keys and sufficiently long branch-name slugs.

- **CUR-DOCKER-001:** V2 MUST keep Docker resources as live external resources. Plugin SQLite stores
  configuration/lifecycle metadata only, never a competing inventory.
- **CUR-DOCKER-002:** Docker execution occurs on the Task's owning Node. A remote Electron controls
  that Node's daemon, not the client's local daemon.

## 2. Current UI, routes, events, contributions and dependencies

V1 contributes Source `docker`, pane `docker` order 75, task footer/rail slots, 15-second summary
poller plus `docker:changed` subscription, agent context, settings and `task:archive` concern.
Internal routes provide info, inventories, inspect, container actions/removal, image/volume/network
removal, prune, Compose action, task summaries/containers/teardown. Shared WebSocket carries
debounced changed scopes and log/stats/exec channels.

The service caches info 10 seconds/lists 5 seconds, supervises `docker events` with 1–60 second
backoff, caps stream children at 32 and validates refs against a leading-dash-safe grammar. Exec and
all streams are ephemeral. There is no V1 public `/api/v1` Docker contribution.

## 3. Target classification

- **CUR-DOCKER-003:** Docker is bundled **Acorn Verified**, with a WASI policy/parser/matcher
  component, declarative UI, and Node core process/stream capabilities.
- **CUR-DOCKER-004:** The plugin MUST NOT receive ambient shell or Docker socket access. It invokes
  the configured Docker executable through a grant constrained to the declared argv grammar.
- **CUR-DOCKER-004A:** Every V2 Node platform uses the same WASI component.
  Docker CLI children, `docker events`, logs, stats and exec are core-owned
  fixed-tool/stream operations, not a plugin native artifact. If core cannot
  enforce executable identity, argv grammar and process-tree policy, Docker is
  unavailable; it never falls back to a native plugin or socket access.

## 4. Node, Electron, native-host and renderer split

Node core resolves Task/worktree, launches/supervises Docker processes and PTY streams, enforces
limits and sends product/stream frames. Docker component builds allowed argv, parses output, caches
projections, matches Tasks and coordinates teardown. Electron renders Source/pane/badges/settings
using standard tree/detail/table/log/terminal renderers. It has no native Docker access.

- **CUR-DOCKER-005:** Interactive exec uses the standard `acorn.terminal/2` renderer and Node stream
  protocol; Docker MUST NOT embed xterm or invent a parallel socket.
- **CUR-DOCKER-006:** Logs/stats and exec carry opaque Stream URIs with credit/backpressure. Closing
  a view detaches/stops the stream child according to its descriptor; it never persists output.

## 5. Manifest, capabilities, permissions and dependencies

Required: `acorn.task.read/1`, `acorn.worktree.path.use/1`,
`acorn.process.spawn-constrained/1` for Docker, `acorn.stream.create/1`, and renderer capabilities.
Interactive exec additionally requests `acorn.terminal.create/1` scoped to a selected container.
Destructive grants distinguish resource action, remove, prune, Compose down and task teardown.
Optional dependency on `acorn/terminal >=2 <3` provides terminal UI; browsing works without it.

Manifest contributes fleet Source, conditional task pane, footer/rail badges, settings, event
subscription, background Docker-events worker, archive concern and agent context source.

## 6. Queries, commands, capabilities, events and streams

Queries under `dev.acorn.docker.*.v1`: `info`, `containers.list`, `container.inspect`,
`images.list`, `volumes.list`, `networks.list`, `tasks.summary`, `task.containers`.
Commands: `container.action`, `container.remove`, `image.remove`, `volume.remove`,
`network.remove`, `prune`, `compose.action`, `task.teardown`, `logs.open`, `stats.open`, `exec.open`.

Container action enum is start/stop/restart/kill/pause/unpause; Compose is
start/stop/restart/down; prune is containers/images/volumes/networks/builder. Refs are at most 256
safe characters and cannot begin with `-`.

Events:

- `dev.acorn.docker.inventory.changed.v1` with scopes;
- `daemon.available|unavailable.v1`;
- `task.match.changed.v1` with counts/projects;
- command-specific completed/failed facts; and
- stream lifecycle events without log/exec content.

- **CUR-DOCKER-007:** Docker events are coalesced for 300 ms and invalidate affected cached scopes.
  Durable event payloads contain IDs/scopes/counts only.
- **CUR-DOCKER-008:** Info/list cache is a disposable projection; query response reports observed
  time and live/stale/unavailable status.
- **CUR-DOCKER-009:** Logs start with at most 300 historical lines; stats is line-normalized; each
  decoded frame ≤64 KiB. Maximum 32 Docker stream processes per Node plus core/device limits.
- **CUR-DOCKER-010:** Task teardown is a saga: Compose projects `down`, loose running containers
  stop, volumes remain. Partial failures are itemized and require owner recovery; Task archive does
  not falsely report container cleanup.
- **CUR-DOCKER-010A:** `compose.action` and any Task teardown that invokes
  Compose require `composeSnapshotDigest` from the current materialized plan;
  changed input returns `needs-trust` before Docker invocation. Build, up,
  start, restart, exec, stop and down are covered; a previous query/list or
  non-executable Docker matching decision is not approval.

## 7. UI contributions and renderer requirements

Preserve grouped master/detail Source for containers/images/volumes/networks; stopped filter;
inspect state, ports, command, health, environment, mounts and networks; actions and confirmations;
logs/stats; exec terminal; prune and Compose operations. Task pane filters matched containers and is
hidden when total zero. Rail/footer show running/total counts. Archive workflow shows “also stop”
only when running matches exist.

Environment values are sensitive and hidden by default with explicit reveal; agent context includes
only name/image/state/status/ports. Mobile fallback supports inventory/detail/actions/logs; exec is
unsupported without terminal renderer.

## 8. Storage, migration, backup, uninstall and reinstall

Plugin DB owns Docker matching/settings by repository or workspace, accepted daemon endpoint/context
metadata and lifecycle health. Live inventory, caches, event cursor, streams and exec state are
ephemeral/excluded from backup. Default matching is working directory, exact configured Compose
project, configured label equals branch slug, then name match; slugs shorter than six are rejected.

- **CUR-DOCKER-011:** Clean V2 may read validated declarative `[docker]` repo configuration but
  imports no V1 client preferences or daemon state. Names/labels used only to
  associate already-running resources are non-executable matching metadata.
- **CUR-DOCKER-011A:** The executable Compose graph is separate. Core resolves
  descriptor-relative every `-f` file, recursive `include` (maximum 16 files/
  depth 8), project `.env`, referenced `env_file`, Dockerfile, override and
  build context. The context is a sorted Merkle manifest of files selected by
  `.dockerignore`; absolute paths, traversal and symlinks escaping the
  repository descriptor are rejected. YAML custom tags and duplicate keys are
  rejected.
- **CUR-DOCKER-011B:** A no-daemon constrained parser produces canonical JSON
  of services, images/builds, commands, environment names, networks, ports,
  secrets/configs, devices, capabilities, security options, namespaces and
  resolved mounts. The trust snapshot hashes every input byte, relative path,
  normalized plan, parser/Docker version and repository identity. Trusted
  Acorn UI shows the materialized plan and diff; any graph byte, environment
  substitution, symlink target, parser version or build-context change
  invalidates trust.
- **CUR-DOCKER-012:** Disable/uninstall kills watchers/streams, revokes executable grant and leaves
  Docker resources running. Data retention is 30 days.

## 9. Setup, settings, health, update and failure

Setup detects the Node-side Docker CLI/daemon/context, explains execution authority and lets the
owner test it. It never downloads/installs Docker. Settings cover stopped visibility, destructive
confirmations and declarative task matching. Repo Docker matching contains names/labels only and
does not need executable-config trust.

Health distinguishes not installed, daemon down, permission denied, incompatible CLI, events-worker
degraded and healthy. Worker restart is bounded; daemon outage keeps navigation visible with
recovery help. Updates drain streams and resume inventory after activation.

## 10. Security and credential treatment

- **CUR-DOCKER-013:** Docker control is effectively host-code authority. Install and setup MUST
  disclose this; capability grant is Node-scoped and owner-approved.
- **CUR-DOCKER-014:** Process broker uses an exact executable identity, argv arrays, safe refs,
  bounded environment/output/deadlines and no shell. User-controlled strings cannot become flags.
- **CUR-DOCKER-015:** Remote Docker endpoints, arbitrary `DOCKER_HOST`, registry login and socket
  mounting are unsupported unless a future separately permissioned contract defines them.
- **CUR-DOCKER-016:** Logs, exec, environment and mount paths are sensitive; they are not durable
  events/logs/backups/agent context. Copy/reveal is explicit.
- **CUR-DOCKER-017:** Built-in networks and in-use resources honor Docker safety errors; force and
  prune/down require host destructive confirmation.
- **CUR-DOCKER-017A:** Privileged mode, host/absolute bind paths, Docker socket,
  device mounts, host network/PID/IPC, added capabilities, security-opt,
  secrets/config sources outside the repository and writable root mounts each
  require a separate closed `docker` family high-risk effect in the persisted
  grant. Policy may prohibit an effect. Approval of one digest/effect does not
  carry to another repository, plan or installation generation.

## 11. Coupling that must be removed

Remove direct `wsBroadcast`, custom WebSocket channel, client singleton signal/poller wiring,
Docker-specific archive registration, embedded terminal, direct Task/repo config reads and
composition-root bridge. Replace with durable plugin events, core streams/terminal renderer,
declared worker/source/slots/concern, Task/config capabilities and plugin-owned preferences.

## 12. Fresh-install parity scenarios

- **CUR-DOCKER-018:** Source shows equivalent grouped inventory/detail/actions and reacts to daemon
  events without continuous client polling.
- **CUR-DOCKER-019:** Task matching, conditional pane, rail/footer counts and archive cleanup prompt
  match V1 for the same labels/config/worktree.
- **CUR-DOCKER-020:** Logs/stats/exec work against the remote Node daemon with bounded reconnect and
  no output persistence.
- **CUR-DOCKER-021:** Missing CLI/daemon produces the same actionable states; destructive actions,
  Compose and prune are at least as strongly confirmed.
- **CUR-DOCKER-022:** Repository-adversary parity changes includes, `.env`,
  override, symlink, relative/absolute bind, Docker socket, privileged/device/
  host-network setting, Dockerfile and build-context after plan preview. Every
  change blocks execution until the new materialized plan and high-risk effects
  are reviewed.
