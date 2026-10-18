# Phase 3: choose who can reach the Node

Date: October 18, 2026. Status: proposed. The CLI command depends on [phase 2](./02-terminal-pairing.md).

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
