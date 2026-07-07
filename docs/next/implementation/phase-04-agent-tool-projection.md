# Phase 4 — Agent-tool projection

**Status:** planned · **Depends on:** Phases 1 and 3 · **Primary docs:**
[contribution-points](../contribution-points.md) §4.7 and §4.8,
[memory](../memory.md), [security](../security.md) §4,
[ux](../ux.md) §3.

## Goal

Declare each agent capability once and project it to every required surface:
MCP, harness HTTP, and optionally the renderer. In the same phase, make task
context sections declarative so the context tray, compact context block, and
MCP `task_context` pull path use one source of truth.

## Architectural Context

Today an agent verb spans preload, IPC, Hono harness route, bridge wiring, and
MCP tool code. The layers have already drifted semantically. Phase 4 replaces
that with a registry:

```text
AgentToolContribution
  -> MCP tool
  -> harness route
  -> optional renderer client
  -> permissions/risk filter
```

Tool handlers return domain data or throw typed tool errors. Projection layers
translate to their surface-specific envelopes.

## Implementation Plan

1. Add `AgentToolContribution`.

   Shape from [contribution-points](../contribution-points.md) §4.8:
   `name`, `description`, `input` zod schema, `scope`, `risk`, optional `when`,
   `handler`, and optional `exposeToRenderer`.

2. Implement projections.

   - MCP tool schema derives from `input`.
   - MCP availability re-evaluates and emits `tools/list_changed`.
   - Harness route is `POST /api/tasks/:id/tools/:name` under
     `INTERNAL_TOKEN`.
   - Renderer client is generated or thinly typed only when
     `exposeToRenderer` is true.

3. Port current tool groups.

   Port notes, memory, run, browser, and read-only git tools. Delete
   `harnessWiring.ts`, harness bridge setters, per-tool MCP bodies, and any
   remaining preload/knowledge IPC groups made obsolete by Phase 3.

4. Preserve memory invariants.

   `memory_write` remains proposal creation only. No tool, plugin, or provider
   can write accepted memory directly. Accepted memory stays human-gated and
   file-backed.

5. Collapse notes semantic fork.

   One notes store API stamps provenance from tool/UI scope so agent-created and
   UI-created notes cannot drift.

6. Add permission and risk tiers.

   Tool risk is `read`, `write`, or `execute`. Settings render registry groups
   by tier. Per-tier/per-tool toggles persist as a prefs slice and are consulted
   with `when`.

7. Add context section registry.

   Register `pr`, `issues`, `notes`, and `memory` sections with `id`,
   `defaultIncluded`, `budget`, `assemble`, and optional `jump`. The context
   pane tray, `formatContextBlock`, and MCP `task_context` all consume the same
   registry.

   Preserve product semantics:

   - memory is index-only by default;
   - notes include bodies and slugs;
   - linked provider items use stale-safe cached blobs;
   - missing cache is explicit;
   - each section declares truncation posture.

8. Preserve MCP settings and inspection behavior.

   Do not let tool projection absorb the rest of MCP. The config inspector,
   starter creation, register/unregister behavior, auto-registration, masking,
   invalid JSON rows, and packaged/dev naming split remain intact.

## Slice Order

1. Registry plus one read-only tool end-to-end.
2. Notes and memory tools, including provenance/memory invariants.
3. Context section registry.
4. Run/browser execute-tier tools.
5. Permissions UI and prefs slice.
6. MCP settings-page preservation pass.

## Acceptance Criteria

- Adding one agent verb is one contribution object.
- The same contribution appears in MCP, harness HTTP, and renderer only when
  declared.
- Tool names and schemas remain byte-identical unless a PR explicitly opts into
  a breaking change.
- `run_*` tools appear when a repo gains run targets mid-session.
- Permissions page lists every tool by risk tier.
- Toggling a tier/tool off removes it from `tools/list`.
- Context tray, compact block, and MCP `task_context` derive from the same
  section registry.
- No feature tool handler knows which projection invoked it.

## Verification

- `pnpm lint`
- `pnpm test`
- MCP `tools/list` before/after comparison, accounting only for intended
  dynamic-availability improvements.
- Table-driven harness route test per projected tool.
- Context route tests for include defaults, budgets, stale/missing provider
  cache, and note/memory asymmetry.
- Live agent session exercising notes and run tools.
- Permission toggle hides tools from MCP.

## References

- [contribution-points.md](../contribution-points.md) §4.7 and §4.8.
- [review.md](../review.md) §1d and recommendation #13.
- [memory.md](../memory.md) §1, §4, §9.
- [security.md](../security.md) §4.
- [ux.md](../ux.md) §3.
- [feature-parity.md](../feature-parity.md) §8 and §11.
- [docs-overhaul.md](../docs-overhaul.md) §3 for `docs/agent-tools.md` and
  `docs/mcp.md`.
