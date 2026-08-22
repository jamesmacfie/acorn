# Sequencing

Status: proposal, 2026-08-22; phases 0, 1 and 2 executed 2026-08-23. Coexistence, the phases, the cutover trigger, and the deletion list.

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
| 0 | De-risk spikes ✅ | M | yes (throwaway) |
| 1 | Groundwork that lands in Electron ✅ | M | yes (on trunk) |
| 2 | Rust shell skeleton + helper ✅ | L | yes (parallel app) |
| 3 | Feature parity | L | yes (parallel app) |
| 4 | Packaging and CI | M | yes (parallel artifact) |
| 5 | Cutover and deletion | M | — (the flip) |

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
  "apps never import each other" forced it: `apps/desktop-tauri` cannot reach into `apps/desktop`,
  so the code both shells run has to live in a package. Electron's `bootstrap.ts` imports it exactly
  as it imported the folder. The plugin request schemas came with it, as
  `main/pluginRequests.ts`, because both shells parse them and a schema that drifted would mean one
  host recording an acknowledgement the other cannot read.
- **`apps/desktop-tauri`.** `src-tauri/` (six Rust modules), `src/main/` (the helper process),
  `src/client/bridge.ts` (the renderer bridge), `src/shared/wire.ts` (the vocabulary between them),
  and the Vite configs. It consumes `apps/desktop`'s renderer source through
  `vite.renderer.config.ts`, the import direction phase 1 set up.
- **`node-runtime.json`.** The runtime pin, read by `apps/desktop-tauri/scripts/stage.mjs` and by
  `scripts/pack-node.mjs`. One pin, two consumers, as designed.
- **The boot test.** `apps/desktop-tauri/test/boot.test.ts` runs the staged helper under the bundled
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

- `apps/desktop/src/app/main/` (the 12 Electron files, `preload.ts`, and their tests). All of it:
  the custody stack left for `packages/desktop-helper` in phase 2, and both shells import it there.
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
