# Standalone Node dependency security

This page covers how the standalone Node's runtime dependencies are pinned and checked, from the
workspace to the npm lockfile in the tarball. It's part of [Node distribution](../node-distribution.md).

The root `package.json` owns runtime dependency security overrides. `pnpm-workspace.yaml` repeats them,
and `tools/arch/dependencySecurity.test.ts` rejects disagreement. The packer copies the policy into the
generated npm manifest, because npm doesn't read pnpm's settings. For a direct dependency, npm's `$name`
reference uses that dependency's declared patched range. Hono's catalog floor and other direct runtime
floors move with the policy.

`pnpm audit --prod` reports no advisories. When an advisory has no fixed release and Acorn doesn't call
the affected code, `auditConfig.ignoreGhsas` in `pnpm-workspace.yaml` lists it beside a comment that
gives the reason and says when to remove it. A fix that ships replaces the entry.

The root manifest's `acornStandalone` policy pins the keymap provider to the release tested in the
workspace, and its optional Solid adapter peer follows the standalone Solid dependency through a
package-specific override. The test checks the pin against the source declaration and the lockfile.

## The reviewed npm lockfile

The workspace lockfile pins exact versions and integrity hashes, but npm can't read it. So the standalone
Node has its own npm lockfile, committed at `apps/node/standalone/package-lock.json` beside the manifest
it was resolved from. Every platform archive, the container image, and every operator who runs `npm ci`
install that one dependency graph, and npm checks each download against its recorded hash.

`scripts/node-standalone-lock.mjs` builds the manifest from the same sources the workspace uses. The
packer refuses to pack when the committed manifest differs from the one those sources produce, and
`tools/arch/standaloneRelease.test.mjs` fails `pnpm test` for the same reason. After a runtime
dependency changes, run `pnpm lock:node`, review the lockfile diff, and commit both files. npm keeps
every locked version that still satisfies the manifest, so a relock moves only what the change needs.
It passes `--before` with the `minimumReleaseAge` from `pnpm-workspace.yaml`, so a version published
within that window can't enter the lockfile.

## Install scripts

The tarball's `.npmrc` sets `ignore-scripts`, so `npm ci` runs no package's install script. The
generated `build-native` script then runs `npm rebuild` for the packages that `allowBuilds` in
`pnpm-workspace.yaml` allows, the same list the workspace install obeys. With this lockfile, that's only
`node-pty`. A locked package with an install script that `allowBuilds` doesn't name stops the packer and
the test, so someone reads the script and lists the package as `true` or `false` first.

## Container agent CLIs

`apps/node/Dockerfile` pins Claude Code and Codex to exact versions. Each pins its platform packages
exactly. The install runs with scripts off, then runs only Claude Code's install script, which links
its platform binary. To update a CLI, change its `ARG` to a release at least a week old.

## Published releases don't change

A tag's release job attaches each archive and its checksum once. A rerun for the same tag uploads only
platforms the release lacks, and stops when the release holds only one file of a pair. The image job
skips the push when the registry already has the version. Both jobs publish a provenance attestation
for what they upload. Check an archive with `gh attestation verify <archive> --repo jamesmacfie/acorn`.
