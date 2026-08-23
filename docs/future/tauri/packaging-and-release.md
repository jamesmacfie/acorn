# Packaging and release

Status: proposal, 2026-08-22; phase 4 built it, 2026-08-23.

## The problem

electron-vite stages the node artifact and every migration chain into `apps/desktop/out/`;
electron-builder copies bundled plugins into resources and produces an ad-hoc-signed, macOS-only
DMG/ZIP with no updater; CI (`.github/workflows/build-dmg.yml`) uploads the DMG on pushes to main.
All of that is replaced, and the staging electron-vite did implicitly must become explicit.

## Design

**Staging script.** The staging logic extracted from `electron.vite.config.ts` (`stageMigrations`,
`stageNodeArtifact`) plus `scripts/build-bundled-plugins.mjs` output becomes one explicit script
that assembles `src-tauri`-declared resources: `apps/node/dist`, migrations, bundled plugins, the
host-owned `ui.css`, and the pinned Node binary from [node-runtime.md](./node-runtime.md). It
detects missing artifacts, not stale ones, the same rule as today. `check-renderer-budget.mjs` and
`check-runtime-syntax.mjs` survive unchanged.

**Bundle config.** macOS `app` and `dmg` targets first, matching today's macOS-only stance.
`createUpdaterArtifacts: true` from the first release even with no updater endpoint configured, so
enabling updates later is configuration, not a re-release.

**CI.** A new workflow alongside `build-dmg.yml`, replacing it at cutover: pnpm build steps, Rust
toolchain with cargo cache, staging, `tauri build`, then a binary-inventory verification step
before upload — assert the bundled Node binary, node dist, migrations, and bundled plugins are
present with matching checksums, the pattern in
`references/proliferate/.github/workflows/release-desktop.yml`. A tag-triggered release job adds
GitHub Release creation and updater-manifest generation, gated off until signing exists.

## What landed

Built 2026-08-23. `pnpm --filter @acorn/desktop-tauri run build` stages, builds the renderer, runs both
budget checks, bundles, and then verifies the bundle it produced. `.github/workflows/build-tauri.yml`
runs the same thing on a push to main, alongside `build-dmg.yml` rather than instead of it.

- **The runtime is fetched, not copied.** `scripts/nodeRuntime.mjs` downloads the pinned build from
  nodejs.org, verifies it against that release's `SHASUMS256.txt`, and caches the extracted binary
  under `~/.cache/acorn/node-runtime` with its own digest beside it, so a second stage re-verifies
  without the network. Phase 2's script copied whichever Node was running it and refused when that was
  not the pin. There is one path now and it is the release path: every machine and every CI run bundles
  the same verified bytes, and a developer no longer has to switch runtimes to stage a build. The cost
  is one 50 MB download per pin per machine.
- **`scripts/verify-bundle.mjs` compares the bundle against what staging produced,** file by file, by
  digest, for the renderer, the bridge, the helper and node service, and the bundled plugins. The
  expected inventory is whatever staging wrote rather than a list somebody maintains, so a resource
  added later is covered the day it is added. Named files on top of that stop an empty `dist/` from
  passing by comparing nothing, and the run also checks the code signature, the updater artifact and
  its signature, and the DMG. The bundled runtime is the exception: signing rewrites every Mach-O in
  the bundle, so it is checked by the version it reports and its own signature, and its provenance
  comes from the checksum staging already verified.
- **The updater keypair exists.** The public half is in `tauri.conf.json`. The private half was
  generated on 2026-08-23 with `tauri signer generate`, has no passphrase, and sits at
  `~/.acorn/tauri-updater/acorn-updater.key` on the machine that made it. That is not durable storage:
  it belongs in a password manager and in the `TAURI_SIGNING_PRIVATE_KEY` repo secret, and losing it
  means every install carrying this public key can never be updated, because the only fix is a new
  keypair and a manual reinstall. The workflow refuses to start without the secret, because
  `createUpdaterArtifacts` with no key produces nothing signed and an unsigned updater payload is worse
  than none.

Four things came out differently from the design:

- **The `.app` was not signed at all.** With no `signingIdentity`, Tauri runs no `codesign` pass, so
  the bundle carried only the linker's own ad-hoc mark on one binary and sealed no resources —
  `codesign --verify` rejects that outright. Electron's `identity: null` does real ad-hoc bundle
  signing, so gate 0 needed `"signingIdentity": "-"` to be parity rather than something weaker. A Rust
  test reads the config back and fails if it, `createUpdaterArtifacts`, or the updater public key goes
  missing.
- **The shell was looking for the bundled Node in the wrong place.** `externalBin` stages the binary
  beside the executable, which on macOS is `Contents/MacOS`, and the shell resolved it under
  `resource_dir()`, which is `Contents/Resources`. Nothing before this phase could have caught it:
  the path only exists in a packaged build, and no packaged build had been made. The inventory check
  is what found it.
- **The DMG's Finder cosmetics do not run.** `bundle_dmg.sh` drives Finder over AppleScript to lay the
  window out, and that needs an Automation permission no build machine grants; the call times out and
  fails the bundle. Tauri already skips the step when `CI` is set, so the build script sets it for that
  one invocation and a local DMG comes out the same shape as the shipped one.
- **The workflow carries no GitHub OAuth secrets.** `build-dmg.yml` still bakes `MAIN_VITE_GITHUB_*`
  into the Electron main bundle, but nothing has read them since the GitHub-optional projects model
  landed. The client id is a node-side plugin read now, from the environment or the data root's `.env`.

## Signing gates, staged

The macOS constraint is recorded elsewhere and does not change with the shell: there is no Apple
Developer ID today, and the hosting decision for updates (R2 versus GitHub Releases) is open.

- **Gate 0 — ad-hoc.** Met. `bundle.macOS.signingIdentity` is `"-"`, the `identity: null` equivalent:
  `codesign --verify --deep --strict` passes on the built `.app` and on the DMG-mounted copy, and
  `spctl` rejects both, which is the same Gatekeeper friction the current DMG has. This is where the
  migration ships and cuts over.
- **Gate 1 — Developer ID.** One purchase unblocks three things at once: notarized desktop builds,
  the macOS half of [bundle.md](../bundle.md)'s tarball matrix, and any updater. Sign and
  notarize in the same `tauri build` pass so the `.app`, DMG, and updater payload are one
  notarized bundle, and assert the notarization count is exactly one (proliferate does both).
  Document the keychain-ACL win: signed builds stop re-prompting for the data key
  ([architecture.md](./architecture.md) § Keys and custody).
- **Gate 2 — updater on.** Needs gate 1 plus the hosting decision; the updater manifest URL is the
  only thing that differs between the two options.

Windows and Linux bundles are out of scope for v1. For the record, when [bundle.md](../bundle.md)'s
matrix lands: Linux needs nothing special; Windows needs Authenticode or users get the SmartScreen
click-through.

## The updater, when it comes

Use `tauri-plugin-updater` for the manifest check only. Own the download and install path, ported
from `references/proliferate/apps/desktop/src-tauri/src/updater_owned.rs`, whose header records
why: the plugin buffers whole downloads in memory, cannot abort or resume, and `Update::install`
performs no signature verification. The owned path streams to a staged file with resume, enforces
one live download, and verifies sha256 plus minisign against the baked pubkey before install.

Done, because it was cheap: the minisign keypair exists, `createUpdaterArtifacts` is on, and the
workflow's release job refuses to publish. A tag builds and keeps its artifacts on the run; the publish
step fails with the gate-1 reason rather than putting a Gatekeeper-blocked download and an
uninstallable updater payload behind a public link.

Rejected: the plugin end-to-end (unverified install path), building the owned updater before
signing exists (dead code against a blocked constraint).

## Exit criteria

CI produces an installable DMG whose inventory verification passes, and a machine that never had
the Electron build installs it and passes the smoke checklist in [testing.md](./testing.md).

The first half is met: the build produces `acorn_0.1.0_aarch64.dmg`, the inventory verification passes
against it, and the DMG mounts with a valid signature. The second half is a person on a second machine,
and it is the last thing standing between here and the cutover trigger.
