# Testing

Status: proposal, 2026-08-22; the seam contract suite landed in phase 1 and the boot test in phase 2, both 2026-08-23.

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
poisoning, and it runs in CI from phase 2 on.

It came out as two halves rather than one headless shell run, because a Tauri app needs a display
server and a test that needs one does not run in CI.

`apps/desktop-tauri/test/boot.test.ts` covers everything below the window. It runs the staged helper
under the bundled Node against a fresh data root, which spawns the real `service.js` over the fd-3
service protocol, and then asks the helper the first two questions the renderer asks: which nodes are
there, and can a `/v2` request reach one. A 200 from `/v2/node` means the pinned TLS connection came
up and the device token authenticated, so one assertion covers the custody stack end to end. Two more
check the gate: a socket without the secret is refused, and a plain HTTP request gets 426. The whole
thing takes about three seconds.

The eleven Rust unit tests in `apps/desktop-tauri/src-tauri/src/` cover what is left: the CSP the
scheme handler sends and the dev-only widening it must not send in a packaged build, the traversal
guard, the highlighter worker's separate policy, the refusal to answer a node route with the shell's
own HTML, the handshake's field names, the ready-line parser, and the data key's shape and file
fallback. Between the two halves, nothing in the boot path is unexercised.

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
4. Open a preview pane against a task dev server through the tunnel.
5. Open a loaded plugin pane; it renders, and a network call from its frame fails.
6. Trigger the quit flow with an active agent; the concern prompt appears; quit drains cleanly.
7. Kill the node process five times; the recovery screen appears on the sixth.

## Exit criteria

The boot test is green in CI for the Tauri shell, and the checklist has passed once against a
packaged build.
