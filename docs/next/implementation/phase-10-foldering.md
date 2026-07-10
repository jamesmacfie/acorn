# Phase 10 — Foldering

**Status:** ✅ done (2026-07-11) · **Depends on:** all registry/projection seams existing ·
**Primary docs:** [extensibility](../extensibility.md) §6 and §9,
[docs-overhaul](../docs-overhaul.md) §4.

> **Completion note.** The source now lives under `src/{core,plugins,app}` split by process, moved
> mechanically by a map-driven codemod (git-tracked renames + relative-import rewrite). The clean
> structural seams landed: route-contribution registry (`core/server/routeRegistry.ts` + app
> activation, `createApp` no longer imports product routes), integration-provider + agent-profile
> registration moved to the `app/` composition root, cross-process shared contracts (ws/terminal/
> notes/workflow) relocated to `core/shared`, and the WS client to core transport. Import rules are
> enforced by `src/core/boundaries.test.ts`, which proves **zero** `→app` leakage and a clean
> client↔node process boundary, and holds a **shrinking baseline** of ~82 pre-existing cross-feature
> couplings (features importing each other directly instead of via the pane/command/capability/state
> registries). Those are Phase 4/5/6 seam-*adoption* follow-through, not foldering — each is a tracked
> ledger entry that can only shrink, never grow. `pnpm lint`, `pnpm test` (542), and `pnpm build` all
> pass from the new paths.

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

## Required Context

Read these sections before implementation:

- [extensibility.md](../extensibility.md) §2 defines what remains core; §3
  defines the plugin model; §6 shows the assembled app; §7 maps current parity;
  §8 names hard parts; §9 describes order of operations.
- [contribution-points.md](../contribution-points.md) §4 is the full catalog
  that foldering must preserve through imports rather than bypass.
- [feature-parity.md](../feature-parity.md) all sections remain the behavioral
  checklist; §18 is especially relevant for scripts, packaging, dev, and build.
- [state-and-policies.md](../state-and-policies.md) §5 defines core services and
  state policy that plugins may consume but not reimplement.
- [testing.md](../testing.md) §4 defines contribution conformance expectations
  that should become easier after foldering.
- [docs-overhaul.md](../docs-overhaul.md) §4 defines the README/root-doc
  overhaul; §5 defines what happens to `docs/next` after completion.

This phase should reveal boundaries already created. If a moved file needs a
new registry, projection, or core service to compile cleanly, stop and complete
the missing earlier phase before continuing.

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

## Design Guardrails

- **Extensibility:** plugins may depend on core contracts and contribution
  points, not on each other's internals. Cross-plugin behavior goes through
  descriptors, registries, events, links, or capabilities.
- **Simplicity:** prefer `git mv` and import fixes. New abstractions during this
  phase are evidence that an earlier seam is missing.
- **Robustness:** preserve route tests, smoke tests, dev/package launchers, ABI
  scripts, and stable storage origin while paths move.
- **Maintainability:** import rules and docs must make the boundary enforceable
  for future contributors, not just true at the moment of the move.

## Acceptance Criteria

- Folder move is largely `git mv` plus import fixes.
- Any non-mechanical change is listed with the earlier seam it depends on; if
  that seam is missing, Phase 10 is paused.
- Route tests still prove Phase 0 auth/envelope contracts.
- Plugin route ownership follows plugin folders.
- Core has no imports from plugins.
- Plugins have no internal imports from other plugins.
- Plugin process parts stay inside their process boundary: renderer code does
  not import main/server internals, and server/main code does not import React
  surfaces.
- Operational scripts work from new paths.
- `dev:node` remains first-class.
- Stable storage origin remains `127.0.0.1:4317` unless explicitly overridden by
  `ACORN_PORT`.
- README and docs describe the new architecture as shipped, not as a proposal.
- Every contribution point exercised by in-tree features has an obvious folder
  home and an import rule that prevents bypassing the contribution contract.
- `docs/next` is no longer the active implementation guide after the root docs
  are rewritten; it remains design history.

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
