# Sequencing

Status: proposal, 2026-08-22. Coexistence, the phases, the cutover trigger, and the deletion list.

## Coexistence: a second app package

`apps/desktop` (Electron) remains untouched and shipped. The Tauri shell is a new package, working
name `apps/desktop-tauri`, holding `src-tauri/` plus the extracted renderer Vite config, consuming
the same renderer source, node artifact, bundled-plugins build, and protocol. CI builds both from
the same commit. This works because the Electron surface is 12 files behind an arch-tested seam:
the two shells are two consumers of one seam, not two forks. The shared renderer config is
extracted once and imported by both build systems so it cannot drift.

## Phases

| Phase | Name | Size | Ships while Electron ships? |
| --- | --- | --- | --- |
| 0 | De-risk spikes | M | yes (throwaway) |
| 1 | Groundwork that lands in Electron | M | yes (on trunk) |
| 2 | Rust shell skeleton + helper | L | yes (parallel app) |
| 3 | Feature parity | L | yes (parallel app) |
| 4 | Packaging and CI | M | yes (parallel artifact) |
| 5 | Cutover and deletion | M | — (the flip) |

### Phase 0 — de-risk spikes

Run these first; each deliverable is a findings section in the owning topic doc, and the go/no-go
lands in the README decisions.

1. **Custom protocol, CSP, and iframe sandbox in WKWebView** — the spike that can invalidate the
   plugin-frame design, detailed in [webviews-and-frames.md](./webviews-and-frames.md). It runs
   before anything is built.
2. **Multi-webview compositing** — the preview pane's mechanism: a child webview over the main one,
   hidden under overlays, ephemeral session, navigation policy.
3. **Node sidecar spawn** — spawn a pinned Node from Rust, boot a minimal helper, have it spawn
   `service.js` over fd-3 IPC, receive the start handshake, kill it, observe the restart path.

Exit: findings written, go/no-go recorded.

### Phase 1 — groundwork that lands in Electron

Three changes the Tauri shell needs are improvements to the Electron build too, so they ship on
trunk with production soak before any Rust exists. Nothing in this phase mentions Tauri in core.

- The platform-seam contract suite ([testing.md](./testing.md)); the Electron implementation
  passes it.
- The renderer Vite config extraction; Electron's config imports it
  ([dev-workflow.md](./dev-workflow.md)).
- Regroup `apps/desktop/src/app/main/` into helper-shaped modules: the Electron-free custody files
  gathered behind one composition seam, so the phase-2 move is a relocation, not a refactor.

Exit: all three on trunk, Electron build and tests green.

### Phase 2 — Rust shell skeleton + helper

`pnpm dev:tauri` boots: renderer served from the custom scheme with today's CSP, helper spawned
with the stdin handshake, node under the bundled runtime, `/v2` traffic flowing through the helper
broker, fleet visible. Preview and webview seam groups return null; browser tools report
unavailable. Exit: the boot test green in CI.

### Phase 3 — feature parity

Every capability in [docs/electron.md](../../electron.md) has a Tauri implementation or an argued
waiver recorded here: multi-webview preview and plugin webviews with the cookie-auth tunnel, plugin
frames and the trust store, key custody with the safeStorage migration, dialogs, quit negotiation,
recovery UI, navigation policy, and the Playwright browser plugin. Exit: the smoke checklist passes
on a dev build; no unrecorded gaps.

### Phase 4 — packaging and CI

The staging script, `tauri build`, inventory verification, ad-hoc DMG, updater artifacts with no
endpoint ([packaging-and-release.md](./packaging-and-release.md)). Exit: a fresh machine installs
the DMG and passes the smoke checklist.

### Phase 5 — cutover and deletion

The flip, then the cleanup, executed as one phase so nothing half-dead lingers.

## Cutover trigger

All four, not any:

1. The phase-3 parity list has no open waivers.
2. The packaged DMG passes the smoke checklist on a machine that never had the Electron build.
3. Developers have run `dev:tauri` as their default for an agreed soak window.
4. No invariant in the [README](./README.md) is regressed.

Signing does not gate cutover: today's build is ad-hoc signed with no updater, so ad-hoc parity is
parity.

## Deletion list

- `apps/desktop/src/app/main/` (the 12 Electron files, `preload.ts`, and their tests).
- `apps/desktop/electron-builder.yml`, `electron.vite.config.ts`, the electron scripts, and the
  electron, electron-vite, electron-builder, and @electron/rebuild dependencies.
- The Electron-ABI branch of `scripts/rebuild-node-abi.mjs`; the plain-Node path stays for the
  standalone tarball.
- `apps/desktop/e2e` and `playwright.e2e.config.ts`, or whatever remains after the extraction.
- `.github/workflows/build-dmg.yml`.
- The lazy Electron adapters in `plugins/preview` and `plugins/terminal`, replaced in phase 3.
- Arch tests: the Electron-consumer baseline reaches zero and the rule flips to "nothing imports
  electron". Stale `better-sqlite3` and `sharp` entries in `pnpm-workspace.yaml` go with it.
- [docs/electron.md](../../electron.md) is replaced by a shipped-behavior shell doc, and this
  folder is marked historical.

## Rejected orderings

- **In-place conversion of `apps/desktop`.** No fallback artifact, a long broken trunk, and every
  failure ambiguous between "Tauri cannot do it" and "the port broke it". The parallel-package
  cost is near zero because the seam exists.
- **Big-bang parity in one phase.** Webviews and plugin frames are the highest-variance work; the
  skeleton must boot and soak before they start.
- **Porting the Playwright harness.** Spends against a harness that is leaving core, on a driver
  stack with worse fidelity than what it replaces.
- **Gating cutover on signing or the updater.** Couples the migration to a purchase decision it
  cannot influence.
- **Tauri as the headless-node installer.** Contradicts [bundle.md](../bundle.md); the tarball
  story is designed and host-agnostic.
