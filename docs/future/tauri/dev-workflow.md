# Dev workflow

Status: historical. Proposed 2026-08-22, built in phase 2 and cut over in phase 5, both 2026-08-23.
[docs/local-development.md](../../local-development.md) owns the shipped loop.

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
([docs/shell.md](../../shell.md) § The syntax-highlighter worker's separate policy).

**Wire `tauri dev` the proliferate way** (`references/proliferate/apps/desktop/vite.config.ts` and
`tauri.conf.json`): `beforeDevCommand` runs the Vite dev server, `strictPort` on port 4319, `clearScreen:
false`, and `server.watch.ignored: ['**/src-tauri/**']` so Rust edits do not retrigger Vite.

One thing is not the proliferate way. `devUrl` is in the config only so `tauri dev` waits for Vite to
answer before launching; the window never loads it. The shell declares no windows in its config and
builds the window itself on `app://acorn`, and in dev the scheme handler proxies Vite. Loading
`devUrl` directly would put every developer on `http://localhost:4319` while the shipped app runs on a
custom scheme, and the origin is the one thing this migration cannot afford to leave unexercised:
phase 0's findings are all about how that origin behaves. The proxy costs about forty lines of Rust
and keeps HMR.

The dev origin pays for that with two extra CSP entries, and only in dev: Vite's HMR WebSocket in
`connect-src`, and `'unsafe-inline'` in `script-src` for the preamble its plugins inject. Both come
from one branch in `renderer_csp`, so a packaged build cannot pick them up by accident, and a Rust
test asserts it does not.

**Overlay dev config.** A `tauri.dev.json` (proliferate's pattern) gives the dev shell a distinct
`identifier` and `productName`, so a dev build never collides with an installed build's data, and
empties any updater endpoints.

**The node in dev.** The Rust shell spawns the helper exactly as packaged, but pointed at
`apps/desktop/dist/helper` and the checkout data root (`apps/node/.acorn`), the same contract
`serviceHost` has today. The shell's own custody root is `apps/node/.acorn/shell`, so a developer's
fleet and device tokens sit beside the node's data without mixing into it.

`pnpm run stage` is the prerequisite step, ahead of `beforeDevCommand`, mirroring the current `dev`
script's ordering: it builds the service, the bundled plugins, the helper bundle and the bridge, then
copies the service and every migration chain next to the helper and the pinned Node into
`src-tauri/binaries/`. It detects missing artifacts, not stale ones, the same rule as today.

**Secrets.** The helper loads `.env` files in the order Electron reads them, and the shell decides the
list because only it knows whether this is a bundle or a checkout. A dev build reads
`apps/desktop/.env`, where a developer's file already is, then the data directory's, which wins. That
path goes at cutover with the package it names.

**Scripts during coexistence.** Root `pnpm dev` launched Electron and `pnpm dev:tauri` launched the
new shell, until phase 5 deleted the first and `pnpm dev` became the only one. The `.env` loading
order carried over: bundled dev file first, then a user `.env` in the data directory.

One improvement worth naming: the renderer gained real HMR, which `electron-vite preview` never gave.

## Why not keep electron-vite for the renderer during coexistence

We did. Both shells imported `apps/desktop/vite.renderer.config.ts` rather than forking it, so the
client they built could not drift. Phase 5 folded that file back into `vite.config.ts`, since one
shell needs one config.

## Exit criteria

`pnpm dev` boots shell, helper, node, and an HMR renderer against the checkout data root with no
manual steps. **Met 2026-08-23.**
