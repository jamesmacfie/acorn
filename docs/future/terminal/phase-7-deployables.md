# Phase 7: the two deployables

Status: not started. Waits on phase 4 and on `docs/future/bundle.md` steps 2 to 4 (the Docker

Read [findings.md](./findings.md) first: the bundled runtime is a precondition rather than a last step, and it is Node 26.4+ with a flag.
image, the Linux node-pty prebuild, the CI matrix for Linux and Windows).

## Goal

`acorn` inside the node tarball and inside the desktop app, per [08-deployables.md](./08-deployables.md).
The pack script grows the TUI entry, the native prebuild matrix gains OpenTUI's core, the runtime is
bundled, and `bundle.md` says what is true.

## Why this phase, and why now

Until here, `acorn` runs from a checkout. This phase is what makes it something a person installs.
It waits on phase 4 because shipping a pane without chrome is shipping a demo, and on `bundle.md`'s
own steps because the TUI rides inside the node artifact and inherits its pipeline.

## Scope

In:

- `scripts/pack-node.mjs`: a `dist/tui.js` entry, `bin/acorn`, OpenTUI's packages in the real
  dependencies, the runtime beside `dist/` once step 7 of `bundle.md` lands (moved up by this phase).
- `apps/tui/vite.config.ts` (new): the TUI build with `HOST = 'tui'` and OpenTUI's native package
  external.
- `scripts/rebuild-node-abi.mjs`: probe OpenTUI's core beside node-pty.
- The CI matrix: OpenTUI's core per triple; where upstream ships a prebuild, take it; where it does
  not (check Linux arm64 and Windows arm64), build it once with the same glibc decision node-pty took.
- The Tauri bundle: `acorn` as a resource beside `helper/`, sharing the runtime; a first-run offer to
  link it into `PATH`, off by default.
- The `curl | sh` installer links `bin/acorn`.
- The README in the tarball says `acorn` exists.

Out: the container image carrying the TUI (decided after this ships), macOS signing (the same gate as
everything else, `bundle.md § The snags`), auto-update.

## Design detail

**One build, two homes.** `dist/tui.js` is built once by `apps/tui`'s Vite config and staged into
both artifacts by the scripts that already stage `dist/helper/`: `apps/desktop/scripts/stage.mjs`
for the app, `scripts/pack-node.mjs` for the tarball. Neither script grows a second opinion about
the runtime; both read `node-runtime.json`.

**`bin/acorn`.** A shell script (and a `.cmd` on Windows) that resolves its own directory, finds the
runtime at `../runtime/bin/node` if bundled or `node` on `PATH` if not, and runs `../dist/tui.js`
with the arguments. Nothing else. `Node SEA` stays refused.

**The desktop's `acorn`.** Inside the app bundle at a path the app knows. On first run the app offers
to symlink it into `/usr/local/bin` or `~/.local/bin`, the way Visual Studio Code offers `code`. Off
by default; a setting turns it on; the sandboxed build never offers.

**Native modules, two now.** `bundle.md § Native dependencies` is rewritten: node-pty and OpenTUI's
core, both N-API or FFI, both prebuilt, both with the same Linux story. The probe script probes both
and exits early when both load.

## Code touched

- `scripts/pack-node.mjs`, `scripts/rebuild-node-abi.mjs`.
- `apps/tui/vite.config.ts` (new), `apps/tui/bin/acorn` (new), `apps/tui/bin/acorn.cmd` (new).
- `apps/desktop/scripts/stage.mjs`, `apps/desktop/src-tauri/tauri.conf.json`: the resource.
- `apps/desktop/src/`: the first-run link offer and its setting.
- `.github/workflows/`: the matrix.

## Tests

- The packed tarball, extracted on a clean runner: `bin/acorn --version` prints, `bin/acorn` with
  `ACORN_DATA_DIR` set starts a node and the boot test from phase 3 passes against it.
- `apps/desktop/src-tauri`'s packaging properties gain one: the `acorn` resource is present and
  executable.
- The probe script loads both native modules on every matrix runner.

## Docs owed

- `docs/future/bundle.md`: the rewritten sections in [08-deployables.md](./08-deployables.md) § What
  changes in `bundle.md`'s claims, and the reordered steps.
- `docs/node-distribution.md`: `bin/acorn` in the tarball's layout and the install steps.
- `docs/shell.md`: the `acorn` resource and the link offer.

## Doors left open

- The container image with `acorn` inside for `docker exec -it`.
- macOS signing when the Developer ID exists.
- Auto-update of the headless artifact, which is `bundle.md`'s question.

## Done when

A person on a Linux server downloads the tarball, runs the installer, types `acorn`, and is in the
workspace. A person with the desktop app turns on the link offer and `acorn` in their terminal opens
the app's node.

## Verify before building

- `scripts/pack-node.mjs` still generates `package.json` from real runtime dependencies.
- `node-runtime.json` is still the single pin and both scripts still read it.
- `apps/desktop/src-tauri/tauri.conf.json` still lists `binaries/node` as `externalBin`.
- `@opentui/core`'s platform packages at the pinned version: which triples upstream prebuilds.
