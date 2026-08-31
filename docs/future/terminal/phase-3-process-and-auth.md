# Phase 3: the `acorn` command

Status: **shipped 2026-08-31.** What differs from the plan is at the bottom.

Read [findings.md](./findings.md) first: `fleetList` is what selects a node, not the transport, and `idb-keyval` sits unconditionally on the boot path.

## Goal

`acorn` attaches to the node for this machine's data root or starts one; `acorn --node <endpoint>`
pairs with and opens a remote node; device tokens and fingerprints live in the TUI's config
directory; a revoked token is reported and not retried; a boot test proves the whole path with a real
node child.

## Why this phase, and why now

Phase 0 needs a token in an env var and a node started by hand. Nothing after phase 2 is usable
without a real process model, and the model touches no rendering code, so it runs in parallel. The
desktop helper already owns almost all of it.

## Scope

In:

- Data root resolution by the node's own rule, imported not restated.
- Lock detection and the attach path: read the recorded endpoint and fingerprint, use the stored
  token, connect.
- The start path: spawn `standalone.js` under the runtime beside the TUI (or the system Node in dev),
  parse the handshake line, set `ACORN_DEVICE_TOKEN` from the stored token, keep the child, drain it
  on exit.
- The remote path: probe, six words, code, `POST /v2/pair`, store, pin.
- The `fleet` seam group over `FleetStore` in-process; `pairing` and `recovery` groups.
- The TUI's config directory: fleet store, tokens at 0600, fingerprints.
- Reconnect and `revoked` states surfaced on the footer.
- Exit: `q`, `SIGTERM`, `SIGINT` outside a PTY, each draining a child the TUI started.
- A boot test mirroring `apps/desktop/test/boot.test.ts`.

Out: chrome that shows fleet state (phase 4 draws it from this phase's signals), tunnels, the pairing
window command (doors left open), the device config file (`docs/future/client-plugins/phase-4-device-config.md`,
built for this host after this phase).

## Design detail

**Attach without a token.** The case where a node is running for the data root and the TUI has never
held a token for it. The desktop helper started that node and holds its launcher token; the TUI did
not. Two answers, the phase picks after reading the routes: the local pairing banner (the node printed
one at boot, and `SIGUSR1` reopens the window), which works today and costs a copy-paste; or a
loopback-only route that mints a device token for a caller who can prove it owns the data root (by
reading a nonce the node wrote there at 0600), which is new. Prefer the first for this phase and
record the second as a door.

**Supervision.** `packages/custody/src/supervision/` owns spawning the node, parsing the handshake,
and the bounded drain. Import it. The one thing the helper does that the TUI does not is speak
`shell/wire.ts` to a Rust supervisor; the TUI is its own supervisor and calls the same functions the
wire handlers call.

**Where things live.** `$XDG_CONFIG_HOME/acorn/` on Linux, `~/Library/Application Support/acorn/` on
macOS, `%APPDATA%\acorn\` on Windows, resolved by one function. Tokens in a file at 0600, fingerprints
beside them, the fleet store's JSON beside that. Windows gets the honest note `bundle.md § The snags`
already writes about file modes.

**One process, one broker.** `NodeBroker` runs in the TUI's process. The token is read by the broker's
module and nothing else; an arch rule in `apps/tui/` mirrors the desktop's platform-seam rule so no
kit component or pane module imports the token store.

## Code touched

- `apps/tui/src/main.ts` (new in phase 0): argument parsing, the attach-or-start decision, exit handling.
- `apps/tui/src/node/{supervise,attach,pair,paths}.ts` (new).
- `apps/tui/src/platform.ts` (new): the `globalThis.acorn` object with `transport`, `fleet`,
  `pairing`, `recovery`.
- `packages/custody/src/supervision/serviceHost.ts`: export the supervise and drain functions the wire handlers
  call, if they are not already exported.
- `packages/node-core/src/server/storage/dataRoot.ts` or wherever `openDataRoot` lives: expose "is locked"
  without taking the lock, if it is not already.
- `tools/arch/boundaries.test.ts`: the TUI token-store rule.

## Tests

- `apps/tui/test/boot.test.ts` (new): fresh data root, `acorn` starts a real `standalone.js`, the
  handshake parses, `GET /v2/node` answers 200 with the bearer, the `/v2/events` upgrade succeeds with
  the bearer in the header, `q` drains the child and the lock is released.
- A second `acorn` against the same root attaches rather than starting; the child count is one.
- The remote path against a node in the test with a wrong code fails identically to a wrong
  fingerprint (the node's own rule), and a right code stores a token at 0600.
- A `401` on the upgrade sets `revoked`, stops reconnecting, and is visible in the state the footer
  reads.

## Docs owed

- `docs/node-distribution.md`: `acorn` as a way to reach a node, beside the desktop.
- `docs/node-enrollment.md`: no change unless the loopback mint route is built.
- `docs/security.md § Transport and auth`: the terminal sets the header itself (phase 5 adds the
  rest of the column).
- `docs/future/bundle.md § The snags`: the pairing-window command as a Windows answer.

## Doors left open

- The loopback token-mint route for attaching to a node the desktop started.
- "Open a pairing window" as a TUI command, replacing `SIGUSR1` on Windows.
- Tunnels through the fleet group.
- The device config file: this phase creates the directory it lives in.

## Done when

On a machine with the desktop app running, `acorn` opens the same workspace the app shows. On a
machine with nothing running, `acorn` starts a node and opens it, and a second `acorn` attaches. On a
laptop, `acorn --node https://server:4317` walks through the six words and the code and opens the
server's workspace. The boot test passes in CI.

## Verify before building

- `apps/node/src/entries/standalone.ts` still prints one JSON handshake line with `deviceToken`, and
  `resolveDeviceToken` still reuses `ACORN_DEVICE_TOKEN`.
- `packages/custody/src/broker/nodePairing.ts` still has `probeNode` and `pairWithNode`.
- `packages/node-core/src/server/transport/wsHub.ts` still reads the bearer from the upgrade request's headers.
- `apps/desktop/test/boot.test.ts` still exists and still asks `/v2/node`.
- `openDataRoot` still takes an exclusive lock.

## What shipped, and where it differs

Five departures, each with the reason.

- **The supervisor is the TUI's, not the helper's.** The plan said to import
  `packages/custody/src/supervision/`. `ServiceHost` speaks the fd-3 service RPC to `service.js`; a
  standalone node prints one JSON line on stdout and speaks no RPC. `apps/tui/src/node/supervise.ts`
  is forty lines and copies the one part worth sharing, SIGTERM then SIGKILL after five seconds, with
  a pointer to where it came from. See [findings.md](./findings.md) § What phase 3 did with these.

- **Attaching without a token is the pairing banner**, as the plan preferred. `acorn` prints the
  running node's pid and the `kill -USR1 <pid>` that reopens its pairing window, then runs the same
  probe, words and code the remote path runs, against loopback. The loopback mint route stays a door.

- **There is one more file than the plan named.** `node/open.ts` holds the attach-or-start decision
  itself, because the boot test has to call it and `main.ts` is a script. `node/cache.ts` is the
  file-backed query-cache store, which closes a phase-0 finding the plan did not list in scope.

- **`nodeAdopt` and the tunnels are not installed.** Both were named in
  [03-process-model.md](./03-process-model.md)'s seam table; neither has a surface to be reached from
  until phase 4, and the seam already models an absent verb as a product state rather than a crash.
  Everything else in the `fleet` group is real: `list`, `probe`, `pair`, `rename`, `forget`,
  `reconnect`, `restartLocal`.

- **The boot test lives in `src/`, not `test/`.** This package's vitest config includes
  `src/**/*.test.{ts,tsx}` and nothing else, and adding a second root for one file would be a
  configuration change to avoid moving a file. It is `apps/tui/src/node/boot.test.ts`.

## What this phase deliberately left

- **The footer is one line, not the real one.** `App.tsx` swaps its hint line for the connection
  state when the broker reports anything but `online`, which is enough to see a `revoked` token or a
  node that has gone away. The footer drawn from the keymap's active layers is phase 4.

- **Nothing draws the fleet.** The seam carries every verb a nodes surface needs; there is no nodes
  surface. Phase 4 draws it from these signals.

- **The device token is plain bytes at 0600.** The desktop encrypts under the platform keychain
  through a `TokenCipher`; the TUI has no keychain and supplies a pass-through, which is what
  [06-isolation.md](./06-isolation.md) § The third column designs and what the node beside it already
  does with its own TLS private key and session key.
