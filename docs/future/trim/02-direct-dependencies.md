# Phase 02: remove proven unused direct dependencies

Date: 2026-10-04. Status: TODO. Risk: low to medium; install and packaging resolution can differ.
Prerequisite: accepted [phase 01](./01-baseline.md). Next: [phase 03](./03-native-payload.md).
Planning revision: `2ae55abb5`; use phase 01's accepted revision and measurements as the baseline.

## Task and context

Remove external declarations with no current consumer. The audit identified four names, appearing
in five declaration locations. A missing source import is evidence to investigate, not sufficient
proof: source workspace packages, Vite plugins, generated manifests, and runtime resolution also
consume declarations. Preserve offline query-cache behavior and standalone package resolution.

## Owners and data flow

- `packages/client-core/package.json`: `@tanstack/query-async-storage-persister` candidate.
- `apps/desktop/package.json`: that persister and `@tanstack/solid-query-persist-client` candidates.
- `apps/tui/package.json`: `seroval` and `seroval-plugins` candidates.
- `packages/client-core/src/infra/persistence/queryCacheLifecycle.ts` uses
  `@tanstack/query-persist-client-core`; this dependency is live and remains.
- `scripts/pack-node.mjs` creates the standalone manifest. Desktop declarations also resolve
  runtime packages used by bundled service code, as their manifest comment explains.
- `pnpm-workspace.yaml` owns catalogs, patches, and build policy; root `package.json` owns security
  overrides and standalone dependency pins. Preserve these policies.

The cache restores through a custom persister and Node/user-specific custody. Solid may still pull
seroval transitively after direct declarations disappear. That is not a failed cleanup.

## Implementation steps

1. Read [caching](../../caching.md), [state ownership](../../state-ownership.md), and
   [packaging](../../shell/packaging.md). Search each candidate across source, config, scripts,
   package exports, dynamic resolution, tests, generated-manifest inputs, and documentation.
2. Record the consumer search and package-resolution rationale for each declaration in `evidence.md`.
   Keep any candidate that has gained a live consumer. Do not include CodeMirror merely because a
   particular TUI import is type-only; shared document custody and emitted imports also matter.
3. Remove only proven unused declarations. Update explanatory manifest comments that become false.
   Regenerate the lockfile through pnpm under the supported runtime; do not edit snapshots by hand.
   Avoid upgrading unrelated dependencies or changing security floors, Solid patches, or peer rules.
4. Re-run phase 01's graph inventory. Report direct declarations removed, unique roots removed,
   locked entries actually removed, and zero reductions caused by remaining consumers.
5. Build Node, CLI, TUI, and desktop, then pack the standalone Node. Inspect its generated manifest.
   In a temporary directory outside the checkout, install that local tarball with production
   dependencies and run the documented CLI help and terminal startup smoke. No publishing.
6. Exercise query cache restore/revalidation across disconnect and reconnect, plus Node switching.
   Existing persistence tests are the first proof; add a regression only if a removed declaration
   exposes a behavior gap. Record all results and the accepted lockfile revision.

## Verification

```sh
pnpm lint
pnpm test --filter=@acorn/client-core --filter=@acorn/tui --filter=@acorn/desktop
pnpm --filter @acorn/arch-tests test
pnpm build
pnpm pack:node
pnpm install --frozen-lockfile
```

Run focused persistence tests while iterating; find them beside the current persistence owner.
The desktop suite stages dependencies and covers shell boot. The temporary standalone install must
resolve independently of workspace node_modules; record its exact install and smoke commands.

## Acceptance, limits, and rollback

- Every removed declaration has a recorded absence-of-consumer argument and successful consumers.
- Cache persistence and standalone CLI/TUI startup remain functional.
- Frozen install succeeds, security/architecture checks pass, and unrelated versions are unchanged.
- Before/after dependency counts use phase 01's method and distinguish declarations from graph nodes.
- Restore the phase's manifests and lockfile together if resolution fails. Do not paper over a
  missing dependency with a hoist, global installation, or relaxed peer checks.
- Update task/table/evidence and hand off the dependency revision to phase 03.

## Verify before building

Check live imports and scripts, phase 01's baseline, current generated-manifest rules, and manifest
comments. Stop removal of a candidate if it has a real consumer; record the finding and keep it.
