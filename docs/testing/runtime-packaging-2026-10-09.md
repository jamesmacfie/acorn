# Runtime packaging evidence, October 9, 2026

This page records what performance phase 02 ([runtime packaging](../future/performance/02-runtime-packaging.md))
removed from the desktop's staged runtime dependencies and from a standalone Node's install. The
figures are dated evidence. Don't edit them. The policy itself is in
[build and packaging](../shell/packaging.md#runtime-file-policy).

## Setup

- Checkout: `9f23e0836` with phase 02's changes applied and uncommitted.
- Target: macOS 27.0 on Apple silicon (`aarch64-apple-darwin`). Bundled Node runtime 24.21.0.
- Reviewed versions: `@agentclientprotocol/claude-agent-acp` 0.54.1, `@anthropic-ai/claude-agent-sdk`
  0.3.197, and Claude Code 2.1.197 inside the SDK's executable package.
- The Node service and terminal client builds fail their startup ceilings at this checkout, as the
  [phase 01 baseline](./performance-baseline-2026-10-09.md) records. Both ceilings were raised
  locally for these runs only and put back.

## Desktop staging

From `apps/desktop/scripts/size-report.mjs`, before and after staging with the policy, in bytes:

| Component | Before | After | Removed |
| --- | ---: | ---: | ---: |
| Runtime dependencies | 297,035,258 | 55,142,487 | 241,892,771 |
| Runtime dependency files | 5,161 | 3,625 | 1,536 |
| Runtime dependency JavaScript | 24,591,408 | 22,253,335 | 2,338,073 |
| Installed total | 443,862,215 | 201,970,424 | 241,891,791 |

The SDK's `claude` executable was 227,251,472 bytes of the removal. The JavaScript removed is the
SDK's `bridge.mjs` and `browser-sdk.js`. The rest is type declarations and node-pty's build inputs.
The installed total also moved by 980 bytes from an unrelated renderer rebuild.

The report doesn't count source maps, so the 1,235 source map files, 6,203,292 bytes, that staging
also stopped shipping are outside the table. No release bundle was built, so installer and update
archive sizes weren't measured.

## Standalone install

`pnpm pack:node`, extracted outside the checkout, then `npm ci --omit=dev` and
`node scripts/prune-runtime.mjs`, in bytes:

| Measurement | Bytes |
| --- | ---: |
| Downloaded SDK executable package, compressed | 67,617,665 |
| `node_modules` after `npm ci` | 454,519,919 |
| Removed by the prune step | 273,761,072 |
| `node_modules` after the prune step | 180,758,847 |

A second prune run removed nothing. node-pty kept its sources, so `npm rebuild` still works. The
operator's npm had `ignore-scripts` set, which is why the prune is a separate command rather than an
install script.

## Checks

These passed:

- `pnpm --filter @acorn/desktop test`: 205 and 11 tests, including the helper boot from staged
  resources and a test that stages the installed adapter outside the checkout. That test confirms the
  adapter returns `CLAUDE_CODE_EXECUTABLE` and finds no bundled executable to fall back to.
- The pruned standalone Node, run with the bundled Node 24.21.0 and `claude` off `PATH`, booted and
  listed Claude Code as not installed with `claude is not available on PATH.` With `claude` on
  `PATH`, it listed Claude Code as installed at the user's `claude`.

These weren't run:

- A packaged desktop build and `pnpm --filter @acorn/desktop verify:bundle`.
- A Claude session on a pruned install: create, turn, resume, permissions, hooks, native skills, MCP,
  and terminal handoff. Acorn already passed the installed `claude` to the adapter before this phase,
  so those paths didn't use the removed executable.
- Linux and Windows targets.
