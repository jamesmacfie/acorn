> **Completion note, November 20, 2026.** Fixed on the Acorn side. The repository settings below still
> have to change before the key is protected.
>
> What landed:
>
> - No build holds the updater key. `ci.yml` no longer passes `TAURI_SIGNING_PRIVATE_KEY` or its password
>   to `build-desktop.yml`, which declares neither secret and lost its "Require the updater signing key"
>   step. A manual dispatch of a branch builds unsigned installers and payloads and stops there.
> - `createUpdaterArtifacts` is off in `tauri.conf.json`, because with it on, Tauri 2.12 refuses to build
>   without the private key. `apps/desktop/scripts/dist.mjs` makes the macOS payload, `acorn.app.tar.gz`,
>   itself with `tar`, in the same shape Tauri makes it: one top-level `acorn.app`, symlinks kept, no
>   AppleDouble files. On Windows and Linux the installer is the payload. `tauri.dev.json` lost its
>   duplicate `false`. The bundle verifiers check for the payload and no longer expect a `.sig`. The Rust
>   test is renamed `the_bundle_is_signed_and_its_updater_key_is_built_in` and asserts the setting stays off.
> - A new tag-only job, `sign-desktop` in `ci.yml`, runs in the `release` environment after `package`. It's
>   the only job that names the key. It checks out only `apps/desktop/package.json` and `tauri.conf.json`
>   and runs no repository code, because a job hands every secret it names to its runner, where any step
>   could read it. It downloads the desktop artifacts, signs each payload with
>   `npx @tauri-apps/cli@2.12.3 signer sign --app-version <version>` (install scripts off), then checks
>   each signature with `minisign` from apt against the public key in `tauri.conf.json`. A signature from
>   any other key fails the run. It uploads the signatures as `acorn-updater-signatures`.
> - The publish refusal moved from `build-desktop.yml` into `ci.yml` as `publish-desktop`, after
>   `sign-desktop`. It had to move: it always fails on a tag, so a signing job that needed the whole
>   reusable workflow would never have run.
> - `docs/shell/packaging.md` and `docs/shell/test-installers.md` describe the new flow.
>
> How it was checked:
>
> - `tools/arch/desktopSigning.test.mjs`, which runs in `pnpm test`, checks the following: neither
>   `build-desktop.yml` nor the `package` call names the key, only `sign-desktop` names it, that job is
>   tag-only and in the `release` environment, it checks out only the two JSON files and runs no `pnpm`,
>   `node`, or repository script, `publish-desktop` waits for it, and its CLI version equals the one in
>   `pnpm-lock.yaml`. Against the old `ci.yml`, all four tests fail.
> - The sign and verify steps, extracted from `ci.yml`, ran locally with bash 5 on a fake artifact tree
>   with a throwaway key. With that key's public half in `tauri.conf.json`, all four payloads were signed,
>   bound to version 0.0.8, and verified, and the DMG was left alone. With the app's real public key,
>   verification failed with a key id mismatch. An empty password signs without a prompt.
> - The `tar` step made a tarball with one top-level `acorn.app`, a kept symlink, and no `._` entries for a
>   file carrying an extended attribute.
> - The desktop Vitest and Rust suites passed after staging by hand. `pnpm run stage` stops at the known
>   Node service size ceiling, so the remaining stage steps ran on their own.
> - No real `tauri build` ran, and no workflow ran in GitHub Actions.
>
> Decisions and deviations:
>
> - The signing job lives in `ci.yml`, not in the reusable workflow. Environment secrets aren't reliably
>   visible to a called workflow, and a top-level job keeps the wiring easy to test.
> - The job signs payloads and uploads only the `.sig` files. Whoever publishes later pairs them with the
>   build artifacts by path.
> - Signing uses the Tauri CLI from npm at the exact locked version, with install scripts off. Its
>   transitive install isn't covered by a lockfile, only by exact versions.
>
> Still open, outside this repository's code:
>
> - Create the `release` environment, limit its deployment rule to `v*` tags, and consider required
>   reviewers. Move `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` into it, and delete
>   the repository-level copies. Until then, a branch that edits `ci.yml` can still read them. GitHub
>   creates the environment with no rules the first time a job names it.
> - Check that tag protection limits who can push `v*` tags. D-1's note asks for the same.
> - The first tagged run is the first real test of `sign-desktop`, including `minisign` from Ubuntu's
>   archive and the artifact download pattern `acorn-{dmg,windows-*,linux-*}`.
>
> For later phases: D-3 and D-4 weren't touched. `build-desktop.yml` still passes the Sentry secrets to
> its build steps, as before.

# D-2. Manual desktop builds receive the updater signing key

Found November 20, 2026, in Acorn at `90b9e61e3`. Severity is medium and latent. The secret
handoff is confirmed from workflow source. Status is open.

## Evidence and impact

`.github/workflows/ci.yml` runs desktop packaging for version tags and manual dispatches. Both
paths pass the updater signing credential into `.github/workflows/build-desktop.yml`, where
repository build commands run with it in their environment. The reviewed workflow does not
declare a protected environment for that step.

The desktop configuration pins the public key in `apps/desktop/src-tauri/tauri.conf.json`.
The reviewed desktop does not have an active updater. Key exposure would compromise a future
updater that trusts the same key. The risk requires control of a build that can receive the
credential. The review did not inspect repository-side dispatch and secret permissions.

## Fix and verification

Keep ordinary manual builds unsigned. Deliver the release signing credential only through
a protected release job with an approved ref, and make signing consume a previously built
artifact. Verify repository-side rules before relying on them to guard the key.

Check that a branch dispatch receives no release signing credential. Verify that an approved
release still produces an artifact signed by the expected key.
