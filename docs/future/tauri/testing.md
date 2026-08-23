# Testing

Status: proposal, 2026-08-22; the seam contract suite landed in phase 1, the boot test in phase 2, the phase-3 unit tests below, and CI to run them in phase 4, all 2026-08-23.

## The problem

The six Playwright specs in `apps/desktop/e2e` drive `_electron.launch`, which has no Tauri
equivalent worth building, and that harness is being extracted out of core regardless. Meanwhile
the migration adds a second implementation of every seam, which is exactly where parity bugs live.

## Not ported: the Playwright specs

They keep running as long as Electron ships — they gate Electron, not Tauri. Their coverage is
decomposed rather than ported: enumerate what each spec actually asserts, then reassign each
assertion to an existing plain-Node suite, a new boot test, or the smoke checklist below.

Rejected: tauri-driver and WebDriverIO. A different harness with worse WKWebView fidelity than
what it replaces, and the spend contradicts the extraction decision.

## Seam contract tests

**Landed.** The platform seam has a contract suite that runs against a mock and against each host
implementation's units where they run headless. `packages/client-core/src/platform/contract.ts` holds
the checker — a function returning a list of problems, not `expect` calls, so `src/` imports no test
framework — plus the compile-time-exhaustive member list per capability group.
`platform/contract.test.ts` drives it against a mock host; `apps/desktop/src/app/main/preload.test.ts`
drives it against the real preload under a stub Electron; and
`apps/desktop-tauri/src/client/bridge.test.ts` drives it against the real bridge under stub Tauri
bindings. The Tauri shell passes a shorter list — eight groups, without `preview` and `webviews` — and
a group that resolves anyway is a failure: half a group is worse than none, because consumers probe
the group and then call its members. The list is written out rather than derived, so adding a group to
the bridge without adding it there fails instead of silently widening what the shell claims.

`tools/arch/boundaries.test.ts` gained the mirror of the Electron rule in phase 2: nothing outside
`apps/desktop-tauri` may name a Tauri binding. The enumerated Electron-consumer baseline becomes a
shrinking one that reaches zero at cutover; its first step landed in phase 1 and now reads as
"nothing in `packages/desktop-helper` may import Electron".

## The boot test

The `mainBarrelLoad` analogue, and the single highest-value test in this series. It catches "the shell
cannot load its world" the way `apps/node/test/integration/mainBarrelLoad.test.ts` catches barrel
poisoning. Phase 4's `.github/workflows/build-tauri.yml` is what runs it in CI, before the bundler pass
so a broken boot path fails in seconds rather than minutes. Nothing in this repo ran tests in CI before
that workflow.

It came out as two halves rather than one headless shell run, because a Tauri app needs a display
server and a test that needs one does not run in CI.

`apps/desktop-tauri/test/boot.test.ts` covers everything below the window. It runs the staged helper
under the bundled Node against a fresh data root, which spawns the real `service.js` over the fd-3
service protocol, and then asks the helper the first two questions the renderer asks: which nodes are
there, and can a `/v2` request reach one. A 200 from `/v2/node` means the pinned TLS connection came
up and the device token authenticated, so one assertion covers the custody stack end to end. Two more
check the gate: a socket without the secret is refused, and a plain HTTP request gets 426. The whole
thing takes about three seconds.

The Rust unit tests in `apps/desktop-tauri/src-tauri/src/` cover what is left, twenty-four of them
after phase 4: the CSP the scheme handler sends and the dev-only widening it must not send in a
packaged build, the traversal guard, the highlighter worker's separate policy, the refusal to answer a
node route with the shell's own HTML, the handshake's field names, the ready-line parser including the
tunnel signals, the data key's shape and file fallback, the plugin scheme's hash grammar and frame CSP,
the two URL policies, the key grammar that picks between them, the navigation-history bookkeeping,
the capability file's webview scoping, and the three packaging properties that only surface when
somebody installs the artifact — the ad-hoc signing identity, `createUpdaterArtifacts`, and the updater
public key. Between the two halves, nothing in the boot path is unexercised.

What no headless run reaches is compositing: a child webview positioned over a window needs a window.
That is what items 4 and 5 of the smoke checklist are for.

## The browser smoke test

`plugins/browser/src/server/driver.smoke.test.ts` runs an agent's loop against a real Chrome — load a
loopback page, snapshot it, fill a field by its ref, click a button by its ref, and read back the
console line the page logged with the value it saw. Opt-in through
`pnpm --filter @acorn/plugin-browser test:smoke`, because launching a browser is not something every
`pnpm test` should pay for. On a machine with no Chrome it takes the other branch and asserts the tools
reported why, which is the second half of what phase 3 promised.

## Parity tests

- `apps/node/test/integration/standaloneParity.test.ts` stays green under the new spawn: the
  helper-supervised and standalone nodes build identical plugin graphs.
- A helper-protocol round-trip test exercises `helperServer.ts` against the same Zod schemas the
  Electron IPC handlers validate, while both hosts exist.

## The smoke checklist

Deliberately manual — the automation it replaces is leaving the repo. Versioned here; executed per
release during coexistence and at cutover, on a machine that never had the Electron build:

1. Install and launch; the window appears and the local node reaches online.
2. Pair a second node by code; fingerprint words match.
3. Open a terminal; a TUI renders and survives resize.
4. Open a preview pane against a task dev server through the tunnel. Navigate, go back, and cover it
   with an overlay; the child webview hides rather than floating above it.
5. Open a loaded plugin pane; it renders, and a network call from its frame fails.
6. Open a loaded plugin's webview surface; a link to a host its manifest does not name is refused.
7. Trigger the quit flow with an active agent; the concern prompt appears; quit drains cleanly.
8. Kill the node process five times; the recovery screen appears on the sixth.

## The bundle inventory check

`apps/desktop-tauri/scripts/verify-bundle.mjs`, the last step of the build. It is the packaging
analogue of the boot test: the boot test proves the shell can load its world in a checkout, and this
proves the world is actually inside the artifact. It compares every file staging produced against the
same path in the `.app`, by digest, and checks the code signature, the bundled runtime, the updater
artifact and its signature, and the DMG. Its first run found a bug nothing else could have: the shell
resolved the bundled Node under `Contents/Resources` and `externalBin` stages it into `Contents/MacOS`,
a path that exists only in a packaged build.

## Exit criteria

The boot test is green in CI for the Tauri shell, and the checklist has passed once against a
packaged build. The first is met by `.github/workflows/build-tauri.yml`. The second is open, and it is
the last thing between here and the cutover trigger.
