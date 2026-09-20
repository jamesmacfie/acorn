# Ticket 11: Close library exports

Date: 2026-09-21. Status: not started. Prerequisites: 06–10.
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
