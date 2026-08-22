# Tauri migration

Status: proposal, 2026-08-22; phases 0, 1 and 2 executed 2026-08-23. Phases 3 to 5 are not scheduled. This
folder plans the replacement of the Electron host with a Tauri v2 shell, written for the agents and
developers who will implement the phases. The reference implementation we steal mechanics from is
`references/proliferate`, a shipped Tauri v2 app in this repo's references directory.

## Why Tauri, and what does not change

The migration is smaller than it sounds. The renderer (Solid), the node service, the protocol, and
both plugin tiers are untouched. Product traffic already runs over HTTPS `/v2` plus one WebSocket
per node; Electron IPC carries only platform glue and custody. Exactly 12 non-test files in
`apps/desktop/src/app/main/` import Electron values, plus two lazy adapters in `plugins/preview`
and `plugins/terminal`, and `tools/arch/boundaries.test.ts` enforces that boundary today. The
renderer's one door to the host is `packages/client-core/src/platform/`, whose capability groups
are all nullable. A Tauri host is a second implementation of that seam, not a rewrite.

What the move buys, and only this:

- The node runs under a real Node binary, so the node-pty dual-ABI rebuild dance
  (`electron-rebuild` on one side, `scripts/rebuild-node-abi.mjs` on the other) is deleted.
- A smaller binary and lower baseline memory than a bundled Chromium.
- An update path. Electron acorn has no auto-updater; the Tauri pipeline generates updater
  artifacts from the first release so turning updates on later is configuration, not a rebuild.
- The platform seam gets its second consumer, which proves the seam. [remote.md](../remote.md)'s
  web client becomes the third.

What it costs is real and named in the topic files: `WebContentsView` has no direct equivalent, so
the preview pane becomes a child webview under an unstable feature, and CDP browser automation dies
with `webContents.debugger`. WKWebView is not Chromium either, but phase 0 checked the two places
that mattered — the plugin-frame origin model and the worker CSP trick — and both behave as the
design needs.

## The decisions

**Phase 0 says go, recorded 2026-08-23.** All three spikes ran on macOS with Tauri 2.11.5 and wry
0.55.1, and nothing came back that invalidates a design in this folder. Per-response CSP, real
origins per plugin hash, storage separation, the sandboxed cross-scheme iframe, the `MessagePort`
bridge, the worker's own `'wasm-unsafe-eval'` policy, subframe navigation guarding, child-webview
compositing with an ephemeral store, `window.open` denial, and the node booting under a bundled Node
with a real PTY all work. Four adjustments landed in the owning files: the tunnel cookie is written
from Rust instead of seeded through a page and cannot be read back, a scheme handler never sees a
request body, the widened `connect-src` also needs a CORS header from the helper, and Rust must own
the helper's process group or a helper crash wedges the node on the data root's lock. The two design
fallbacks phase 0 was insurance for — loopback-port plugin origins and a
`decidePolicyForNavigationAction` extension — are dropped. Findings live in
[webviews-and-frames.md](./webviews-and-frames.md) and [node-runtime.md](./node-runtime.md). The
spike app is throwaway and deliberately not in this repo; it was run from `~/Source/acorn-tauri-spike`
on the machine that produced these numbers, and its raw JSON is in that directory's `findings/`.

**Phase 1 landed on trunk, 2026-08-23.** The platform seam has a contract suite both hosts run, the
renderer Vite config is a shared module rather than a block inside the Electron config, and the
Electron-free custody stack is gathered in `apps/desktop/src/app/main/helper/` behind one composition
root, with an arch rule keeping Electron out of it. Two injections were needed and are the shape phase
2 wants anyway: the device-token cipher, and the service's shell-only capability handlers.
[sequencing.md](./sequencing.md) has the detail.

**Phase 2 landed on trunk, 2026-08-23.** `pnpm dev:tauri` boots the Rust shell, the desktop helper
under a bundled Node 24.11.0, the node service, and an HMR renderer on `app://acorn`. The custody
stack became `packages/desktop-helper` rather than staying in `apps/desktop` until cutover, because
the arch rule against apps importing each other left no other place for code two shells run. Four
design details changed on contact and are recorded in [sequencing.md](./sequencing.md): the helper
wire is one WebSocket rather than a socket plus loopback HTTP, `connect-src` also names Tauri's own
IPC protocol, dev proxies Vite through `app://` instead of loading `devUrl`, and a dev build skips
the keychain.

**Coexist, then cut over.** The Tauri shell is a new package (`apps/desktop-tauri`)
consuming the same renderer source, node artifact, bundled-plugins build, and protocol. CI builds
both from the same commit; Electron ships until the cutover checklist in
[sequencing.md](./sequencing.md) is green. In-place conversion was rejected: no fallback artifact,
and every failure is ambiguous between "Tauri cannot do it" and "the port broke it".

**Custody stays TypeScript, in a Node "desktop helper" sidecar.** The broker, fleet store, token
store, plugin cache and trust, preview tunnel, and service supervision move verbatim into a helper
process that Rust supervises. Rust holds one secret: a data key in the OS keychain. Rewriting the
broker in Rust was rejected; so was moving it into the renderer. [architecture.md](./architecture.md)
carries the full argument.

**Ship a real Node runtime.** A pinned Node binary rides in the bundle as an external binary, and
the same version pin feeds `scripts/pack-node.mjs`. One runtime pin, two consumers.
[node-runtime.md](./node-runtime.md).

**Preview and plugin webviews arrive after the skeleton.** The seam groups are nullable, so a shell
without them is a supported product state, not a hack. Agent browser automation leaves the shell
entirely: a browser plugin ships `playwright-core`, contributes its tools through the agent-tool
registry (so they project to MCP for free), and drives an installed or managed browser — rich
results land as blobs so a future audit trail at the registry seam captures them.
[webviews-and-frames.md](./webviews-and-frames.md).

**No updater in v1.** It is hard-blocked on Apple Developer ID signing regardless of shell. The
minisign keypair and updater artifacts exist from the first release.
[packaging-and-release.md](./packaging-and-release.md).

**The Electron e2e specs are not ported.** The harness is leaving core anyway; their coverage is
decomposed in [testing.md](./testing.md).

**Headless nodes stay `pack-node.mjs` tarballs.** Tauri does not become a second node-packaging
path. [distribution.md](./distribution.md) records the convergence points with
[bundle.md](../bundle.md).

## The files

| File | What it holds |
| --- | --- |
| [architecture.md](./architecture.md) | Process model, helper design, renderer contract, boot order, key custody, lifecycle. |
| [node-runtime.md](./node-runtime.md) | The bundled Node binary, the surviving fd-3 service protocol, supervision parity. |
| [webviews-and-frames.md](./webviews-and-frames.md) | Preview panes, plugin frame origins, plugin webviews, browser automation. Spike findings land here. |
| [dev-workflow.md](./dev-workflow.md) | `tauri dev` wiring, config overlays, the node in dev. |
| [packaging-and-release.md](./packaging-and-release.md) | Staging, bundling, CI, signing gates, the updater stance. |
| [distribution.md](./distribution.md) | Desktop, headless nodes, and remote clients as one artifact story. |
| [testing.md](./testing.md) | What replaces the e2e specs; the tests the migration itself needs. |
| [sequencing.md](./sequencing.md) | Phases, exit criteria, the cutover trigger, the deletion list. |

## Phases

| Phase | Name | Status | Size |
| --- | --- | --- | --- |
| 0 | De-risk spikes | ✅ Done, go (2026-08-23) | M |
| 1 | Groundwork that lands in Electron | ✅ Done (2026-08-23) | M |
| 2 | Rust shell skeleton + helper | ✅ Done (2026-08-23) | L |
| 3 | Feature parity | ⬜ Not started | L |
| 4 | Packaging and CI | ⬜ Not started | M |
| 5 | Cutover and deletion | ⬜ Not started | M |

Ordering and exit criteria live in [sequencing.md](./sequencing.md), which records what each finished
phase actually landed. Phase 3 is clear to start: the shell boots, the seam has two hosts running one
contract suite, and the two groups phase 3 fills are the two the bridge currently resolves null.

## Invariants

Read these before building anything in this folder.

- The renderer never learns which shell it is in. `packages/client-core/src/platform/` stays the
  only module that touches the host global, and no `isTauri` branch appears above the seam. The
  seam's types and the arch test need zero changes.
- The node composition graph stays host-blind. Nothing reachable from
  `apps/node/src/server/composition.ts` may import Tauri bindings, the same rule that keeps
  Electron out of the standalone node today.
- The protocol and `/v2` are unchanged. A Tauri client pairs with an Electron-era node and the
  reverse, throughout the migration.
- Security posture is a floor. Every property recorded in [docs/electron.md](../../electron.md)
  is re-established or explicitly re-argued in these files, never silently dropped. The one
  deliberate change is the renderer CSP's `connect-src`, argued in
  [architecture.md](./architecture.md).
- One artifact. The desktop-embedded node and the standalone tarball's node are the same
  `apps/node/dist` build, differing in supervision only.

## Drift warning — read this before building

Every path and behavior claim in this folder was verified against the tree on 2026-08-22. Where
this folder disagrees with [docs/electron.md](../../electron.md),
[docs/architecture-overview.md](../../architecture-overview.md), or
[docs/node-distribution.md](../../node-distribution.md), those win until cutover: they describe
what ships, this folder describes a proposal. Where this folder deliberately proposes changing a
shipped behavior, the owning file here says so explicitly.

## What closes this folder

The Tauri build is the released artifact, the deletion list in [sequencing.md](./sequencing.md) is
executed, and [docs/electron.md](../../electron.md) is replaced by a shipped-behavior shell doc.
At that point this folder's content is history, not plan.

## Reference documents

- [docs/electron.md](../../electron.md) — the behavior contract every parity item is written against
- [docs/architecture-overview.md](../../architecture-overview.md) — runtime topology
- [docs/node-distribution.md](../../node-distribution.md) — the standalone node that ships today
- [bundle.md](../bundle.md) — node packaging; [remote.md](../remote.md) — non-desktop clients
- `references/proliferate/apps/desktop/src-tauri/` and its release workflow — the working example
