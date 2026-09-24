# Ticket 11: Close library exports

Date: 2026-09-21. Status: implemented 2026-09-23; release acceptance remains in ticket 13. Prerequisites: 06–10.
Read [context](./context.md), F12 in [findings](./findings.md), and
[dependency direction](./target-architecture.md#retain-the-runtime-topology).

## Outcome

client-core, node-core, custody, and dashboards-core no longer publish wildcard access to every source file.

## Work

- Inventory external imports into each library after the ownership moves. Classify each as a supported
  contract, composition seam, facade implementation target, test helper, or misplaced dependency.
- Replace wildcard export maps with enumerated supported subpaths, following Protocol's existing map.
  Keep stable feature-owned paths where they are meaningful; do not funnel everything through a barrel.
- Move misplaced callers onto the intended contract. Put test-only helpers behind testkit entries and
  migrate remaining plugin tests off deep facade imports. Production cannot import testkit.
- Extend the export-map tests to reject wildcard reintroduction, missing targets, and test-file exports.
  Keep runtime/library layering and the no-package-to-plugin rule. Remove obsolete shrinking-baseline
  entries rather than converting them into permanent exceptions.
- Update facade exports and public surface snapshots in the same change. Add a concise boundary map
  to the owning architecture reference rather than a README for every module.

## Acceptance

All production and test consumers compile through explicit exports. An intentionally private import
fails package resolution, while compiled and loaded plugin authoring still works. Plain Node boot
does not pull client/DOM modules through a barrel. Run `pnpm lint`, architecture and facade/toolkit
tests, and Node composition tests. Inspect the enumerated map for accidental publication of implementation.

## Verify before building

Use the actual import graph, including tests, before closing a package. Explicitly listing every source
file would retain the same exposure and does not satisfy this ticket.

## Implementation evidence

- The import inventory found 284 distinct external `client-core` source paths, 118 `node-core`,
  9 `custody`, and 13 `dashboards-core` before closure. The enumerated maps now have 135, 53, 5,
  and 9 entries. Feature-owned `public.ts` files expose only bindings used across packages. Direct
  paths preserve lazy UI imports, CSS side effects, exact mock targets, composition seams, and
  colliding names. The [architecture boundary map](../../architecture-overview.md#package-boundaries)
  explains which paths each library owns.
- Plugin tests use the facade testkits, with no direct imports into the two core libraries. A separate
  client testkit path keeps the WebSocket reset helper out of the eagerly loaded testkit barrel.
  The plugin API surface snapshot includes the new test entries. The architecture scanner resolves
  the real package maps, rejects private imports, and checks wildcard, target, and test-file rules.
- `plugin-api` entrypoints passed 12 tests in a Node environment; the SDK type check and its 2
  contract tests passed. The plugin scaffold passed 12 tests.
  The 35 plugin tests changed by the testkit migration passed 298 tests across 13 packages. Node
  composition and loaded-plugin tests passed 11 tests; the loopback boot suite passed 3 tests when
  run with listener permission. The architecture suite passed 53/54 tests; its remaining failure is
  the pre-existing palette host command invocation assigned to ticket 13. `git diff --check`, direct
  oxlint, the icon census, and TypeScript checks in all 34 TypeScript packages passed. The final
  client testkit split also passed the 5-test Node crash suite and 22-test terminal chrome suite.
- `pnpm lint` could not reach its tasks: pnpm 11 tried to recreate this worktree's modules and the
  registry was unavailable. The worktree links were restored from the existing parent checkout, and
  the equivalent oxlint and package TypeScript checks were run directly. Turbo's lint task runner
  hit the same pnpm reinstall check before executing package scripts.
