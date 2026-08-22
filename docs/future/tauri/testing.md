# Testing

Status: proposal, 2026-08-22.

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

The platform seam gets a contract suite that runs against a mock and against each host
implementation's units where they run headless. `tools/arch/boundaries.test.ts` gains the Tauri
package rules — nothing outside the new shell package imports Tauri bindings — and the enumerated
Electron-consumer baseline becomes a shrinking one that reaches zero at cutover.

## The boot test

The `mainBarrelLoad` analogue, and the single highest-value test in this series: a debug-build
shell flag (or Rust integration test) boots the shell headless, spawns the helper and node, waits
for the adopted handshake, asserts the renderer origin serves `index.html` with the expected CSP
header, and exits 0. It catches "the shell cannot load its world" the way
`apps/node/test/integration/mainBarrelLoad.test.ts` catches barrel poisoning. It runs in CI from
phase 2 on.

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
