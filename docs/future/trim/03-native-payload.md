# Phase 03: stage native package files for the explicit target

Date: 2026-10-04. Status: TODO. Risk: medium; omitted files can break installed processes.
Prerequisite: accepted [phase 02](./02-direct-dependencies.md). Next: [phase 04](./04-claude-payload.md).
Planning revision: `2ae55abb5`; measure against the preceding accepted staging inventory.

## Task and context

Reduce desktop payload by omitting node-pty files for unrelated targets. Its installed macOS arm64
package was about 61.4 MiB, including about 57.7 MiB of Windows prebuilds. This is an uncompressed
checkout observation; establish staged savings rather than promising installer savings.

The Node service leaves native/runtime-resolved packages external. Desktop staging copies their
installed dependency graphs beside the helper because Tauri does not materialize pnpm symlinks.
This phase changes copied package files, not workspace dependency resolution or npm installation.

## Starting points and invariants

- `apps/desktop/scripts/stage-runtime-dependencies.mjs`: copies package files, follows dependencies,
  peers and optionals, hoists compatible copies, retains nested conflicting versions.
- `apps/desktop/scripts/stage-runtime-dependencies.test.mjs`: isolated resolution and hoisting tests.
- `apps/desktop/scripts/stage.mjs`: currently copies dependencies before computing the Node target.
- `apps/desktop/scripts/node-runtime.mjs`: `targetTriple()` honors `ACORN_TARGET_TRIPLE`, otherwise
  reads rustc's host. Its supported triples must agree with staging.
- `scripts/nodeRuntimePackages.ts`, `apps/node/externals.ts`, and installed node-pty's manifest,
  loader, prebuild paths, platform manifests, and license files.

Required packages still fail loudly when absent. Optional peers remain optional. Retain real files,
module boundaries, compatible hoisting, conflicting versions, executable permissions, and licenses.
Never select target files solely from the build host's `process.platform` or `process.arch`.

## Implementation steps

1. Read [packaging](../../shell/packaging.md) and [Node child](../../shell/node-child.md).
   Inspect node-pty's actual loading paths for every supported release target, including Windows
   ConPTY assets and Linux libc/ABI assumptions. Record the package version and required file sets.
2. Compute the explicit target once in staging before copying dependencies. Pass a typed or validated
   target descriptor to the staging function. Use the existing supported triple mapping as authority;
   unsupported targets must produce a clear error rather than defaulting to host files.
3. Add a small package-specific file policy beside staging. Start with node-pty's demonstrated
   unrelated prebuild directories. Keep unknown package layouts intact or fail with a clear policy
   mismatch where omission is required; do not introduce a generic extension-based blacklist.
4. Preserve the dependency graph traversal. Do not skip packages globally or omit all optional
   dependencies. Verify the requested target's native package/files are installed before pruning;
   copying the host graph does not itself make a cross build valid.
5. Extend the existing fixture tests with multi-platform assets and explicit target selection.
   Prove target files and licenses remain, unrelated known files disappear, missing target assets
   fail safely, conflicting versions still resolve, and no checkout symlink is required.
6. Build/stage for the local supported target. Copy the helper to a temporary directory outside the
   checkout and launch a real PTY under its pinned Node. Read output, resize, and terminate it.
   On Windows, additionally prove ConPTY creation and disposal on a Windows runner.
7. Use target fixtures for each supported triple, and existing target runners for executable smoke.
   Record unsupported or unavailable runtime evidence precisely; do not label cross-platform
   acceptance complete from a macOS-only run. Compare staged bytes with the preceding phase.

## Verification

```sh
pnpm test:focus @acorn/desktop scripts/stage-runtime-dependencies.test.mjs
pnpm lint
pnpm test --filter=@acorn/desktop --filter=@acorn/node --filter=@acorn/plugin-terminal
pnpm --filter @acorn/arch-tests test
pnpm --filter @acorn/desktop build
```

Recheck exact package names in the workspace. Existing desktop tests cover staging and Rust boot;
the separate outside-checkout PTY smoke proves the native file policy. Keep build-budget checks.

## Acceptance and handoff

- Explicit target selection controls copied node-pty assets with demonstrated staged byte savings.
- Every supported target has fixture proof; required target runtime smoke is reported from the
  appropriate runner. No missing native file or unresolved package is ignored.
- Installed helper resolution, Windows path hoisting, pinned Node behavior, and licenses remain.
- Update [packaging](../../shell/packaging.md), task/table/evidence, and policy maintenance notes.
- Rollback is restoring the phase's staging policy/call sites together; no database changes exist.

## Verify before building

Check the current node-pty layout, target mapping, build scripts, native ABI requirements, and phase
02's dependency revision. Stop pruning when a layout or target cannot be proved safe.
