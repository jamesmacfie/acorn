# Node runtime

Status: proposal, 2026-08-22.

## The problem

Electron gets a Node runtime for free: the desktop spawns `apps/node/dist/service.js` with
`process.execPath` and `ELECTRON_RUN_AS_NODE=1`, and the fd-3 `'ipc'` stdio channel carries the
service protocol. Agents and MCP registration spawn `process.execPath` the same way. Tauri ships no
Node, and a Rust parent cannot speak Node's structured `process.send` channel natively.

## Design

**Bundle a pinned real Node binary as a Tauri external binary** (`binaries/node-<target-triple>`),
declared in `tauri.conf.json` `bundle.externalBin`. The version pin lives in one shared manifest
that both the desktop build and `scripts/pack-node.mjs` read — one runtime pin, two consumers. Pin
the Node 24 LTS line the node already requires (`node:sqlite` is what sets the floor,
[docs/node-distribution.md](../../node-distribution.md)); assert the exact version at helper boot
by having the helper report `process.version` in its ready line.

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
in [docs/electron.md](../../electron.md) carry over by keeping their code: the crash budget (five
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
- The `process.resourcesPath` sniffs in `packages/node-core` still work — the helper receives the
  resources directory over its stdin handshake and passes it down the same way Electron main does
  today — but verify both call sites (`bindings.ts`, `pluginMigrations.ts`) during phase 2.

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

## Exit criteria

- The node boots under the bundled runtime spawned from Rust via the helper; the versioned start
  handshake is adopted; `apps/node/test/integration/standaloneParity.test.ts` stays green.
- Killing the service honors the crash budget and reaches the recovery UI on the sixth crash.
- The desktop build contains no `electron-rebuild` step and no Electron-ABI native module.
