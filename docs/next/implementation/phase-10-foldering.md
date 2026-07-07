# Phase 10 — Foldering

**Status:** planned · **Depends on:** all registry/projection seams existing ·
**Primary docs:** [extensibility](../extensibility.md) §6 and §9,
[docs-overhaul](../docs-overhaul.md) §4.

## Goal

Move the codebase into `core/` and `plugins/` after the extension seams exist.
This phase should feel mostly mechanical. If moving files forces new API design,
stop and fix the missing seam before continuing.

## Architectural Context

Earlier phases create the actual boundaries:

- Phase 1 creates the composition root.
- Phase 3 makes transport route-owned and residue-owned.
- Phase 4 creates tool and context projection.
- Phase 5 creates client registries and event/capability services.
- Phase 6 creates persisted-state descriptors.
- Phase 7 creates provider descriptors.
- Phase 8 creates workflow/profile registries.

Phase 10 makes that architecture visible in the filesystem and import rules.

## Implementation Plan

1. Prepare the move map.

   Use [extensibility](../extensibility.md) §6's assembled layout. Map every
   current feature to a plugin or core home using the parity map.

2. Move core first.

   Core owns identity, storage, route factory, middleware, transport, registries,
   event bus, prefs, sync engine, PTY/worktree primitives, shell sockets, and
   plugin activation.

3. Move plugins.

   In-tree features become plugins with client/server/main/MCP parts as needed.
   Cross-plugin extension goes through contribution points only.

4. Move route mounting to route contributions.

   Hono app factory keeps host/auth/csrf/session middleware and `requireUser`.
   Plugin server parts expose route contributions mounted under namespaces.
   Core no longer imports GitHub, Linear, or Rollbar product route modules
   directly.

5. Add lint/import rules.

   - No plugin imports another plugin's internals.
   - No core imports plugin code.
   - Cross-plugin extension only through declared contribution points.
   - Process-specific imports stay in their process boundary.

6. Update operational contracts.

   ABI rebuild scripts, smoke-browser script, `electron-builder` config, and
   the `ELECTRON_RUN_AS_NODE` MCP launcher must reference new paths.

7. Update docs.

   Rewrite repo maps in root docs, `CLAUDE.md`, and the README per
   [docs-overhaul](../docs-overhaul.md) §4. Graduate relevant `docs/next`
   proposal docs into `docs/` as descriptive documentation.

## Acceptance Criteria

- Folder move is largely `git mv` plus import fixes.
- Route tests still prove Phase 0 auth/envelope contracts.
- Plugin route ownership follows plugin folders.
- Core has no imports from plugins.
- Plugins have no internal imports from other plugins.
- Operational scripts work from new paths.
- `dev:node` remains first-class.
- Stable storage origin remains `127.0.0.1:4317` unless explicitly overridden by
  `ACORN_PORT`.
- README and docs describe the new architecture as shipped, not as a proposal.

## Verification

- `pnpm lint`
- `pnpm test`
- Smoke suite.
- Import/lint rule tests.
- Route tests for mounted plugin routes.
- Packaged/dev MCP launcher check.
- ABI rebuild and smoke-browser scripts run or are dry-run verified.
- Documentation links checked for moved paths.

## Completion Criteria for docs/next

Phase 10 is complete only when the `docs/next` goals are complete:

- every shipped feature has a contribution-point or core home;
- the parity checklist is verified;
- provider/tool/pane/workflow/profile additions no longer require core edits;
- docs in `docs/` describe the shipped architecture;
- `docs/next` remains as design history, not live implementation guidance.

## References

- [extensibility.md](../extensibility.md) §6, §7, §8, §9.
- [contribution-points.md](../contribution-points.md).
- [feature-parity.md](../feature-parity.md) §18.
- [docs-overhaul.md](../docs-overhaul.md) §4 and §5.
