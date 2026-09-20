# Ticket 01: Recoverable reset tooling

Date: 2026-09-21. Status: not started. Prerequisites: none.
Read [context](./context.md), [reset policy](./reset-and-versioning.md), and findings F07/F10/F11
in [findings](./findings.md).

## Outcome

A developer can enumerate and reset an explicitly named disposable Acorn installation without
touching source files, worktrees, external resources, or an unlisted directory.

## Work

- Replace the SQLite-only reset interface with the inventory/export/reset workflow specified in the
  reset policy. Reuse the explicit-root, external-export, and checksum precedent in
  `scripts/workflow-v2-transition.mjs:37`; do not keep a second feature-specific transition afterward.
- Keep the default operation read-only. Require an execution flag plus explicit roots and recovery
  destination for mutation. Return a machine-readable manifest and a readable summary.
- Separate Node filesystem, device filesystem, browser-origin, and keychain adapters. Each adapter
  enumerates exact owned targets; it must not clear an entire profile or enclosing data directory.
- Use the shell's existing origin/keychain authority for desktop cleanup. If that host is unavailable,
  report the outstanding adapter and refuse to claim a complete reset. Do not substitute a broad delete.
- Record per-artifact verified export/removal status for interruption and resume. Refuse live writers,
  ambiguous roots, protected paths, and an export directory inside a reset target.
- Keep this tool independent of the later version marker so it can prepare a historical installation.
  This ticket tests fixtures only; it does not reset the developer's environment.

## Acceptance

Test dry-run immutability, explicit-target validation, active locks, shared desktop/TUI paths, symlinks,
WAL/SHM handling, permission failures, interrupted export, interrupted removal, and repeated execution.
Fixture source repositories, worktrees, arbitrary files, and external-database configuration must remain
byte-identical. Verify the recovery manifest hashes and old-snapshot restore into an isolated directory.
Run `pnpm lint`, reset-tool tests, and affected custody/desktop/TUI tests. A native adapter needs a
graphical-host check before being marked complete.

## Verify before building

Resolve the actual host paths from the runtime implementations. Do not execute `pnpm db:reset` against
an implicit development root; this checkout can live below that root.
