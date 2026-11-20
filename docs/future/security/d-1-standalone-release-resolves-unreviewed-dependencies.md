> **Completion note, November 20, 2026.** Fixed on the Acorn side.
>
> What landed:
>
> - The standalone Node has one reviewed npm lockfile, committed at
>   `apps/node/standalone/package-lock.json` beside the manifest it was resolved from.
>   `scripts/node-standalone-lock.mjs` builds that manifest from the workspace sources (moved out of
>   `scripts/pack-node.mjs`), and `pnpm lock:node` resolves the lockfile again, still with `--before`
>   set from `minimumReleaseAge`. The packer no longer resolves anything. It stops before building when
>   the committed manifest differs from the generated one, then ships the committed lockfile, so every
>   platform archive, the image, and every operator install the same graph.
> - Install scripts are off by default. The packed tree carries `.npmrc` with `ignore-scripts=true`, and
>   a generated `npm run build-native` runs `npm rebuild` only for packages that `allowBuilds` in
>   `pnpm-workspace.yaml` marks `true`. That's the workspace's own allowlist, so the release and the
>   workspace follow one reviewed list. A locked package with an install script the list doesn't name
>   stops the packer and the test. With this lockfile, only `node-pty` runs.
> - The Dockerfile pins Claude Code 2.1.329 and Codex 0.171.0 in `ARG`s, installs them with scripts off,
>   then runs only Claude Code's install script. Codex has none.
> - `build-node.yml` no longer uses `--clobber`. A rerun for a tag keeps any archive and checksum pair
>   that's already on the release, uploads only missing platforms, and fails on half a pair. The image
>   job skips the push, and doesn't move `latest`, when the version is already in the registry. Both
>   jobs attest build provenance with `actions/attest-build-provenance` v4.2.2, pinned by commit, and
>   `ci.yml` grants `id-token: write` and `attestations: write` to the call.
> - Install steps in the docs and on the site changed from `npm rebuild` to `npm run build-native`,
>   because a bare `npm rebuild` runs nothing under the shipped `.npmrc`.
>
> How it was checked:
>
> - `tools/arch/standaloneRelease.test.mjs`, which runs in `pnpm test`, checks the following: the
>   committed manifest matches the sources, the lockfile root matches the manifest, only `node-pty`
>   may run an install script, unreviewed scripts fail, every entry has a registry URL and a sha512
>   hash, the CLI versions are exact, and the release upload has no `--clobber`.
> - `pnpm pack:node` and `pnpm pack:node --platform darwin-arm64` passed, with the service budget
>   check relaxed for that run only and restored after. Both archives carry a lockfile byte-identical to
>   the committed one. A verbose `npm ci` of the tarball ran zero lifecycle scripts, and
>   `npm run build-native` ran only node-pty's `install` and `postinstall`. `scripts/node-archive/smoke.mjs`
>   passed against the platform archive.
> - `docker build` of the image passed locally on arm64. `claude --version` printed 2.1.329,
>   `codex --version` printed 0.171.0, node-pty loaded, and the Node printed a pairing code.
> - The release job's skip step, extracted from the workflow and run against a fake `gh`, uploaded
>   everything for a fresh release, kept a published pair, and failed on half a pair.
>
> Decisions and deviations:
>
> - The allowlist is pnpm's `allowBuilds`, not a second list.
> - A rerun skips published files instead of failing, so adding a platform that failed earlier still
>   works. Rebuilt archives aren't byte-identical, because `BUILD` holds a timestamp, so the comparison
>   is by name.
> - npm 11 warns that node-pty "is not yet covered by allowScripts". npm's own `allowScripts` setting
>   could replace the `.npmrc` and `build-native` pair once every supported Node ships an npm that has
>   it. Operators on Node 22 may not.
> - The workflow changes weren't run in GitHub Actions, as this phase doesn't trigger workflows.
>   Attestation needs a public repository, and this one is.
>
> Still open, outside this repository's code:
>
> - Turn on GitHub's immutable releases for the repository, and check that tag protection limits who
>   can push `v*` tags. The workflow can't enforce either.
> - `pnpm audit --prod` covers the pnpm lockfile, not the npm one. The npm lockfile can pick a
>   different compatible version than the workspace tested. No test compares the two.
> - Base images in the Dockerfile and the `node:24-bullseye` build container are pinned by tag, not
>   by digest.
>
> For D-2, D-3, and D-4: none of their files changed. `build-node.yml`'s `release` and `image` jobs now
> hold `id-token: write` and `attestations: write`. Desktop packaging in `build-desktop.yml` still
> uses its own flow.

# D-1. Standalone releases resolve a mutable dependency graph

Found November 20, 2026, in Acorn at `90b9e61e3`. Severity is medium for supply-chain exposure.
The packaging behavior is confirmed from source. Status is open.

## Evidence and impact

`scripts/pack-node.mjs` resolves an npm lockfile from runtime dependency ranges during packaging.
It installs from that lockfile with npm lifecycle scripts enabled. The workspace pnpm build-script
allowlist does not apply to that step. The release matrix can resolve different dependency
versions for different platforms, and `.github/workflows/build-node.yml` can replace artifacts
for an existing tag. `apps/node/Dockerfile` also installs the agent CLIs without exact versions.

A dependency update can enter a standalone build independently of the reviewed workspace lockfile.
A compromised eligible dependency can execute during a release build or on the installed Node.
The age floor and audit reduce exposure. They do not bind a release to a reviewed dependency graph.
See [standalone dependency security](../../node-distribution/dependency-security.md).

## Fix and verification

Resolve and review one release lockfile for the version, then use it on each platform. Keep
lifecycle scripts disabled by default and explicitly build the packages that require them. Pin
the container's agent CLIs. Keep released artifacts immutable and publish provenance for them.

Verify that repeated builds for a release use the same resolution and that the only install
scripts that run are on the release allowlist. Check that a publishing rerun cannot change an
already published archive under the same version.
