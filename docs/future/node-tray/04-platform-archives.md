# Phase 4: build platform archives in GitHub Actions

Date: October 18, 2026. Status: proposed. Its smoke test grows as [phase 1](./01-token-out-of-logs.md)
and [phase 2](./02-terminal-pairing.md) land.

## Goal

A GitHub Actions run produces a self-contained archive for each of five platforms: macOS arm64,
macOS x64, Linux x64, Linux arm64, and Windows x64. Each archive holds the pinned Node.js runtime and
every installed dependency. The run extracts each one on a runner of its platform, outside the
workspace, and starts a Node from it before it uploads the archive with its checksum.

## Starting point

- `scripts/pack-node.mjs` stages `dist/`, `bin/acorn.mjs`, `scripts/prune-runtime.mjs`,
  `migrations/`, `plugins/`, a generated `package.json`, and a `package-lock.json` resolved at pack
  time. It writes one platform-neutral `acorn-node-<version>.tar.gz` with no `node_modules` and no
  runtime. `apps/node/Dockerfile` installs that tarball, so it stays as it is.
- `node-runtime.json` pins Node.js 24.21.0. `stageNodeRuntime` in
  `apps/desktop/scripts/node-runtime.mjs` downloads a runtime from nodejs.org, checks it against that
  release's `SHASUMS256.txt`, caches it under `~/.cache/acorn/node-runtime`, and writes the binary
  under the name Tauri expects.
- `node-pty` is the only native module. Its package carries prebuilt binaries for macOS and Windows.
  On Linux it compiles from source, which needs Python, `make`, and a C++ compiler. It uses N-API,
  so one build loads under any Node.js release in the supported range.
- `node-pty` 1.1.0 publishes `prebuilds/<platform>-<arch>/spawn-helper` as mode `644`, and spawning a
  terminal fails with `posix_spawnp failed` until it's `755`. `scripts/rebuild-node-abi.mjs` fixes the
  mode for the checkout.
- `scripts/prune-runtime.mjs` removes installed files no runtime loads, and refuses package versions
  it hasn't reviewed.
- `.github/workflows/build-desktop.yml` is the pattern to copy: called from `.github/workflows/ci.yml`
  after the lint and test jobs, on `v*` tags and manual dispatches, with actions pinned by commit
  hash and `persist-credentials: false`.

## Design

### The archive

```text
acorn-node-0.0.3-linux-x64/
  bin/acorn          POSIX launcher
  bin/acorn.cmd      Windows launcher
  runtime/node       the pinned Node.js binary (node.exe on Windows), with its LICENSE
  lib/               the pack-node tree, with node_modules installed and pruned
  install.sh         phase 5 (install.ps1 on Windows)
  README.md
  BUILD              version, commit, build stamp, and platform
```

macOS and Linux archives are `.tar.gz`, because `tar` keeps the executable bits. GitHub wraps every
uploaded artifact in a zip, and a zip from that upload loses file modes, so the inner tarball is what
keeps `bin/acorn` and `spawn-helper` runnable. Windows archives are `.zip`.

`bin/acorn` runs `runtime/node --disable-warning=ExperimentalWarning lib/bin/acorn.mjs` with the
arguments it was given, the same flag the tarball's `npm start` passes. `bin/acorn.cmd` does the
same on Windows. Both resolve their own folder, so they work from any directory. Phase 5 adds the
default data root. Before that, `bin/acorn` with no `ACORN_DATA_DIR` exits with a message that names
the variable and the installer, instead of the workspace lookup's error.

The launcher sources live in `scripts/node-archive/` (new), as `acorn`, `acorn.cmd` (new), and the
phase 5 installers.

### Building it

`pnpm pack:node --platform <os>-<arch>` builds the neutral tree as it does today, then, in a staging
folder:

1. Runs `npm ci --omit=dev` in `lib/` with the runner's Node.js 24. `node-pty` takes its prebuild on
   macOS and Windows and compiles on Linux.
2. Runs `node scripts/prune-runtime.mjs` in `lib/`.
3. Sets `spawn-helper` to `755` on macOS and Linux.
4. Downloads the target runtime with `stageNodeRuntime`'s download and checksum code, and copies the
   binary and its license into `runtime/`.
5. Copies the launchers, writes `BUILD`, and writes the archive and `<archive>.sha256`.

The runner's Node.js only installs packages. The archive runs on the pinned runtime from
nodejs.org, which `node-runtime.json` names.

Linux jobs run steps 1 to 3 inside a `node:24-bullseye` container. Its glibc is 2.31, so the compiled
`pty.node` loads on Ubuntu 22.04, Debian 11, Raspberry Pi OS 11, and later releases. A build on the
`ubuntu-24.04` runner's own system would need glibc 2.39. The pinned runtime from nodejs.org needs
glibc 2.28, so the container sets the floor.

### The workflow

`.github/workflows/build-node.yml` (new) takes `workflow_call`, as the desktop workflow does.
`.github/workflows/ci.yml` gains a `package-node` job with `needs: [lint, test]` and the same `if` as
`package`. It needs no secrets.

| Platform | Runner | Notes |
| --- | --- | --- |
| `darwin-arm64` | `macos-latest` | |
| `darwin-x64` | An Intel macOS runner, or `macos-latest` | Without an Intel runner, assemble on arm64 with the x64 prebuild and runtime, and smoke-test under Rosetta 2 |
| `linux-x64` | `ubuntu-24.04` | `node:24-bullseye` container |
| `linux-arm64` | `ubuntu-24.04-arm` | `node:24-bullseye` container |
| `win32-x64` | `windows-latest` | |

Each job uploads `acorn-node-<platform>` with the archive and its `.sha256`, kept for 14 days
(decision 7 in the [programme page](./README.md#decisions)). It reuses the desktop workflow's runtime
cache key, so a runner downloads each pin once.

### The smoke test

After the build, the same job extracts the archive into a temporary folder outside the checkout.
It points `HOME`, `APPDATA`, `LOCALAPPDATA`, `XDG_CONFIG_HOME`, and `XDG_DATA_HOME` at temporary
folders, so nothing reads the runner's own state. Then it runs:

1. `bin/acorn --help`, which must exit 0.
2. `runtime/node` loading `node-pty` from `lib/node_modules` and spawning `echo ok` in a terminal.
   This catches a missing native build and the `spawn-helper` mode.
3. `ACORN_DATA_DIR=<tmp>/data bin/acorn node start --background --output json`, then
   `node status`, which must report `running` and healthy.
4. After phase 2, `bin/acorn node pair --output json`, which must return a code.
5. `bin/acorn node stop`, which must report `stopped` within 40 seconds.
6. A search of the Node's log for `acorn_dt_`, which must find nothing after phase 1.

## Steps

1. Add `--platform` to `scripts/pack-node.mjs`, with the five steps above.
2. Reuse the runtime download from `apps/desktop/scripts/node-runtime.mjs`. If the architecture
   checks refuse an import across apps, move the download and checksum functions to `scripts/` and
   have both callers import them there.
3. Write the launchers and the archive README. The README covers checking the checksum, extracting,
   running `install.sh` or `install.ps1`, and the quarantine note below.
4. Write `build-node.yml` and the `package-node` job, then run it with a manual dispatch.
5. Raise the repository's artifact retention cap to 14 days.
6. Add an Archives section to [Node distribution](../../node-distribution.md) with the layout, the
   platforms, and the glibc floor.

## Acceptance

- A manual dispatch on `main` produces five artifacts, and each platform's smoke test passes.
- On a clean machine for each platform, with no Node.js or compiler installed, an archive fetched
  with `gh run download` extracts, starts a Node with `bin/acorn node start --background`, and stops
  it.
- Each archive's `.sha256` matches the file a person downloads.
- The phase records each archive's size, compressed and extracted, in its completion note.

## Risks

- A browser download on macOS adds the quarantine attribute, and Gatekeeper can refuse to load the
  unsigned `pty.node` or run `spawn-helper`. `gh run download` and `curl` add no quarantine. The
  README gives `xattr -dr com.apple.quarantine <folder>` for a browser download, and phase 5's
  installer runs it on the folder it installs. Signing removes the need
  ([signing](../bundle.md#sign-macos-artifacts)).
- Windows marks files from a downloaded zip as coming from the internet. The installer runs
  `Unblock-File` on the folder it installs.
- A glibc older than 2.31 fails at `node-pty` load with a clear version error. The README names the
  floor.
- Artifacts expire. After 14 days, a person needs a fresh run until publishing is turned on.

## Verify before building

- Check which Intel macOS runner label GitHub offers, and whether Rosetta 2 is on the arm64 image.
- Check whether the pinned `actions/upload-artifact` can upload a single file without the zip wrapper,
  and keep the inner tarball either way.
- Confirm that `node-pty`'s package carries both `darwin-x64` and `darwin-arm64` prebuilds, and a
  `win32-x64` one, at the pinned version.
- Run `node scripts/prune-runtime.mjs` against an `npm ci --omit=dev` tree on each platform, because
  its reviewed versions can differ by platform.
