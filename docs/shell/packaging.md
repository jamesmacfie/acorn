# Build and packaging

This page covers how the desktop bundle is built and checked, the Windows installer, CI permissions,
Rust dependency findings, and the signing gates. Read it before you change staging, the release
workflow, or signing. It's part of [desktop shell](../shell.md).

## Build and packaging

`apps/node` emits `service.js`, `mcp.js`, `standalone.js`, and shared chunks. Third-party packages are
bundled into them, and into the helper, except the native addons and run-time packages
`apps/node/externals.ts` lists. Staging copies those packages' installed graphs under
`dist/helper/node_modules` without pnpm links, so the installed helper and service resolve them from
app resources. Shared dependencies are hoisted to keep NSIS paths under Windows' legacy limit.
`scripts/nodeRuntimePackages.ts` owns the shared runtime package list.
The stage script resolves one supported target triple before copying packages. For `node-pty` 1.1.0,
`apps/desktop/scripts/native-package-files.mjs` keeps the selected `prebuilds/<platform>-<arch>`
directory and omits the other reviewed prebuild directories. It checks the selected addon, Unix
`spawn-helper`, and Windows ConPTY and winpty assets before copying. Licenses and executable modes
remain in the package. Other package graphs retain their installed files and dependency edges.
Linux has no prebuild in the installed 1.1.0 package, so Linux staging requires a local Linux build
with `build/Release/pty.node` and `spawn-helper`. A cross-target stage with an unqualified local addon
fails because node-pty's loader would choose it before a target prebuild. A node-pty version or layout
change requires review of the policy and its target fixtures.
`apps/node/scripts/check-service-budget.mjs` runs after the Node build and fails it when `service.js`
and its static imports pass a byte ceiling. Both builds write the license text of every bundled
package beside their output, as `THIRD-PARTY-NOTICES.txt` and `helper-THIRD-PARTY-NOTICES.txt`.

Run `pnpm --filter @acorn/node measure:service-graph` to find what contributes to the boot graph.
It builds into a temporary directory, reports rendered module bytes by npm package and workspace
folder, and lists the 50 largest modules. Add `--why smol-toml`, or another path fragment, to print
the shortest static import chain from the service entry. Dynamic imports stay outside the module
total. The chunk total includes import lines and generated glue, so it matches the budget check.

The helper's production bundle enables Oxc minification in `apps/desktop/vite.helper.config.ts`. On
October 2, 2026, it measured 269,402 B.

`apps/desktop/scripts/stage.mjs` places the service, every core and plugin migration chain, the
plugin frame stylesheet, and the pinned Node runtime for the bundler. It fetches the runtime from
nodejs.org and verifies it against that release's `SHASUMS256.txt`, and `node-runtime.json` is the one
pin both this and `scripts/pack-node.mjs` read. Staging also copies the headless CLI bundle into
`Resources/cli`. **Settings → Command line** asks the shell to write a launcher into a writable
directory on the login shell's `PATH` (`cli_install.rs`). The launcher points at that build's Node and
CLI, and the renderer can't choose a path or command.

`pnpm --filter @acorn/desktop run build` stages and builds the renderer, then checks the startup budget
([startup budget](../frontend/startup-budget.md)) and the bundles' syntax.
`pnpm --filter @acorn/desktop dist` adds the bundler pass and the inventory check. The package builds
the renderer, not `beforeBuildCommand`, so the budget checks the bytes that ship.

The bundled-plugin build stages plugin packages under `dist/bundled-plugins`, which the bundler copies
to app resources, and the helper passes that read-only directory to the service. Bundled client
bundles are hashed and trusted from that local directory, never from a Node's claim, so a development
boot doesn't ask one question per bundled package ([plugins](../plugins.md) § The dev loop). Staging
detects missing artifacts, not stale ones, and `package.json` holds the build order.

`apps/desktop/scripts/verify-bundle.mjs` runs last. It compares every staged file against the same
path inside the `.app` by digest, and checks the code signature, the bundled runtime's version, the
updater artifact and its signature, and the DMG. The packaged runtime is checked by its reported
version, because signing rewrites every Mach-O file.

`bundle.macOS.signingIdentity` is `"-"`, because without an identity Tauri runs no `codesign` pass and
`codesign --verify` rejects the result. `createUpdaterArtifacts` is on and the updater public key is
built in, so every release is signed and turning updates on later is configuration. No updater plugin
is compiled in and no endpoint is set. A Rust test fails if any of the three goes missing.

`node-pty` is the one native module, and it must match the ABI of the pinned Node that loads it, in a
checkout and in a bundle. `scripts/rebuild-node-abi.mjs` builds it. SQLite is `node:sqlite`. The
standalone Node ships separately as a tarball ([standalone Node distribution](../node-distribution.md)).

`.github/workflows/build-desktop.yml` builds macOS Apple silicon and Windows x64 for a `v*` tag or a
manual dispatch of `.github/workflows/ci.yml`, after that workflow's Linux job passes for the same
commit. Pushes to main run the unsigned desktop tests and build no installer. Both jobs build the
bundle inputs once, run the boot test and the Rust suite against them before the bundler, and package
the same output. Artifacts are kept for one day. Publishing is refused while builds are ad-hoc signed.

### Windows test installer

The Windows job uploads `acorn-windows-x64`, an NSIS setup executable and its updater signature, and
the macOS job uploads `acorn-dmg`. Both belong to the Actions run, and nothing publishes a GitHub
release. Windows Authenticode signing isn't configured.

`apps/desktop/src-tauri/tauri.windows.conf.json` selects NSIS, a Windows icon, per-user install, and the
WebView2 bootstrapper, which downloads WebView2 if it's missing. Staging fetches the pinned Windows
`node.exe` and checks its SHA-256. The runtime installs beside `acorn-desktop.exe`, and the helper,
service, CLI, plugins, and renderer install under the same directory. The helper's origin gate expects
`http://app.localhost` on Windows.

The target needs Git on `PATH`. The service makes the local Node's TLS certificate in process, so no
OpenSSL is needed, and the target needs no Node, pnpm, Rust, or compiler.

Windows distribution verification installs the setup executable into a temporary directory, compares
the installed resources with staging, checks the Node version and digest, and runs the helper boot test
against the install with host executables removed from `PATH`. It checks an authenticated broker
request and the WebSocket secret and origin gates, then uninstalls. Run it on a disposable build host,
because NSIS also writes shortcuts and uninstall data. It doesn't drive the WebView2 window or test
connections between machines.

## CI permissions and signing credentials

Both workflows grant the repository token only `contents: read`, and checkout doesn't persist
credentials. Pull requests and pushes to main run the unsigned suites in `.github/workflows/ci.yml`.
The bundle workflow runs only when `ci.yml` calls it.

The bundle job passes `TAURI_SIGNING_PRIVATE_KEY` only to its required-key check and the distribution
step, and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` only to distribution. The distribution command runs
repository build commands before signing, so those commands share the signing environment and must be
trusted.

Action references use full commit hashes with version comments. To update one, check the release
commit upstream, review the change, and update the hash and comment together. The Rust toolchain
action sets `toolchain: stable` explicitly, because pinning the action doesn't pin the compiler
([GitHub's secure use reference](https://docs.github.com/en/actions/reference/security/secure-use)).

## Rust dependency security

`apps/desktop/src-tauri/Cargo.lock` pins the Rust graph. rustls through `ureq` is 0.23.45, which fixes
[RUSTSEC-2026-0285](https://rustsec.org/advisories/RUSTSEC-2026-0285.html). acorn calls `ureq` in
`app_scheme.rs` and `dev_server.rs`, both against the `ACORN_DEV_SERVER` origin, which only the
development launchers set. The helper owns Node HTTPS connections, separately from this client.

The RustSec review on October 1, 2026, reported no vulnerabilities and seven informational warnings:

- [RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html), an unsound string-array
  iterator in glib 0.18.5, through the Linux GTK 0.18 stack only. acorn and the 26 reverse-dependency
  roots reviewed don't call `VariantStrIter` or `array_iter_str`, which isn't proof it can't run. The
  fix needs glib 0.20, outside GTK 0.18's constraint, so it waits on a GTK and Tauri migration.
- `proc-macro-error` 1.0.4, unmaintained, through the Linux GTK and glib build macros.
- Five unmaintained UNIC 0.9 crates through `urlpattern` 0.3 and `tauri-utils` 2.9.3. A
  [`tauri-utils` 2.10 migration](https://github.com/tauri-apps/tauri/releases/tag/tauri-utils-v2.10.0)
  replaces them but needs Rust 1.90, above the desktop manifest's 1.82.

Keep these visible in dependency audits until their upstream paths change.

## Signing gates and the updater

Release maturity is three gates, and only the first is met:

1. **Ad-hoc.** Where the app ships. `codesign --verify` passes on the `.app` and the DMG copy, and
   `spctl` rejects both, so installing needs Gatekeeper's right-click **Open**.
2. **Developer ID.** One purchase unblocks notarized desktop builds, the macOS half of the Node
   tarball matrix ([future/bundle.md](../future/bundle.md)), and any updater. Sign and notarize in the
   same `tauri build` pass. It also stops keychain re-prompts
   ([keys and custody](./process.md#keys-and-custody)).
3. **Updater on.** Needs gate 2 plus a hosting choice, R2 or GitHub Releases. Only the manifest URL
   differs.

When gate 3 arrives, use `tauri-plugin-updater` for the manifest check only, and own the download and
install: the plugin buffers whole downloads in memory, can't abort or resume, and its
`Update::install` verifies no signature. Stream the download with resume, allow one at a time, and
verify SHA-256 and minisign against the built-in public key before install.

The updater private key was generated on August 23, 2026, with no passphrase, on one machine. It
belongs in a password manager and in the `TAURI_SIGNING_PRIVATE_KEY` repository secret. Losing it means
installs with the built-in public key can never update, and the only fix is a new key pair and a
manual reinstall. The workflow refuses to start without the secret.

Two release gates belong to a person: [the smoke checklist](../testing/smoke-checklist.md), run against
the DMG on a clean machine, and a developer soak period. Nothing ships until both pass.
