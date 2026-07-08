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

Futureproofing (annotation, not work): this registry is also the harness search
surface for the self-improvement axis ([self-improvement.md](../self-improvement.md)
§5). `AgentToolContribution` already carries enough to be self-describing
(`name`/`description`/`input`/`risk`), so a future read-only "describe the
harness" introspection is a *fourth projection target* beside MCP/HTTP/renderer —
additive, no reshape. Keep the contribution shape self-describing for that reason
(ext tenet 2: "core can index, list, conflict-check"). Do not build the
introspection now.

## Required Context

Read these sections before implementation:

- [contribution-points.md](../contribution-points.md) §4.7 defines context
  sections; §4.8 defines agent tools and the contribution shape.
- [agent-runtime.md](../agent-runtime.md) §2.1 explains the handoff/memory leak;
  §4.1 defines the workflow runtime contract that will consume tool ceilings;
  §6.2 describes per-run tool allowlists and risk ceilings.
- [memory.md](../memory.md) §1 defines non-negotiable invariants; §4 describes
  contribution points; §6 and §9 define workflow/agent obligations and
  implementation checks.
- [security.md](../security.md) §4 defines risk tiers; [ux.md](../ux.md) §3
  defines the permissions surface users need to understand those tiers.
- [feature-parity.md](../feature-parity.md) §8 covers MCP settings and
  registration; §10 covers notes/memory boundaries; §11 covers context assembly.
- [testing.md](../testing.md) §4 defines the plugin/contribution conformance
  direction that this registry should support.
- [docs-overhaul.md](../docs-overhaul.md) §3 names new agent-tool and MCP docs.

The tool contribution owns schema, scope, risk, availability, and handler. MCP,
harness HTTP, and renderer clients are projections. If a handler checks which
surface invoked it, the boundary is wrong.

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

## Design Guardrails

- **Extensibility:** adding a tool or context section must be a contribution,
  not edits across MCP, harness, preload, context formatting, and settings.
- **Simplicity:** projection layers translate envelopes only. Keep domain logic
  in handlers and common permission logic in one filter.
- **Robustness:** dynamic availability must emit MCP `tools/list_changed`, and
  permission changes must remove tools from every projected surface.
- **Maintainability:** notes, memory, and context assembly must have one
  semantic source of truth so future providers and workflows cannot fork them.

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
- MCP, harness HTTP, and renderer projections are covered by table-driven tests
  from the same contribution fixture.
- Tool names and schemas remain byte-identical unless a PR explicitly opts into
  a breaking change.
- `run_*` tools appear when a repo gains run targets mid-session.
- Permissions page lists every tool by risk tier.
- Toggling a tier/tool off removes it from `tools/list`.
- Per-tool and per-tier permissions apply before workflow/profile ceilings, and
  Phase 8 can only narrow the set further.
- Context tray, compact block, and MCP `task_context` derive from the same
  section registry.
- No feature tool handler knows which projection invoked it.
- `memory_write` creates proposals only; no tool path can write accepted memory.
- MCP settings behavior in [feature-parity.md](../feature-parity.md) §8 remains
  intact, including masking, invalid JSON rows, auto-registration, and
  packaged/dev naming.
- `docs/agent-tools.md` and `docs/mcp.md` identify the contribution registry as
  the source of truth.

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
