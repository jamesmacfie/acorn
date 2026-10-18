# Phase 2: run and pair a Node from the terminal

Date: October 18, 2026. Status: proposed. Depends on [phase 1](./01-token-out-of-logs.md).

## Goal

On macOS, Linux, and Windows, a person at the Node's machine can do everything a headless Node needs
with `acorn` alone: run it under a service manager, open and close a pairing code, list paired
devices, revoke one, and stop or restart the Node with a full drain.

## Starting point

- `acorn node start` refuses to run without `--background` (`apps/cli/src/commands.ts`). The
  background start keeps a service record and a rotating log in the CLI's custody folder, and stores
  the launcher token under `LOCAL_TOKEN_SCOPE` (`apps/cli/src/supervision/lifecycle.ts`).
- `acorn node status` reports `running-unowned` for a Node the CLI didn't start, and `stop` refuses
  it.
- `acorn node stop` sends `SIGTERM` and waits up to 40 seconds. On Windows, Node.js ends a process at
  once for `SIGTERM`, so the Node's drain never runs. The terminal client stops its own Node the same
  way (`apps/tui/src/node/supervise.ts`).
- The pairing and device routes exist and are device-only: `POST /v1/core/pair/start`,
  `DELETE /v1/core/pair`, `GET /v1/core/devices`, and `DELETE /v1/core/devices/:id`
  (`packages/node-core/src/server/routes/pairing.ts`). The desktop calls them through
  `packages/client-core/src/infra/node/fleetActions.ts`.
- `fingerprintPhrase` turns a certificate fingerprint into the six identity words
  (`packages/protocol/src/device/fingerprintWords.ts`).
- When the CLI holds no token for the local Node, every command pairs it first: by approval when the
  desktop is watching, or with a typed code (`apps/cli/src/node.ts`).
- A hand-started standalone Node opens a code on `SIGUSR1`. A background Node ignores the signal.

## Design

### Run under a service manager

`acorn node start --foreground` does what `--background` does, except that it stays attached. It
uses the same launcher pipes, service record, and token custody, so the CLI holds the Node's token
afterward. It doesn't detach. It forwards `SIGTERM` and `SIGINT` to the Node, and exits with the
Node's exit code.

Logs go to stdout and stderr, which a service manager captures. `--log FILE` writes them to the
same rotating log that background mode uses instead, for launchd and Windows, which don't rotate.
Phase 1 keeps credentials out of both.

`start` takes exactly one of `--background` and `--foreground`. A second `start` while one runs
answers `running`, as it does for background mode.

### Stop with a drain on every platform

Add `POST /v1/core/node/stop` with an optional body `{ "restart": true }`. It answers `202`, then runs
the same bounded drain as `SIGTERM`. A device principal is required, and the socket's peer must be
loopback, as for pairing requests. A remote client can't stop a Node. The route writes a
`node.stop.requested` audit row.

`acorn node stop` calls the route first and waits for the lock to release. It falls back to `SIGTERM`
on macOS and Linux when the route doesn't answer. `--force` keeps its ownership proof and its kill.
The terminal client uses the route for the Node it owns too.

With `restart`, the Node exits with code 75. A foreground launcher that sees 75 starts the Node
again in the same process, so a service manager sees no exit. `acorn node restart` sends it. For a
background Node, `restart` is `stop` and then `start --background`.

### Pair from the terminal

`acorn node pair` opens a pairing window on the local Node and prints what a person on the other
machine needs:

```text
Connect to    https://192.168.1.20:4317
Identity      maple orbit velvet canyon ember lantern
Pairing code  Rk3vQ9mZt2LxWp8sYc4HbA   (valid 10 minutes)

On the other machine, open Settings → Nodes, add a node, and check that the identity words match.
```

- It uses the CLI's device token for the Node. With no token, it pairs the CLI first, the way every
  command does.
- It reads the addresses from [phase 3](./03-reachability.md)'s route when that exists. Without
  one, or with no address set, it prints the loopback endpoint and says that `acorn node reach`
  makes the Node reachable.
- `--close` calls `DELETE /v1/core/pair`.
- `--output json` writes one `PairingWindow` resource: `nodeId`, `endpoints`, `identity`, `code`,
  and `expiresAt`. The code is meant for a person, so it's printed. No device token is.
- `--node NODE` works too, because opening a code needs no authority a paired device lacks. The
  desktop does the same for any Node in **Settings → Nodes**.

A Node running as another operating system user is paired by that user, such as
`sudo -u acorn acorn node pair`. That's the same proof `SIGUSR1` asks for.

### List and revoke devices

`acorn node devices` lists each paired device: ID, name, when it paired, when it was last seen, and
whether it's revoked. It marks the CLI's own row as **this terminal**. `--output json` writes a list
of `Device` resources without token material.

`acorn node revoke ID` revokes a device. Revoking the CLI's own device needs `--force`, because the
CLI must pair again afterward.

### Keep `SIGUSR1`

A Node started by hand on macOS or Linux still opens a code on `SIGUSR1`. Its banner suggests
`acorn node pair` first.

### Optional: allow a request in the terminal client

The terminal client can ask to pair but can't allow a request
([pairing by approval](../../api-reference/transport.md#pairing-by-approval)). Draw the request's
device name and phrase in the terminal client's confirmation overlay, with **Allow** and **Deny**,
for a `pairing:requested` frame. This lets a person in `acorn` approve another local client, such as
the browser extension's native host. Ship it after the commands, because the commands cover the
headless case on their own.

## Steps

1. Add `--foreground` and `--log` to `node start`, sharing the launch code from phase 1.
2. Add the stop route beside the pairing routes, then `acorn node stop` through it and
   `acorn node restart`. Teach the foreground launcher to restart on exit code 75.
3. Add `node pair`, `node devices`, and `node revoke` beside the other node commands in
   `apps/cli/src/commands.ts`, with their resources in `apps/cli/src/output.ts`.
4. Update the help text in `apps/cli/src/args.ts` and the command list in [the CLI page](../../cli.md#commands).
5. Update the route snapshot in `apps/node/test/integration/routeRegistry.snapshot.json`. It lists a
   route once for each Hono handler, so a route with two handlers appears twice.
6. Change the banner text in `apps/node/src/entries/standalone.ts`.
7. Optional: the terminal client's allow prompt.
8. Document the commands in [the local service](../../cli/local-service.md), and replace the
   `SIGUSR1` instructions in [Node distribution](../../node-distribution.md) and
   [authentication](../../authentication.md#pairing).

## Acceptance

- Unit tests cover argument parsing, the `PairingWindow` and `Device` resources, the refusal to revoke
  the CLI's own device without `--force`, and exit code 75 in the foreground launcher.
- Route tests: the stop route refuses a non-loopback peer, a task token, and a service token. It
  accepts a device on loopback, drains, and writes its audit row.
- An integration test starts `acorn node start --foreground`, runs `acorn node pair --output json`,
  pairs a second client with the code, lists both devices, revokes the second, and stops the Node
  with `acorn node stop`. The second client's socket closes on revoke.
- On a Windows runner, `acorn node stop` drains: the Node's log shows the drain lines, the lock
  releases, and a task script that was waiting is recorded as interrupted by `shutdown`.

## Risks

- The stop route gives any local process holding a device token a way to stop the Node. Any such
  process can already revoke devices and run commands, so this adds no authority.
- Restart by exit code puts a small supervisor in the CLI. Keep it to restart-on-75, with no backoff
  or crash budget. Crash restarts belong to the service manager.

## Verify before building

- Read how `standaloneEntry` in `apps/cli/src/supervision/entry.ts` picks the runtime, so a
  foreground Node runs under the same Node.js binary as the CLI.
- Check whether the CLI's service record assumes a detached child, such as in its PID checks.
- Check the terminal client's confirmation overlay in `apps/tui/src/chrome` for modal focus rules
  before you add the optional prompt.
