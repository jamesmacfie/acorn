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

The workspace lockfile pins exact versions and integrity hashes. npm can't read it, so the packer
resolves an npm `package-lock.json` from the generated manifest and ships it in the archive. Every
operator who runs `npm ci` gets the same versions, and npm checks each download against the recorded
hash. The packer passes `--before` with the `minimumReleaseAge` from `pnpm-workspace.yaml`, so a version
published within that window can't enter the lockfile. The npm lockfile is resolved when you pack,
not copied from the pnpm one, so a range can pick a newer compatible version than the workspace tested.
