# Dev workflow

Status: proposal, 2026-08-22; the renderer config extraction landed 2026-08-23 (phase 1).

## The problem

Today `pnpm dev` in `apps/desktop` builds the service and bundled plugins, runs `electron-vite
build` over three targets (main ESM, preload CJS, renderer Solid), then launches the result —
there is no renderer HMR. Tauri has no main or preload JS targets: the renderer becomes a plain
Vite app and the shell is a cargo build.

## Design

**Extract the renderer Vite config. Landed.** The renderer target moved out of
`apps/desktop/electron.vite.config.ts` into `apps/desktop/vite.renderer.config.ts`, which exports
`rendererConfig(root)` — the app root is the only thing the two shells disagree about. The Electron
config imports it, so the two shells cannot drift. It lives in `apps/desktop` until the Tauri package
exists to own it; the import direction then reverses and nothing else changes. The worker rules travel with it verbatim,
comments included: worker format `es`, the `worker-` prefix on the highlighter entry that the CSP
filename match depends on, and Monaco's plain `[name]` pattern
([docs/electron.md](../../electron.md) § The syntax-highlighter worker's separate policy).

**Wire `tauri dev` the proliferate way** (`references/proliferate/apps/desktop/vite.config.ts` and
`tauri.conf.json`): `devUrl` at the Vite port, `beforeDevCommand` runs the Vite dev server,
`strictPort` with explicit port and HMR-port env overrides, `clearScreen: false`, and
`server.watch.ignored: ['**/src-tauri/**']` so Rust edits do not retrigger Vite.

**Overlay dev config.** A `tauri.dev.json` (proliferate's pattern) gives the dev shell a distinct
`identifier` and `productName`, so a dev build never collides with an installed build's data, and
empties any updater endpoints.

**The node in dev.** The Rust shell spawns the helper exactly as packaged, but pointed at
`apps/node/dist` and the checkout data root (`apps/node/.acorn`), the same contract `serviceHost`
has today. Service and bundled-plugin builds stay a prerequisite step ahead of `beforeDevCommand`,
mirroring the current `dev` script's ordering. Staging detects missing artifacts, not stale ones —
the same rule as today.

**Scripts during coexistence.** Root `pnpm dev` keeps launching Electron unchanged; `pnpm
dev:tauri` launches the new shell. Flipping the default is a phase 5 line item. The `.env` loading
order and the e2e data-dir override behavior are restated in the new shell: bundled dev file first,
then a user `.env` in the data directory.

One improvement worth naming: the renderer gains real HMR under `dev:tauri`, which
`electron-vite preview` never gave.

## Why not keep electron-vite for the renderer during coexistence

We do — until phase 2 needs the standalone config. The extraction is designed so the Electron
config imports the shared renderer config rather than forking it, which is why it lands in phase 1
while Electron still ships.

## Exit criteria

`pnpm dev:tauri` boots shell, helper, node, and an HMR renderer against the checkout data root
with no manual steps.
