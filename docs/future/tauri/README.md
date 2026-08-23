# Tauri migration

Status: historical, closed 2026-08-23. This folder planned the replacement of the Electron host with
a Tauri v2 shell, and all six phases are done. Shipped behaviour is
[docs/shell.md](../../shell.md); read that first and treat everything here as the reasoning behind
it, verified against the tree as it was on the date each phase landed.

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

**Phase 3 landed on trunk, 2026-08-23.** The seam has no null groups left. The preview pane and plugin
webview surfaces are child webviews driven from `src-tauri/src/webviews.rs`, the tunnel credential
travels as a cookie the shell seeds and the renderer never sees, `app-plugin://<hash>` serves plugin
frames out of the cache, and a first launch adopts an Electron build's custody root. Agent browser
automation left the shell for `plugins/browser`, so `desktop.browser-*` is deleted rather than ported.
Five details changed on contact, including a capability scoped to the window that would have handed
`invoke` to every preview page; [sequencing.md](./sequencing.md) has them.

**Coexist, then cut over.** The Tauri shell was a second package, `apps/desktop-tauri`, consuming the
same renderer source, node artifact, bundled-plugins build, and protocol, with CI building both from
the same commit. Phase 5 merged it into `apps/desktop` and deleted Electron. In-place conversion was
rejected up front: no fallback artifact, and every failure ambiguous between "Tauri cannot do it" and
"the port broke it".

**Custody stays TypeScript, in a Node "desktop helper" sidecar.** The broker, fleet store, token
store, plugin cache and trust, preview tunnel, and service supervision move verbatim into a helper
process that Rust supervises. Rust holds one secret: a data key in the OS keychain. Rewriting the
broker in Rust was rejected; so was moving it into the renderer. [architecture.md](./architecture.md)
carries the full argument.

**Ship a real Node runtime.** A pinned Node binary rides in the bundle as an external binary, and
the same version pin feeds `scripts/pack-node.mjs`. One runtime pin, two consumers.
[node-runtime.md](./node-runtime.md).

**Preview and plugin webviews arrived after the skeleton, in phase 3.** The seam groups are nullable,
so a shell without them was a supported product state rather than a hack. Agent browser automation left
the shell entirely: `plugins/browser` ships `playwright-core`, contributes its tools through the
agent-tool registry (so they project to MCP for free), and drives an installed Chrome. Screenshots are
rows in the plugin's own table rather than inline base64, so a future audit trail at the registry seam
has something to read. [webviews-and-frames.md](./webviews-and-frames.md).

**Phase 5 landed on trunk, 2026-08-23.** `apps/desktop` is the Tauri app. The Electron shell, its
build files, its e2e specs, and its dependencies are deleted; `docs/electron.md` is replaced by
[docs/shell.md](../../shell.md); the arch rule against Electron is a flat ban across imports,
`createRequire` calls, and manifests. Phase 3's one waiver closed by deletion rather than by
implementation: `desktop.preview-*` had no registrant and no caller once Electron went, so it left
the protocol with `DesktopCapabilities`. [sequencing.md](./sequencing.md) has the whole list.

**Phase 4 landed on trunk, 2026-08-23.** `pnpm --filter @acorn/desktop run build` produces an
ad-hoc signed DMG with signed updater artifacts, and checks its own output against what staging wrote
before it finishes. `.github/workflows/build-tauri.yml` runs it on a push to main, alongside
`build-dmg.yml`. The pinned Node is fetched from nodejs.org and checksum-verified rather than copied
from the developer's runtime. The inventory check earned its place on the first run by catching a
packaged-only bug: the shell looked for the bundled Node under `Contents/Resources` and `externalBin`
stages it into `Contents/MacOS`. Three more details changed on contact;
[sequencing.md](./sequencing.md) has them.

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
| 3 | Feature parity | ✅ Done (2026-08-23) | L |
| 4 | Packaging and CI | ✅ Done (2026-08-23) | M |
| 5 | Cutover and deletion | ✅ Done (2026-08-23) | M |

Ordering and exit criteria live in [sequencing.md](./sequencing.md), which records what each phase
actually landed. Two items of the cutover trigger are still owed to a person and no script can close
them: the smoke checklist in [testing.md](./testing.md) run against the DMG on a machine that never
had the Electron build, and the soak window. They are release gates now rather than cutover gates,
because the Electron artifact no longer exists to fall back to.

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
- Security posture is a floor. Every property recorded in [docs/shell.md](../../shell.md)
  is re-established or explicitly re-argued in these files, never silently dropped. The one
  deliberate change is the renderer CSP's `connect-src`, argued in
  [architecture.md](./architecture.md).
- One artifact. The desktop-embedded node and the standalone tarball's node are the same
  `apps/node/dist` build, differing in supervision only.

## Drift warning

Paths and behaviour claims in this folder were verified against the tree on 2026-08-22, before any of
it was built. Several are now wrong: `apps/desktop-tauri` is `apps/desktop`, `src/client/bridge.ts`
and `src/main/helperMain.ts` are under `src/shell/`, and the Electron files these documents compare
against are gone. [docs/shell.md](../../shell.md),
[docs/architecture-overview.md](../../architecture-overview.md), and
[docs/node-distribution.md](../../node-distribution.md) win over anything here.

## What closed this folder

The Tauri build is the released artifact, the deletion list in [sequencing.md](./sequencing.md) is
executed, and [docs/shell.md](../../shell.md) describes what ships. This folder's content is history
now, not plan. Where it disagrees with `docs/shell.md`, that file wins.

## Reference documents

- [docs/shell.md](../../shell.md) — what the shell does today, and what every parity item was
  written against when it was `docs/electron.md`
- [docs/architecture-overview.md](../../architecture-overview.md) — runtime topology
- [docs/node-distribution.md](../../node-distribution.md) — the standalone node that ships today
- [bundle.md](../bundle.md) — node packaging; [remote.md](../remote.md) — non-desktop clients
- `references/proliferate/apps/desktop/src-tauri/` and its release workflow — the working example
