# Phase 3: choose who can reach the Node

Date: October 18, 2026. Status: done. The CLI command depends on [phase 2](./02-terminal-pairing.md).

## Completion note

Landed on October 18, 2026, on the `phase-3-reachability` branch.

What landed:

- `GET` and `PUT /v1/core/node/reach` in `packages/node-core/src/server/routes/nodeReach.ts`, with
  `NodeReach`, `coreNodeReachRoute`, and `nodeReachRequestSchema` in
  `packages/protocol/src/transport/api/nodeAdmin.ts`. The router mounts beside the stop route, so the
  `requireDevice` mount on `/v1/core/node/*` gates it. `PUT` answers only a loopback peer, refuses the
  whole list over one bad entry, writes `advertiseHost` with `recordNodeReach`, and writes a
  `node.reach.changed` audit row. It answers `409 reach_set_by_environment` while
  `ACORN_ADVERTISE_HOST` is set. `port` is the port `node.json` remembers, which the listener records
  when it binds.
- `ADVERTISED_HOSTS` on the runtime bindings. `makeRuntime` reads the hosts once, the listener binds
  with them, and the route compares `node.json` against them for `restartRequired`.
- The listener never moves a Node with hosts off its remembered port. When the port is taken, the
  boot fails with an error that names the holder, from `describePortHolder`. A private Node still moves
  to a free port.
- `acorn node reach [HOST...|--private]` and a `NodeReach` resource: schema, example, projection, and
  text output. A change restarts a Node the CLI owns with `restartNodeService`. For any other Node, the
  output says to restart it where it runs. `acorn node pair` reads its endpoints from the route. It
  falls back to the address the CLI reached the Node on when the Node has no hosts, waits on a restart,
  or predates the route. Its hint names `acorn node reach`.
- **Settings → Nodes**: `NodeReachSetting.tsx` on the local Node's row.
- The first-boot question's closing line and the standalone pairing banner name `acorn node reach`.
- Docs: the reaching section moved out of `docs/node-distribution.md`, which had 14 lines to spare, into
  [reach a Node from another machine](../../node-distribution/reaching.md). Every citation and link
  moved with it. Also [the local service](../../cli/local-service.md#choose-who-can-reach-the-node),
  [the CLI](../../cli.md#commands), [core routes](../../api-reference/core-routes.md),
  [settings groups](../../frontend/settings-groups.md#node-management), the architecture overview, and
  five site pages.
- Tests: `apps/node/test/integration/nodeReach.test.ts` covers the route's acceptance points. A
  listener test holds the remembered port and sees the boot fail with the holder named. The last test
  in `apps/cli/src/supervision/lifecycle.test.ts` runs `node reach reach.test` against a background
  Node, sees it answer that `Host` on the same port, reads the address from `node pair`, then runs
  `--private` and sees a 403. It takes about five seconds.

Decisions and deviations:

- `ACORN_ADVERTISE_HOST` under the CLI is settled: the CLI keeps removing it, and `acorn node reach` is
  how a CLI-owned Node gets hosts. One source the route can change beats a unit-file variable, which
  would make the route answer 409 and lock the desktop switch.
- The route has its own file rather than sitting in `attachment.ts`, because it mounts under
  `/v1/core/node` with the stop route.
- The Node service's size ceiling rose from 1,876,800 to 1,880,900 bytes. The base commit measured
  1,876,649 bytes and this phase 1,878,874. About 1 KB is in node-core and 0.9 KB is the protocol
  schema. Loading the route on first use saved 211 bytes and added four chunks, so it stays static.
- Plugin frames can't call the route. `packages/client-core/src/host/frames/scopes.ts` lists it with
  no scopes.
- Audit details are comma-joined strings, because an audit row's details take scalars only.
- The route doesn't lowercase hosts or drop duplicates. `restartRequired` compares the lists as text,
  so reordering the same hosts counts as a change.
- A desktop restart reloads the window, so the switch reads everything from the route after the
  reload. The reload lands on the project page, not on **Settings**. The row's **Pair another client**
  button is the existing one. Turning the switch off restarts without a confirmation, like the
  **Restart node** button in **Settings → Plugins**.
- No second machine was available. In a `dev:agent` window, the switch made the desktop's Node answer
  `reach-test.local` through this machine's network address, `192.168.1.8`, and refuse another name.
  Turning it off closed that address and kept the port. The cross-machine probe and pairing are left
  for phase 8.
- The listener test and the CLI test bind every interface. On a Mac with its firewall on, the first
  run might ask whether `node` may accept incoming connections.

For later phases:

- Phase 5: have the installer run `acorn node reach HOST` instead of setting `ACORN_ADVERTISE_HOST` in
  a unit that runs `acorn node start`. A unit that runs `dist/standalone.js` directly still honors the
  variable.
- Phase 6: the tray can read the address from `GET /v1/core/node/reach`. `reachEndpoints` in
  `apps/cli/src/projection.ts` builds `https://HOST:PORT` for the CLI, and `NodeReachSetting.tsx` does
  the same for Settings.
- Phase 8: run the cross-machine acceptance checks above, and check the Windows Defender Firewall
  prompt for `node.exe`.

## Goal

A person on the Node's machine chooses which network addresses the Node answers on, from the
terminal or from the desktop's **Settings**, and gets the address to give a client on another
machine. The Node keeps its port once it answers on the network, so remembered clients keep working.

## Starting point

- `advertisedHosts` reads `ACORN_ADVERTISE_HOST`, then `advertiseHost` in `node.json`
  (`packages/node-core/src/server/transport/advertise.ts`). When either names a host, the listener
  binds `0.0.0.0` and accepts that `Host` header as well as loopback. Every other `Host` gets a 403
  ([reaching a node from another machine](../../node-distribution.md#reaching-a-node-from-another-machine)).
- The first-boot question runs only in the standalone entry, and only with a terminal on stdin and
  stdout. `acorn node start --background` starts the Node with no terminal and removes
  `ACORN_ADVERTISE_HOST` from its environment, so it never asks and never advertises.
- The desktop has no setting for it.
- `DataRoot.recordAdvertiseHost` writes the value into `node.json`, and `recordPort` remembers the
  last port (`packages/node-core/src/server/storage/dataRoot.ts`). At boot the listener reuses the
  remembered port when it's free and picks an ephemeral one when it isn't. `ACORN_PORT` wins over
  both.
- `isLoopbackPeer` gates pairing requests to this machine (`packages/node-core/src/server/routes/pairing.ts`).
- The desktop restarts its local Node with `restartLocalNode`
  (`packages/client-core/src/infra/node/fleetActions.ts`).

## Design

### The route

Add `GET` and `PUT /v1/core/node/reach`, beside the attachment routes in
`packages/node-core/src/server/routes/attachment.ts`. Both need a device principal. `PUT` also needs a
loopback peer, because a remote client that narrows the list can lock itself out, and one that
widens it changes the machine's exposure from somewhere else.

`GET` answers with:

```json
{
  "hosts": ["192.168.1.20"],
  "source": "node.json",
  "port": 4317,
  "candidates": [{ "address": "192.168.1.20", "interface": "en0" }],
  "restartRequired": false
}
```

`source` is `environment`, `node.json`, or `none`. `candidates` lists this machine's non-internal
IPv4 addresses, as the first-boot question does. `restartRequired` is true when the recorded value
differs from what the listener bound at boot.

`PUT` takes `{ "hosts": [...] }`. An empty list keeps the Node private to this machine. The route
checks every entry and refuses the whole request on one bad entry:

- At most eight entries.
- Each is an IPv4 address or a DNS name: letters, digits, hyphens, and dots, at most 253 characters.
  No scheme, port, path, or wildcard.
- Loopback names and addresses are refused, because the Node always accepts them.

It writes the list with `recordAdvertiseHost`, joined by commas, and writes a `node.reach.changed`
audit row with the old and new lists. It answers `409 reach_set_by_environment` when
`ACORN_ADVERTISE_HOST` is set, because a write would change nothing. It doesn't restart the Node.

### Keep the port

A Node with advertised hosts keeps its remembered port. When that port is taken at boot, the Node
fails to start and names the process holding it, which the listener's port check already reports.
A moved port would break every client that remembers the address. A Node with no advertised hosts
keeps falling back to an ephemeral port. The desktop shows the failure in its recovery dialog, which
already says when the service couldn't bind a port.

### The CLI

`acorn node reach` with no arguments prints the hosts, the source, the port, and the candidates.
`acorn node reach HOST...` sets the list, and `acorn node reach --private` clears it. Both restart a
Node the CLI owns with `acorn node restart`. For any other Node, they print what to restart.

### The desktop

The local Node's row in **Settings → Nodes**
(`packages/client-core/src/features/settings/nodes/NodesSettings.tsx`) gets a **Reachable from other
machines** switch. Turning it on shows the candidates as choices, plus a field for a hostname. Saving
calls `PUT`, then `restartLocalNode`, then shows the address to give the other machine and a **Pair
another client** button. When the value comes from the environment, the row shows it and disables
the switch. Rows for remote Nodes don't show the switch, because the route refuses them.

### The first-boot question

Keep it for a Node started by hand. Its closing line names `acorn node reach` instead of editing
`node.json`.

### What the docs tell an operator

Add these to [reaching a node from another machine](../../node-distribution.md#reaching-a-node-from-another-machine):

- The operating system's firewall asks the first time the Node listens on the network. macOS asks
  about the `node` binary when its firewall is on. Windows Defender Firewall asks for `node.exe`. On
  Linux, name the `ufw` and `firewalld` commands that open the port.
- A DHCP lease can change an IPv4 address, and a client that dials the old one gets no answer.
  Prefer a name: a `.local` name, a DNS name, or a Tailscale MagicDNS name. The `Host` check compares
  the exact name, so the client must dial the name that's in the list.
- On a tailnet, advertise the machine's Tailscale address or MagicDNS name, so the Node answers only
  there.
- A Node that stays private can still be reached through an SSH tunnel with matching ports.

## Steps

1. Write the route, its schema in `packages/protocol/src/transport/api/nodeAdmin.ts`, and its tests.
   Update the route snapshot.
2. Make the listener refuse to move an advertised Node off its remembered port.
3. Add `acorn node reach` to the CLI.
4. Add the switch to the local Node's row in **Settings → Nodes**.
5. Change the first-boot question's closing line.
6. Update [Node distribution](../../node-distribution.md) and [the CLI page](../../cli.md).

## Acceptance

- Route tests cover a remote peer refused on `PUT` and allowed on `GET`, a task token refused, every
  validation rule, the environment conflict, the audit row, and `restartRequired`.
- A listener test boots a Node with advertised hosts while another process holds its remembered
  port. The boot fails and names the holder. Without advertised hosts, the same boot moves to an
  ephemeral port.
- On one machine, `acorn node reach <its address>` restarts a CLI-owned Node, and a client on a
  second machine on the same network probes `https://<address>:<port>/v1/node`.
- In the desktop, the switch makes the local Node reachable, and a client on a second machine pairs
  with it.

## Risks

- Advertising puts a service that runs terminals and agents on a network, behind device tokens and
  rate-limited pairing codes. The switch's help text says to use it only on a network you trust.
- A strict port can stop a desktop's Node from starting after another program takes its port. The
  recovery dialog names the holder, and turning the switch off restores the fallback.

## Verify before building

- Read how the listener picks a port in `packages/node-core/src/server/transport/listenerConfig.ts`,
  and how the desktop's recovery dialog shows a bind failure, before you change the fallback.
- Check whether the terminal client's settings draw `NodesSettings.tsx`. If they don't, the CLI
  command is the terminal's way in.
- Confirm that `GET /v1/node` doesn't already report the advertised hosts to an authenticated caller.
