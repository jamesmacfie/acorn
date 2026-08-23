# Node runtime

Status: historical. Proposed 2026-08-22, built in phase 2 and finished in phase 4, 2026-08-23.
[docs/shell.md](../../shell.md) § Node child owns shipped behaviour.

## The problem

Electron gets a Node runtime for free: the desktop spawns `apps/node/dist/service.js` with
`process.execPath` and `ELECTRON_RUN_AS_NODE=1`, and the fd-3 `'ipc'` stdio channel carries the
service protocol. Agents and MCP registration spawn `process.execPath` the same way. Tauri ships no
Node, and a Rust parent cannot speak Node's structured `process.send` channel natively.

## Design

**Bundle a pinned real Node binary as a Tauri external binary** (`binaries/node-<target-triple>`),
declared in `tauri.conf.json` `bundle.externalBin`. The version pin is `node-runtime.json` at the
repo root, read by `apps/desktop/scripts/stage.mjs` and by `scripts/pack-node.mjs` — one
runtime pin, two consumers. It pins the Node 24 LTS line the node already requires (`node:sqlite` is
what sets the floor, [docs/node-distribution.md](../../node-distribution.md)), and the helper reports
`process.version` in its ready line so the boot test can assert the runtime that booted is the one
the pin names.

The staging script fetches the pinned build for its target from nodejs.org and verifies it against
that release's `SHASUMS256.txt` before it goes anywhere near the bundle
(`apps/desktop/scripts/nodeRuntime.mjs`). It caches the extracted binary with its digest beside
it, so a re-stage re-verifies without the network. Phase 2 copied whichever Node was running the
script and refused when that was not the pin; phase 4 replaced that with one path, so a developer
build and a release bundle the same verified bytes and nobody has to switch runtimes to stage.

The helper from [architecture.md](./architecture.md) is launched as `node-<triple> helper.js`.
Because the helper is a real Node process:

- `serviceHost.ts` spawns `service.js` via `process.execPath` with the `'ipc'` stdio entry exactly
  as today. **One line changes: delete `ELECTRON_RUN_AS_NODE`.** `ServiceRpcPeer`, the
  Zod-validated messages in `packages/protocol/src/serviceProtocol.ts`, and the start/stop/drain
  choreography need zero changes.
- Agents and MCP spawning `process.execPath` with `ELECTRON_RUN_AS_NODE` in the env keep working:
  under real Node the variable is inert and `process.execPath` is the bundled binary. Clean the
  variable up at leisure, not on the critical path.

## Supervision parity

The Rust side supervises the helper, and the helper supervises the node, so the behaviors recorded
in [docs/shell.md](../../shell.md) carry over by keeping their code: the crash budget (five
restarts inside ten minutes, 1-2-4-8-16-second backoff — `crashBudget.ts`), device-token persistence
across restarts, fail-closed startup, and the recovery UI. The Rust helper supervisor transposes
`references/proliferate/apps/desktop/src-tauri/src/sidecar.rs`: generation-counted exit observers,
bounded restart backoff, kill-escalation on quit, and the login-shell PATH inherit for
Finder-launched apps (today's equivalent lives in `apps/node/src/service/runtime.ts` behind
`isPackaged`).

## What dies

- The Electron-ABI half of the node-pty story: `electron-rebuild` in the desktop build, and the
  Electron branch of `scripts/rebuild-node-abi.mjs`. N-API prebuilds against real Node everywhere.
  The Linux source-build item from [bundle.md](../bundle.md) remains the one open CI task.
- The `ELECTRON_RUN_AS_NODE` trick, including its appearance in
  `packages/node-core/src/main/mcpRegister.ts` and the agents driver.
- The `process.resourcesPath` sniffs in `packages/node-core` still work, and phase 2 checked both
  call sites. `process.resourcesPath` is an Electron addition, so under the helper it is undefined and
  both `bindings.ts` and `pluginMigrations.ts` fall through to their walk-up: they climb from the
  service module looking for a `migrations` directory. The staging script puts one right beside
  `service.js`, so the first place they look is the right one, and neither file needed a change.

## Why not the alternatives

- **A Rust node.** The node is the product. Rewriting it is not a migration.
- **Require system Node.** The desktop must work out of the box; "client + node in one install" is
  the point. The standalone tarball may keep asking for system Node per [bundle.md](../bundle.md).
- **Node SEA.** Already rejected in [bundle.md](../bundle.md); node-pty makes it worse.
- **Proliferate's tar.zst resource with hydration.** Their agent seed is a mutable multi-artifact
  payload (a Node runtime plus npm-installed agent CLIs) that needs staging, checksums, quarantine
  stripping, and ownership state. Acorn needs one boot-critical binary; `externalBin` ships it
  signed inside the bundle with none of that machinery.
- **Emulate `NODE_CHANNEL_FD` from Rust.** Undocumented, fiddly, and unnecessary once the helper
  exists: Node-to-Node IPC stays Node-to-Node.

## Spike findings

Run 2026-08-23, Node 24.11.0 (module ABI 137) copied into `binaries/node-aarch64-apple-darwin`, Rust
spawning it directly. The throwaway driver is at `~/Source/acorn-tauri-spike/spike-node` with its
helper in `js/helper.js`; raw output in `findings/spike3.log`. It boots the real
`apps/node/dist/service.js`, not a stub.

Verdict: go. The design holds as written, and two operational requirements it did not name came out
of the run.

- **The node boots under a real Node with one line deleted.** The helper spawns the service with
  `stdio: ['ignore', 'pipe', 'pipe', 'ipc']` and no `ELECTRON_RUN_AS_NODE`, and the
  protocol-3 `service.start` handshake came back with the endpoint, node id, device token,
  fingerprint and certificate. States ran `starting → migrating → listening → reconciling → ready`, and a request to
  `/v2/node` verified against the reported certificate returned 200. Helper up in 45-58 ms, service
  ready 533-597 ms after that.
- **node-pty needs no rebuild.** The prebuild loaded under ABI 137 and a real PTY ran a command and
  reported its output. The dual-ABI dance is deletable.
- **No `SESSION_ENC_KEY` is needed.** The helper passed none and the service minted its own
  `session.key` in the data root through `ensureSessionKey`, which is what deleting
  `sessionKeyStore.ts` assumes.
- **The helper must own the node's process group.** A `SIGKILL` on the helper alone orphans the
  service, which keeps holding the data root's exclusive lock, and the restarted helper's node then
  refuses to boot with `Another acorn node already holds <dataDir>`. Spawning the helper with its own
  process group and killing the group fixed it: restart to `listening` again took 700-940 ms across
  two generations on the same data root. Rust owns this, and it is not optional.
- **The helper's command channel has to be live before the node is.** Rust can send `stop` while the
  node is still booting. A helper that installs its stdin handler after `service.start` resolves
  drops that line and gets killed for not quitting, so the handler is installed at boot and queues
  anything that arrives early.
- **The service bundle needs a staging directory.** `apps/node/dist/service.js` externalises its
  dependencies and cannot resolve them from `apps/node`; under Electron it runs from
  `apps/desktop/out/main`, whose `node_modules` has them. The Tauri bundle needs the same staging,
  which is packaging work in phases 2 and 4, not a code change.

## Exit criteria

- The node boots under the bundled runtime spawned from Rust via the helper; the versioned start
  handshake is adopted; `apps/node/test/integration/standaloneParity.test.ts` stays green. **Met in
  phase 2**, and `apps/desktop/test/boot.test.ts` is what holds it.
- Killing the service honors the crash budget and reaches the recovery UI on the sixth crash. The
  budget and the dialog are both wired; item 7 of the smoke checklist in [testing.md](./testing.md)
  is what confirms it.
- The desktop build contains no `electron-rebuild` step and no Electron-ABI native module. True of
  `apps/desktop-tauri`; the Electron package keeps its rebuild step until cutover.
