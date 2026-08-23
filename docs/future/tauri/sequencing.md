# Sequencing

Status: historical. Proposed 2026-08-22, phases 0 to 5 executed 2026-08-23. Coexistence, the phases,
the cutover trigger, and the deletion list. [docs/shell.md](../../shell.md) owns shipped behaviour.

## Coexistence: a second app package

`apps/desktop` (Electron) remains untouched and shipped. The Tauri shell is a new package, working
name `apps/desktop`, holding `src-tauri/` plus the extracted renderer Vite config, consuming
the same renderer source, node artifact, bundled-plugins build, and protocol. CI builds both from
the same commit. This works because the Electron surface is 12 files behind an arch-tested seam:
the two shells are two consumers of one seam, not two forks. The shared renderer config is
extracted once and imported by both build systems so it cannot drift.

## Phases

| Phase | Name | Size | Ships while Electron ships? |
| --- | --- | --- | --- |
| 0 | De-risk spikes ✅ | M | yes (throwaway) |
| 1 | Groundwork that lands in Electron ✅ | M | yes (on trunk) |
| 2 | Rust shell skeleton + helper ✅ | L | yes (parallel app) |
| 3 | Feature parity ✅ | L | yes (parallel app) |
| 4 | Packaging and CI ✅ | M | yes (parallel artifact) |
| 5 | Cutover and deletion ✅ | M | — (the flip) |

### Phase 0 — de-risk spikes

Done 2026-08-23, verdict go. Each deliverable was a findings section in the owning topic doc, with
the go recorded in the README decisions. All three ran against one throwaway app, kept out of this
repo.

1. **Custom protocol, CSP, and iframe sandbox in WKWebView** — the spike that could have invalidated
   the plugin-frame design. Findings in [webviews-and-frames.md](./webviews-and-frames.md).
2. **Multi-webview compositing** — the preview pane's mechanism: a child webview over the main one,
   hidden under overlays, ephemeral session, navigation policy. Same file.
3. **Node sidecar spawn** — a pinned Node from Rust, a minimal helper, the real `service.js` over
   fd-3 IPC, the start handshake, a kill, and the restart path. Findings in
   [node-runtime.md](./node-runtime.md).

Exit met: findings written, go recorded in the [README](./README.md) decisions.

### Phase 1 — groundwork that lands in Electron ✅

Done 2026-08-23. Three changes the Tauri shell needs were improvements to the Electron build too, so
they shipped on trunk, ahead of any Rust, so they get real use before a second shell depends on them.
Nothing in this phase mentions Tauri in core.

- **The platform-seam contract suite** ([testing.md](./testing.md)).
  `packages/client-core/src/platform/contract.ts` states what a live capability group looks like, as a
  checker that returns problems rather than as `expect` calls, so both ends can run it without a test
  framework reaching into `src/`. `platform/contract.test.ts` drives it against a mock host and pins
  the discriminator rules; `apps/desktop/src/app/main/preload.test.ts` drives it against the real
  preload, loaded headless against a stub Electron, and the Electron host passes with every group
  implemented. The group member lists are compile-time exhaustive: a member added to a seam type and
  not listed fails `tsc`.
- **The renderer Vite config extraction** ([dev-workflow.md](./dev-workflow.md)).
  `apps/desktop/vite.renderer.config.ts` exports `rendererConfig(root)` and
  `electron.vite.config.ts` imports it. The worker rules travelled verbatim, and the extraction was
  checked by building both ways: the emitted `index.html` and asset hashes are identical. It lives in
  `apps/desktop` because that is the only shell there is; the Tauri package takes ownership when it
  lands, and Electron keeps importing it.
- **The custody regroup.** `apps/desktop/src/app/main/helper/` now holds the eleven Electron-free
  custody files, composed by `helper/index.ts` — the broker and fleet, device tokens, the plugin cache
  and trust store, the tunnels, and the supervised service, plus the restart and crash-recovery
  policy. `bootstrap.ts` is the Electron half: it passes in the cipher, the push target, the recovery
  dialog, and the IPC projections. A rule in `tools/arch/boundaries.test.ts` fails any Electron import
  under `helper/`.

Two seams had to be cut for the folder to be Electron-free, and both are the shape phase 2 wants:
`deviceTokenStore.ts` takes a `TokenCipher` (Electron supplies `safeStorage`; the helper will supply
the Rust-held data key), and `ServiceHost` takes the desktop-capability registrar as a callback
instead of importing `desktopCapabilities.ts`, which reaches the window system.

Exit met: all three on trunk, Electron `tsc`, the desktop suite, and the arch suite green.

### Phase 2 — Rust shell skeleton + helper ✅

Done 2026-08-23. `pnpm dev:tauri` boots the shell, the helper, the node and an HMR renderer against
the checkout data root. The renderer loads from `app://acorn` with the CSP below, `/v2` traffic runs
through the helper broker, and the fleet lists the local node. The preview and webview seam groups
resolve null and the bridge's contract test pins that, so a consumer hides those affordances rather
than calling into half a group.

What landed, and where it sits:

- **`packages/desktop-helper`.** The custody stack moved out of `apps/desktop/src/app/main/helper/`
  into its own workspace package, one phase earlier than the deletion list assumed. The arch rule
  "apps never import each other" forced it: `apps/desktop` cannot reach into `apps/desktop`,
  so the code both shells run has to live in a package. Electron's `bootstrap.ts` imports it exactly
  as it imported the folder. The plugin request schemas came with it, as
  `main/pluginRequests.ts`, because both shells parse them and a schema that drifted would mean one
  host recording an acknowledgement the other cannot read.
- **`apps/desktop`.** `src-tauri/` (six Rust modules), `src/main/` (the helper process),
  `src/client/bridge.ts` (the renderer bridge), `src/shared/wire.ts` (the vocabulary between them),
  and the Vite configs. It consumes `apps/desktop`'s renderer source through
  `vite.renderer.config.ts`, the import direction phase 1 set up.
- **`node-runtime.json`.** The runtime pin, read by `apps/desktop/scripts/stage.mjs` and by
  `scripts/pack-node.mjs`. One pin, two consumers, as designed.
- **The boot test.** `apps/desktop/test/boot.test.ts` runs the staged helper under the bundled
  Node against a fresh data root, then asks it the first two questions the renderer asks. Eleven
  Rust unit tests cover the parts a headless run cannot reach. See
  [testing.md](./testing.md) § The boot test.

Four things came out differently from the design:

- **The helper wire is one WebSocket, not a socket plus loopback HTTP.** The design widened
  `connect-src` for both `ws://` and `http://` on the helper's port. Only `ws://` is there, because
  everything including `node-fetch` fits one request-reply channel. That removes the CORS
  requirement phase 0 found, removes the preflight on every JSON write, and uses `abort(requestId)`
  as the seam already defines it. The cost is base64 on request and response bodies, marked with its
  ceiling in `src/shared/wire.ts`.
- **`connect-src` also names `ipc:` and `http://ipc.localhost`.** Tauri's own IPC is a custom
  protocol, and without it in the policy every `invoke` falls back silently to a slower postMessage
  path. It reaches only the commands in `commands.rs`.
- **Dev proxies the renderer through `app://` rather than loading `devUrl`.** The window always
  loads the custom scheme, in dev and packaged alike, so developers exercise the origin the shipped
  app uses. The dev-only widening for Vite's HMR socket and inline preamble is one branch in
  `renderer_csp`. See [dev-workflow.md](./dev-workflow.md).
- **A dev build skips the keychain.** An unsigned binary's keychain ACL does not survive a rebuild,
  so `cargo build` put a modal password prompt in front of every launch, and answering it granted
  nothing durable. Dev goes straight to the 0600 file that
  [architecture.md](./architecture.md) § Keys and custody already names as the common path on macOS.

Not in this phase, by design: preview panes, plugin webviews, plugin frames and the plugin scheme,
the `safeStorage` token migration, and the Playwright browser plugin. Those are phase 3.

### Phase 3 — feature parity ✅

Done 2026-08-23. Every capability in [docs/shell.md](../../shell.md) now has a Tauri
implementation or a waiver argued below. The platform seam has no null groups left: `bridge.test.ts`
drives the whole of `SEAM_GROUPS` against the real bridge and exempts nothing.

What landed, and where it sits:

- **`src-tauri/src/webviews.rs`.** One module for both the preview pane and plugin webview surfaces,
  because the difference between them is a policy function and a key prefix. Child webviews under
  `Window::add_child`, `incognito(true)` for the ephemeral store, logical bounds the renderer's pane
  geometry drives, `on_new_window` denying `window.open`, and `on_navigation` enforcing the URL policy
  before the load. The keys are the ones Electron's `WebviewService` already uses, `preview:<taskId>`
  and `plugin:<pluginId>:<nodeId>[:<surface>]`, so the renderer needed no change.
- **The tunnel credential is a cookie.** wry cannot inject `x-acorn-tunnel` per request, so
  `previewTunnel.ts` accepts the same per-listener secret in a `Cookie` header, and the shell seeds it
  into the pane's store before the first real navigation. The helper reports each listener's port and
  secret to Rust on the stdout pipe it already owns, so the secret reaches the shell and stops there —
  the renderer never sees it, which is the property the secret exists for.
- **`src-tauri/src/plugin_scheme.rs`.** `app-plugin://<hash>` serves the generated document, the shared
  frame stylesheet, and `client.js` out of `<userDataDir>/plugin-cache/<hash>.js`, with the frame CSP on
  every response. The window's navigation guard admits that scheme and no other, which is the subframe
  guard `will-frame-navigate` gives Electron.
- **`packages/desktop-helper/src/main/legacyCustody.ts`.** A first launch with no fleet of its own
  adopts the Electron build's custody root: `fleet.json`, the trust store, and the content-addressed
  plugin cache are copied, and the device tokens are decrypted under Chromium's os_crypt and
  re-encrypted under the data key. Rust reads the legacy keychain item and passes it in the handshake.
- **`plugins/browser`.** The six `browser_*` agent tools, driven by Playwright against an installed
  Chrome. They left `plugins/preview` with their pure accessibility-tree layer, which moved unchanged.
  Screenshots are rows in the plugin's own table, served back by `/v2/p/browser/captures/:id`, so a
  tool result is a handle that outlives the transcript.

Five things came out differently from the design:

- **The capability file was granting the whole window.** `"windows": ["main"]` gives `core:default` to
  every webview in that window, which from this phase on includes the preview pane and plugin webview
  surfaces — pages this app does not write. It is `"webviews": ["main"]` now, and a Rust test reads the
  JSON back and fails if `windows` reappears. This was a live hole for exactly as long as the phase
  that opened it.
- **The browser plugin is compiled, not loaded.** A loaded package is one inlined bundle with no
  `node_modules` of its own, and `playwright-core` brings native bits with it. It sits in the compiled
  roster beside `terminal`, which carries `node-pty` for the same reason. The browser itself is still
  not in any bundle: the plugin drives an installed Chrome and reports why when there is not one.
- **`desktop.browser-*` is deleted rather than reimplemented.** Its only consumer was the preview
  plugin's agent tools, which now have a browser of their own. `desktop.preview-*` stays in the
  protocol and stays registered by Electron, and the Tauri shell registers no handler for it. That is
  the phase's one waiver, and it costs nothing today: nothing reachable from
  `apps/node/src/service/runtime.ts` calls it. A node-side caller that wanted it would need a
  request-reply channel on the helper's stdio pipe, which is a day's work and has no requester.
- **Navigation history is the shell's own.** wry exposes none, so `webviews.rs` records what
  `on_navigation` reports and marks the traversals it asked for, which is what lets the pane offer back
  and forward honestly rather than always-enabled.
- **`stage.mjs` was bricking the bundled Node.** It overwrote `binaries/node-<triple>` in place, and
  macOS caches a code signature against the inode, so every re-stage produced a runtime the kernel
  SIGKILLed with no message. It removes the file before writing it now. The boot test caught it.

Exit met: `pnpm lint` clean across 29 packages, the Rust suite at 23 tests, the boot test green
against the staged helper, and the browser plugin's snapshot-act-verify loop verified against a real
Chrome (`pnpm --filter @acorn/plugin-browser test:smoke`).

### Phase 4 — packaging and CI ✅

Done 2026-08-23. `pnpm --filter @acorn/desktop run build` produces an ad-hoc signed
`acorn_0.1.0_aarch64.dmg` with signed updater artifacts beside it, and verifies its own output before
it finishes. `.github/workflows/build-tauri.yml` runs the same command on a push to main, alongside
`build-dmg.yml` rather than instead of it.

What landed, and where it sits:

- **`scripts/nodeRuntime.mjs`.** The pinned runtime, fetched from nodejs.org and verified against that
  release's `SHASUMS256.txt` rather than copied from whatever Node happens to be running the build.
  It caches the extracted binary with its digest beside it, so the second stage costs 0.3 seconds and
  no network. This is the piece phase 2 marked as owed.
- **`scripts/verify-bundle.mjs`.** The inventory check, run as the last step of the build. It compares
  every file staging produced against the same path inside the `.app`, by digest, and checks the code
  signature, the bundled runtime's reported version, the updater artifact and its signature, and the
  DMG. The expected inventory is whatever staging wrote, so nothing here drifts when a resource is
  added.
- **The build's own checks.** The renderer is built by the package rather than by `beforeBuildCommand`,
  so `check-renderer-budget.mjs` runs against the bytes that get bundled and the bundler does not
  repeat a build that already happened. Both that script and `check-runtime-syntax.mjs` take a
  directory argument now and keep their Electron defaults, so one copy of each serves both shells.
- **`.github/workflows/build-tauri.yml`.** Rust toolchain with a cargo cache, a cache for the pinned
  runtime keyed on `node-runtime.json`, staging, the boot test and the Rust suite, then the build and
  its verification. The boot test runs in CI for the first time here; nothing in this repo ran tests in
  CI before.

Four things came out differently from the design:

- **`bundle.macOS.signingIdentity` had to be set to `"-"`.** With no identity Tauri runs no `codesign`
  pass at all, so the `.app` carried the linker's ad-hoc mark on one binary and sealed no resources,
  which `codesign --verify` rejects. Gate 0 is stated as parity with Electron's `identity: null`, and
  that does real ad-hoc bundle signing, so this was the difference between parity and something
  weaker. A Rust test now reads the config back and fails if the identity, `createUpdaterArtifacts`,
  or the updater public key goes missing.
- **The shell resolved the bundled Node under the wrong directory.** `externalBin` stages it beside the
  executable, `Contents/MacOS`, and `lib.rs` looked under `resource_dir()`, `Contents/Resources`. The
  path exists only in a packaged build and no packaged build had been made, so nothing before this
  phase could have caught it. The inventory check found it on the first run.
- **The DMG's Finder-cosmetics AppleScript cannot run unattended.** It needs an Automation permission
  no build machine grants, and the call times out and fails the bundle. Tauri skips the step when `CI`
  is set, so the build script sets it for that one invocation and a local DMG matches the shipped one.
- **The packaged runtime is checked by what it reports, not by digest.** Signing rewrites every Mach-O
  in the bundle, so the bundled Node is deliberately not the staged bytes. Its provenance comes from
  the checksum staging verified before the copy.

Exit met, with one half owed to a person: the DMG builds, mounts, and passes inventory verification,
and `spctl` rejects it exactly as it rejects the Electron DMG. The smoke checklist on a machine that
never had the Electron build is the remaining item, and it is item 2 of the cutover trigger rather than
something a script can close.

### Phase 5 — cutover and deletion ✅

Done 2026-08-23. The flip and the cleanup in one phase, so nothing half-dead lingers. `apps/desktop`
is the Tauri app; `apps/desktop` and every Electron file are gone.

The two packages merged into `apps/desktop` rather than the renderer moving into `apps/desktop`
as the phase-2 note assumed. One desktop app should be called `desktop`, and keeping the name meant
every `apps/desktop/src/app/client/...` path in packages, plugins, and tests stayed valid, including
the three that are functional rather than prose (`adoption.test.ts`, `readStyleSheets.ts`, and the
arch suite's roots). The shell's own TypeScript is `src/shell/`: the injected bridge, the helper
process, and the wire between them, in one folder beside the renderer's `src/app/client/`.

What the deletion list asked for, and what happened to each item:

- **`apps/desktop/src/app/main/`.** Gone, all 19 files. `pluginFrameStyles.ts` was the one that was
  not Electron's: its ordered list moved into `scripts/stage.mjs`, which was already parsing it out
  of that file, and `cssHygiene.test.ts` reads it there. The parsing disappeared with the move, as
  phase 2 predicted it would.
- **The Electron build files and dependencies.** `electron-builder.yml`, `electron.vite.config.ts`,
  `build/`, `make-icons.sh`, and the electron, electron-vite, electron-builder, @electron/rebuild,
  @playwright/test, and @types/better-sqlite3 dependencies, in `apps/desktop` and in the preview and
  terminal plugins. `vite.renderer.config.ts` folded into `vite.config.ts`: the extraction existed to
  stop two shells drifting, and there is one.
- **`scripts/rebuild-node-abi.mjs`.** The Electron-ABI branch was already only prose. The comment
  says there is one ABI now, because the desktop runs the node under the same pinned runtime the
  tests use.
- **`apps/desktop/e2e` and `playwright.e2e.config.ts`.** Gone with the six specs.
- **`.github/workflows/build-dmg.yml`.** Gone. `build-tauri.yml` is `build-desktop.yml` and runs
  `pnpm --filter @acorn/desktop run dist`.
- **`plugins/terminal/src/main/folderPickerIpc.ts`.** Gone, along with `plugins/preview/src/main/`,
  which the list expected to go in phase 3 and which survived only because Electron still called it.
- **Arch tests.** The Electron-consumer baseline is a flat ban: no import, no `createRequire`, and no
  manifest entry. The Tauri rule points at `apps/desktop/src/shell/`, and the separate
  "the desktop helper stays Electron-free" rule went, because the flat ban covers it.
  `better-sqlite3` and `sharp` left `pnpm-workspace.yaml`.
- **`docs/electron.md`.** Replaced by [docs/shell.md](../../shell.md), which describes the shell that
  ships. Every reference in code and docs points at it, and it kept the section names those
  references cite.

Three things beyond the list, all of them the same "nothing half-dead lingers" rule:

- **The phase-3 waiver is closed by deletion.** `desktop.preview-*`, `DesktopCapabilities`,
  `desktopCapabilitiesOverRpc`, and the `desktopCapabilities` injection point on `ServiceHost` are
  gone. Nothing in the node ever called them, and with no shell registering them the seam was a
  protocol surface with neither end attached. `serviceRpcMethods` is three names.
- **`electronPath` is `hostRuntimePath`,** on the service-start config and through `launcherSpec`,
  and `ELECTRON_RUN_AS_NODE` left the MCP launcher env and the service spawn. It was inert under a
  real Node, which is exactly what makes a stale name cheap to keep and expensive to trust.
- **The comment sweep.** Around 60 comments described Electron in the present tense or pointed at a
  file that no longer exists. The ones stating history keep it; the ones stating a falsehood about
  today were rewritten.

## Cutover trigger

All four, not any:

1. The phase-3 parity list has no open waivers. Closed by deleting `desktop.preview-*`.
2. The packaged DMG passes the smoke checklist in [testing.md](./testing.md) on a machine that never
   had the Electron build. **Owed to a person.** No script closes this one.
3. Developers have run the Tauri shell as their default for an agreed soak window. **Owed.**
4. No invariant in the [README](./README.md) is regressed.

Signing does not gate cutover: the build is ad-hoc signed with no updater, so ad-hoc parity is parity.

Items 2 and 3 are the honest state of this migration. The code cut over ahead of them, and the
Electron artifact no longer exists to fall back to, so the smoke checklist is a release gate now
rather than a cutover gate.

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
