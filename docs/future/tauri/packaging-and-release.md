# Packaging and release

Status: proposal, 2026-08-22.

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

## Signing gates, staged

The macOS constraint is recorded elsewhere and does not change with the shell: there is no Apple
Developer ID today, and the hosting decision for updates (R2 versus GitHub Releases) is open.

- **Gate 0 — ad-hoc.** Today's parity: `identity: null` equivalent, Gatekeeper friction identical
  to the current DMG. This is where the migration ships and cuts over.
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

Do now, because it is cheap: generate the minisign keypair, set `createUpdaterArtifacts`, and write
the release-workflow stance (refuse to publish ad-hoc-signed releases once gate 1 exists).

Rejected: the plugin end-to-end (unverified install path), building the owned updater before
signing exists (dead code against a blocked constraint).

## Exit criteria

CI produces an installable DMG whose inventory verification passes, and a machine that never had
the Electron build installs it and passes the smoke checklist in [testing.md](./testing.md).
