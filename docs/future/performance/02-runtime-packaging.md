# Phase 02: Use installed Claude Code and trim runtime resources

Date: October 9, 2026. Status: implemented October 9, 2026. Depends on: phase 01's inventory format.
Source baseline: `989b069c389df6143b90ffb9889dfeaae5db6010`.

Remove the SDK's bundled Claude executable from Acorn's installation and ship reviewed runtime
resources. Preserve the ACP adapter and require the user to install Claude Code on the executing Node.

## Outcome

`scripts/prune-runtime.mjs` owns the reviewed cuts. Desktop staging, the standalone install step, and
bundle verification all run it. The owning references are
[build and packaging](../../shell/packaging.md#runtime-file-policy),
[Node distribution](../../node-distribution.md#install-and-start), and
[harnesses](../../managed-agents/harnesses.md#claude-code). The dated bytes and checks are in
[Testing](../../testing/runtime-packaging-2026-10-09.md).

Decisions made during implementation:

- Declarations and source maps are cut by file type across every package, not by package and
  version. Node loads neither, so the rule doesn't depend on a package's layout, and a per-package
  list would fail on every unrelated update.
- node-pty's `deps/`, `third_party/`, and `src/` are cut only from the desktop. A standalone Node can
  need them for `npm rebuild`.
- The standalone prune is a separate command, not an npm install script, because npm skips install
  scripts when `ignore-scripts` is set.

Known gaps:

- No packaged desktop build ran `verify:bundle` with the policy, and no Linux or Windows target was
  staged.
- The real-host Claude session checks weren't run on a pruned install. Acorn passed the installed
  `claude` to the adapter before this phase too, so those sessions never used the removed executable.

## Starting point and owners

`plugins/agents/src/server/drivers/claudeHarness.ts` resolves the ACP adapter and declares
`requires: { command: 'claude', env: 'CLAUDE_CODE_EXECUTABLE' }`. The adapter uses that supplied path
instead of its SDK fallback. The October 8 macOS arm64 staging contained a 227,251,472 B fallback
executable. No production consumer besides the adapter was found; repeat that search.

`scripts/nodeRuntimePackages.ts` declares runtime packages. `apps/desktop/scripts/stage-runtime-dependencies.mjs`
copies their dependencies, peers, and optional dependencies. `apps/desktop/scripts/native-package-files.mjs`
filters node-pty prebuilds. `scripts/pack-node.mjs` emits standalone dependencies and an npm lockfile;
operators install them after extracting the archive.

The SDK JavaScript is a transitive requirement of `@agentclientprotocol/claude-agent-acp`. Retain the
parts the adapter uses. Removing the entire library would break the adapter and require another design.

## Implementation

1. Recheck the installed adapter's executable override on each supported platform and search all
   production SDK consumers. Record the reviewed adapter and SDK versions in the pruning policy.
2. Add package-specific omission rules to desktop dependency staging. Exclude all SDK platform
   executable packages, including nested copies. Retain the SDK library, required exports, licences,
   and notices. Fail visibly when a version or layout change invalidates the reviewed assumptions.
3. Preserve the host's executable discovery and actionable missing-command error. Installed Claude
   is required on a remote Node too; the desktop's executable path must not be sent to another host.
   Preserve the process broker's environment restrictions, authentication probe, and session identity.
4. Apply the same final-installation policy to standalone distributions. Their dependency installer
   can restore the optional executable even though the archive carries no node_modules. Provide a
   targeted, idempotent install-and-prune step and generated operator instructions, with locked versions
   and a clean-install test. Do not globally omit optional dependencies: Sharp and platform assets need
   them. Distinguish an npm download from bytes retained after installation in the evidence.
5. Review source maps, declarations, unused SDK entrypoints, and platform-only PTY resources as separate
   cuts. Use explicit package/version rules and demonstrate runtime resolution before omitting each.
   Keep runtime JSON, WASM, helper programs, licences, and any assets selected dynamically.
6. Extend inventory verification to reject the SDK executable packages after staging and installation.
   Compare phase 01's reports before and after. Check nested versions and installation outside the
   workspace dependency tree so development packages cannot conceal a missing file.

No automatic Claude installation or download fallback belongs in this phase. Keep Node, the adapter,
the user's Claude configuration, and persisted sessions. Other optional native packages retain their
independent policy; do not change the runtime pin or replace Sharp here.

## Verification and completion

Extend `apps/desktop/scripts/stage-runtime-dependencies.test.mjs` with a nested SDK fixture that
retains the library and rejects executable packages. Test unknown layouts, repeated pruning, and
supported target selection. Use a real extracted installation for the adapter library resolution.

Run `pnpm lint`, `pnpm test --filter=@acorn/plugin-agents`, `pnpm --filter @acorn/desktop test`, and
`pnpm --filter @acorn/arch-tests test`. Build the desktop on matching platform runners and run
`pnpm --filter @acorn/desktop verify:bundle` against the built artifact. Package and extract the
standalone archive with `pnpm pack:node`; follow its generated installation instructions outside the
checkout. All runtime-resolution and inventory checks must pass.

In a disposable real-host session, verify Claude create, turn, resume, permissions, hooks, native
skills, MCP, and terminal handoff using the installed CLI. Without Claude, the app must start and the
agent launch must explain the prerequisite without downloading it. Repeat the missing-command case
on a standalone Node. Record target, versions, exact bytes removed, and installed-size difference.

Update [shell packaging](../../shell/packaging.md), [Node distribution](../../node-distribution.md),
and [harnesses](../../managed-agents/harnesses.md) with tested installation requirements.

## Recheck before implementation

If the adapter requires bundled executable resources even with the override, isolate that dependency
before pruning. Report a required adapter change; do not replace the ACP implementation or remove
unrelated native packages to meet a byte target.
