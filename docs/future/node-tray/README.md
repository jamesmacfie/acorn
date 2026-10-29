# Run a Node for clients on other machines

Date: October 18, 2026. Status: phases 1 to 7 landed on October 18, 2026. Phase 8, acceptance on real machines, is still to do.
The plans for phases 1 to 3 were removed on October 20, 2026, and are in Git history at commit
`ffe59144b`, under `docs/future/node-tray/`.

This programme lets a person run an acorn Node on one machine and drive it from a client on another.
It gives two ways to do that. A Node-only download for macOS, Linux, and Windows, built by a GitHub
Actions run, installs a Node with no desktop app. A tray mode in the desktop keeps the Node running
after the window closes. Read this page before you pick up a phase.

[Node distribution](../../node-distribution.md) owns the standalone Node. [The bundle plan](../bundle.md)
keeps the container image, the terminal client inside the desktop, and macOS signing. This programme
takes over its [platform archives](../bundle.md#produce-platform-archives),
[Windows operation](../bundle.md#finish-windows-operation-support), and
[installer](../bundle.md#add-the-installer) sections.

## What the programme delivers

At the end, these journeys work:

- A person downloads `acorn-node-<version>-<platform>` from a GitHub Actions run, checks its
  checksum, and runs the installer. They get an `acorn` command and a Node that starts at login and
  restarts after a crash. The machine needs no Node.js, npm, or compiler.
- On that machine, `acorn node reach` makes the Node answer on a network address, `acorn node pair`
  prints a pairing code and the six identity words, and `acorn node devices` and `acorn node revoke`
  list and remove paired clients.
- On another machine, the desktop's **Settings → Nodes** or `acorn --node https://HOST:PORT` pairs
  with that code and drives the Node: projects, tasks, terminals, agents, and workflows.
- On a machine with the desktop, closing the window can leave the Node running behind a tray icon.
  **Settings** makes it reachable and opens pairing codes.
- On either kind of install, the machine stays awake while an agent works or waits for its owner.

## Starting point

These facts hold at `bac75f17c`, on October 18, 2026:

- `pnpm pack:node` (`scripts/pack-node.mjs`) builds one platform-neutral tarball. It holds the Node
  service, the CLI, the terminal client, migrations, the bundled loaded plugins, and a generated npm
  manifest and lockfile. An operator needs a supported system Node, then runs `npm ci --omit=dev`,
  `npm rebuild`, and `node scripts/prune-runtime.mjs`. No CI job builds or uploads it.
- The tarball's own README tells the operator to mint `SESSION_ENC_KEY` with `openssl` and points at
  launchd and systemd units that no doc contains.
- An unpacked tarball has no `pnpm-workspace.yaml`, so the default data root lookup in
  `packages/node-core/src/server/storage/paths.ts` throws. `ACORN_DATA_DIR` is required.
- `acorn node start --background` (`apps/cli/src/supervision/lifecycle.ts`) starts a detached
  standalone Node. It passes the device token over private pipes and stores it in the CLI's custody
  store. It removes `ACORN_ADVERTISE_HOST` from the child's environment and prints no pairing
  banner. A Node started this way can be reached from another machine only after a hand edit of
  `node.json`, and nobody can open a pairing code for it without calling the API directly.
- Started by hand or by a service manager, the standalone entry prints its handshake on stdout
  (`apps/node/src/entries/standalone.ts`). The handshake includes a device token with full owner
  authority, so a service manager writes that token into its log.
- Only the desktop opens a pairing code on demand or answers a pairing request. The terminal client
  can ask to pair but can't allow anyone. A standalone Node reopens pairing on `SIGUSR1`, which
  Windows lacks. No command lists or revokes paired devices.
- `acorn node stop` and the terminal client stop a Node with `SIGTERM`. On Windows, Node.js ends the
  process at once for that signal, so the 30-second drain never runs.
- The shared listener honors `advertiseHost` in `node.json` for the desktop's Node too
  (`packages/node-core/src/server/transport/listener.ts`), but nothing in the desktop writes it.
- Closing the desktop's window quits the app and its Node (`apps/desktop/src-tauri/src/menu.rs`).
  Tauri's `tray-icon` feature is off. The renderer owns notifications, the dock badge, quit concerns,
  and the pairing approval dialog.
- Nothing in acorn asks the operating system to stay awake.
- CI builds desktop installers on `v*` tags and manual dispatches
  (`.github/workflows/build-desktop.yml`). It keeps their artifacts for one day and refuses to publish
  a release while the macOS build is ad-hoc signed.

## The phases

| Phase | What changes |
| --- | --- |
| 1 | The handshake carries the device token only over a launcher's private pipe. |
| 2 | `acorn node start --foreground`, `pair`, `devices`, `revoke`, `restart`, and a draining stop that works on Windows. |
| 3 | A route, `acorn node reach`, and a desktop setting choose which addresses the Node answers on. |
| [4](./04-platform-archives.md) | A GitHub Actions workflow builds and smoke-tests a self-contained archive for five platforms. |
| [5](./05-install-and-service.md) | An installer per operating system, a default data root, `acorn node service`, upgrades, and removal. |
| [6](./06-tray-mode.md) | Desktop tray mode: the Node keeps running when the window closes. |
| [7](./07-keep-awake.md) | The Node keeps the machine awake while agents work or wait for the owner. |
| [8](./08-acceptance.md) | Acceptance on real machines, recorded in `docs/testing/`. |

## Order and dependencies

Phase 1 comes first. It's a small security fix, and every service install in phase 5 depends on it.
Phase 2 follows, because phases 3, 4, and 5 call its commands. Phase 3 can run beside phase 2 once
the route exists, and its CLI command lands after phase 2.

Phase 4 can start at the same time as phase 1, because packaging doesn't depend on the commands.
Its smoke test gains steps as phases 1 and 2 land. Phase 5 needs phases 2 and 4.

Phases 6 and 7 don't depend on the Node-only path. Take them whenever there's room. Phase 6 shows
the Node's address in the tray when phase 3 has landed, and shows its state alone before that.
Phase 8 needs every other phase.

The shortest path to a Node-only download that a client on another machine can use is phases 1, 2,
4, 3, 5, and then the Node-only half of phase 8.

## What holds across every phase

- The Node's authentication model doesn't change. A device token keeps full owner authority, and
  pairing still needs a code or a local approval. No phase adds a listener, a port, or an
  unauthenticated trigger.
- A change to who can reach the Node, or a stop, is decided on the Node's own machine. Routes that do
  either answer only a loopback peer, as pairing by approval does.
- The standalone and supervised Nodes keep booting through `bootNode` in
  `apps/node/src/composition/boot.ts`. Each host difference stays a named option.
- One machine runs one Node. The Node-only download is for machines without the desktop. A standalone
  Node already refuses a desktop data root whose keys are sealed
  (`packages/node-core/src/server/sessionKey.ts`).
- An archive carries every file the Node needs at run time. The target machine needs no compiler,
  npm, or system Node.
- When a phase ships behavior, document it in the owning reference page and trim this plan. The
  owners are [Node distribution](../../node-distribution.md), [the local service](../../cli/local-service.md),
  [authentication](../../authentication.md), and [the shell process](../../shell/process.md).

## Decisions

The owner accepted these on October 18, 2026:

1. There are two hosts. The desktop gets tray mode. The Node-only download has no tray, and its
   interface is the terminal: the CLI and the terminal client.
2. While the window is closed, tray mode shows no notifications, sounds, or badge on that machine.
   The setting says so. A client on another machine still notifies.
3. The Node keeps the machine awake while an agent works or waits for its owner, or a workflow runs.
   It's a Node preference, on by default.
4. The Node-only download is for machines without the desktop. The installer warns when it finds a
   desktop data root.

One decision changed during research, and the owner should confirm it:

5. `acorn node pair` uses the device token that the CLI keeps for the local Node. The earlier
   proposal was a private socket or named pipe in the data root. Both rest on the same proof: being
   the operating system user who owns the Node's files. The CLI's custody folder is mode `0700`, the
   same protection the socket would have. The token route reuses the custody store and the existing
   pairing routes, adds no listener, and works the same way on Windows. Phase 2 makes the CLI hold
   that token for every Node that `acorn` starts, including one a service manager starts.

This plan assumes these defaults. The owner can change any of them:

6. Linux archives build `node-pty` in a `node:24-bullseye` container. That sets a glibc 2.31 floor,
   which covers Ubuntu 22.04, Debian 11, Raspberry Pi OS 11, and later releases.
7. GitHub keeps the archive artifacts for 14 days. That needs the repository's retention cap raised
   from one day in **Settings → Actions → General**. The desktop's upload keeps its own
   `retention-days: 1`.
8. Archives build on `v*` tags and manual dispatches, as the desktop's installers do, and not on every
   push.
9. Publishing a release stays behind the desktop's gate
   ([signing](../bundle.md#sign-macos-artifacts)). A person downloads from the run's artifacts.

## Out of scope

These stay with other plans:

- Reaching a Node that has no reachable address belongs to the [relay](../../relay.md).
  Until it exists, Tailscale or an SSH tunnel covers that case.
- The preview pane on a remote Node is [a remote Node's preview](../../shell/webviews.md#a-remote-nodes-preview).
- The browser extension pairs over loopback only, so it can't drive a remote Node
  ([browser extension](../../browser-extension.md)).
- The container image is [cloud phase 1](../cloud/01-node-image.md).
- Signing and notarization stay in [the bundle plan](../bundle.md#sign-macos-artifacts).
- Windows arm64, Alpine and other musl Linux distributions, and an automatic updater are left out.

## Why

A third app with its own settings window would copy the desktop's Settings, and it would need a
window toolkit on every platform. A tray icon on the Node-only download needs a desktop session, and
a machine reached over SSH has none. The CLI and the terminal client already run everywhere the Node
runs, and they already hold device tokens, so they're the cheapest interface for a machine nobody
sits at. The desktop already has every setting a person needs. Tray mode changes only what closing
the window does.
