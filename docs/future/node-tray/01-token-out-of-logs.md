# Phase 1: keep the device token out of logs

Date: October 18, 2026. Status: done.

## Completion note

Landed on October 18, 2026, on the `phase-1-token-out-of-logs` branch.

What landed:

- `apps/node/src/entries/standalone.ts` runs the file descriptor exchange only when
  `ACORN_LAUNCHER_PIPES=1`. `ACORN_CLI_BACKGROUND` keeps the log file and the service ID. Without
  pipes, the Node prints the handshake with no `deviceToken`, skips `resolveDeviceToken`, and issues no
  launcher device. The Node deletes `ACORN_LAUNCHER_PIPES` from its own environment, so a Node started
  from one of its terminals doesn't try to read pipes it doesn't have.
- `launchNode` in `packages/custody/src/local/launch.ts` owns the spawn, the token write on fd 4, the
  handshake parse on fd 3, and the 120-second deadline. The CLI and the terminal client both call it.
  `ACORN_DEVICE_TOKEN` is gone from the code and from the site's environment variable page.
- The terminal client drops the Node's stdout instead of reading and draining it.
- `scripts/remote-node.mjs` pairs as `remote rig` with the banner's code, seeds the project with that
  token, and opens a fresh code for the development window once the window is up.
- The tarball README drops the `openssl` line, names `ACORN_DATA_DIR`, and points at
  `docs/node-distribution.md`.
- Tests: `apps/node/test/integration/lifecycle/standaloneHandshake.test.ts` covers the first two
  acceptance points. It fails against the old entry. The terminal client's boot test asserts that a
  restart reuses its token.

Decisions and deviations:

- The integration tests had no shared spawn helper, so this phase adds
  `apps/node/test/helpers/standalone.ts`. It writes its own side of the pipe exchange instead of
  importing `launchNode`, because `@acorn/node` doesn't depend on custody, and an independent copy
  checks the Node's half of the contract. Only `standaloneShutdown.test.ts` and `enrollment.test.ts`
  spawn the standalone entry. `serviceSpawn`, `audit`, `pairing`, and `nodeProviders` don't, so they
  needed no change.
- The CLI turns `NodeStartTimeout` into its `node_start_timeout` error with exit code 5, and adds its
  log path to every other start failure. `launchNode` stops a child whose handshake it can't use,
  because that child still holds the data root's lock.
- The pairing banner and the `SIGUSR1` handler stay gated on `ACORN_CLI_BACKGROUND`. A Node the
  terminal client starts still prints its banner into stdout the client drops.
- `docs/node-distribution.md` was at the 200-line limit, so its dependency security section moved to
  `docs/node-distribution/dependency-security.md`.
- `pnpm dev:remote` wasn't run end to end. It needs Docker and a `dev:agent` window. Every route it
  calls is covered by an integration test.

For later phases:

- The stdout handshake has no token. A smoke test or an installer that needs one either starts the
  Node through `launchNode` or pairs with the banner's code.
- `launchNode` takes `stdout` and `stderr` as `'ignore'`, `'pipe'`, or a file descriptor. Phase 2's
  `acorn node start --foreground` can pass `1` and `2` to keep the Node's output in the terminal.
- Phase 2 should add `acorn node start --foreground` to the tarball README in `scripts/pack-node.mjs`.
- `ACORN_CLI_BACKGROUND`, `ACORN_CLI_SERVICE_ID`, and `ACORN_CLI_LOG_PATH` still reach the Node's own
  children. This phase didn't change that.

## Goal

A standalone Node started by hand or by a service manager writes no credential to its output. A
launcher that needs the Node's device token gets it over a private pipe, the way
`acorn node start --background` does. A Node that nobody launched with a pipe mints no launcher
device at all.

## Starting point

- `apps/node/src/entries/standalone.ts` builds the handshake with a `deviceToken` from
  `resolveDeviceToken`. In background mode it writes the handshake to file descriptor 3 and reads the
  previous token from file descriptor 4. Otherwise it calls `console.log`.
- A service manager keeps that stdout: systemd in the journal, launchd in the plist's log file, and
  Docker in `docker logs`. Anyone who can read those logs gets owner access to the Node.
- Without a previous token, `resolveDeviceToken` issues a fresh launcher device. A Node that a
  service manager restarts after every crash adds a device row each time, and its token goes to the
  log each time.
- These read the stdout handshake:
  - `apps/tui/src/node/supervise.ts` spawns the Node with piped stdout, which is private to the
    terminal client, and passes the previous token in `ACORN_DEVICE_TOKEN`.
  - `scripts/remote-node.mjs` reads the container's log for the launcher token and uses it to add a
    project and pair the development window.
  - Integration tests under `apps/node/test/integration/`, including
    `lifecycle/standaloneShutdown.test.ts`, `lifecycle/serviceSpawn.test.ts`,
    `lifecycle/enrollment.test.ts`, `auth/pairing.test.ts`, `audit.test.ts`, and
    `nodeProviders.test.ts`.
- `apps/cli/src/supervision/lifecycle.ts` already owns the pipe exchange for the CLI: it writes the
  previous token to file descriptor 4 and parses the handshake from file descriptor 3.

## Design

Split two things that background mode ties together: the pipe exchange and the log file.

- `ACORN_LAUNCHER_PIPES=1` turns on the pipe exchange. The Node reads the previous token from file
  descriptor 4 and writes the full handshake, token included, to file descriptor 3. The CLI, the
  terminal client, and the tests set it.
- `ACORN_CLI_BACKGROUND=1` keeps its other job: the rotating log file and the service ID.
- Without launcher pipes, the Node prints the handshake without `deviceToken` and doesn't call
  `resolveDeviceToken`. It mints no launcher device.
- `ACORN_DEVICE_TOKEN` goes away. A token in the environment is readable by any process the Node
  spawns and by `ps eww`, which is the exposure [Node keys](../../security/credentials.md#node-keys)
  already removed for the Node's own keys.

The pairing banner stays. On a fresh data root it still prints a code, because no device is paired.
A code lasts ten minutes, allows five attempts, and opens only while no device exists, so a copy in a
log is a much smaller exposure than a token. Phase 2 gives a service install a way to pair that
doesn't read the log at all.

The pipe exchange is security-relevant, and two copies of it would drift. Move the CLI's spawn,
token write, and handshake parse into `@acorn/custody/local`, and have the CLI and the terminal client
call it.

## Steps

1. In `apps/node/src/entries/standalone.ts`, gate the file descriptor exchange on
   `ACORN_LAUNCHER_PIPES`, and gate the log file on `ACORN_CLI_BACKGROUND`. Without pipes, leave
   `deviceToken` out of the handshake and skip `resolveDeviceToken`.
2. Move the pipe exchange out of `apps/cli/src/supervision/lifecycle.ts` into `packages/custody/src/local`,
   and call it from the CLI.
3. Change `apps/tui/src/node/supervise.ts` to start the Node through the same function, and stop
   passing `ACORN_DEVICE_TOKEN`.
4. Change `scripts/remote-node.mjs` to pair the way a person does. It reads the pairing code from the
   container's banner, pairs as a device named `remote rig`, and uses that device's token for the
   project setup and for opening a code for the development window.
5. Move the integration tests onto launcher pipes through their shared spawn helper.
6. Rewrite the README that `scripts/pack-node.mjs` writes into the tarball. Drop the `openssl` key
   line, and point at `docs/node-distribution.md` and, once phase 2 lands, `acorn node start --foreground`.
7. Update [Node distribution](../../node-distribution.md#runtime) with the handshake contract: the
   token travels only over launcher pipes.

## Acceptance

- A test starts the standalone Node with stdout redirected to a file on a fresh data root. The file
  holds a handshake with no `deviceToken` field and no `acorn_dt_` string.
- The same Node restarted five times without pipes adds no device rows. A paired client's
  `GET /v1/core/devices` shows the same list after each restart.
- `acorn node start --background`, the terminal client's own start, and `pnpm dev:remote` work as
  before. The terminal client reuses its device row across restarts.
- The integration suites under `apps/node/test/integration/` pass on launcher pipes.

## Risks

- A script that parsed the token from `npm start` output stops working. No published artifact
  carries the tarball, so the scripts at risk are in this repository, and step 4 and step 5 cover
  them.
- A first-boot banner code still reaches a service manager's log. Phase 2's `acorn node pair` is the
  documented way to pair a service install, and the banner is for a person at a terminal.

## Verify before building

- Confirm that `resolveDeviceToken` in `packages/node-core/src/server/auth` mints a new row when it
  gets no previous token, and check whether anything else relies on the launcher device existing.
- Check `apps/node/Dockerfile` and `docs/local-development/remote-node.md` for any other reader of
  the token in the container's log.
- Grep for `ACORN_DEVICE_TOKEN` across `apps`, `packages`, `scripts`, and `docs` before removing it.
