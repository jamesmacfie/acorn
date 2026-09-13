# Workflow tasks

Date: 2026-09-13. Status: shipped.

All seven phases are complete. The original design and phase plans remain in Git history.

Current behavior is documented in:

- [Workflows](../../workflows.md) for child-workflow authoring, resolution, dispatch, limits,
  lifecycle, usage, events, and run navigation.
- [Workspaces and tasks](../../workspaces-and-tasks.md) for child task identity, worktrees, and
  retention.
- [Security model](../../security.md) for trust, task confinement, and inherited authority.
- [API reference](../../api-reference.md) and [data layer](../../data-layer.md) for routes,
  capabilities, projections, and durable records.
- [Testing](../../testing.md) for the manual acceptance checklist.

[Phase 7](./phase-07-navigation-and-acceptance.md) records the final automated and manual gates.
[Workflow v2](../workflow_v2/README.md) builds on the internal idempotent start capability and owns
the next scheduling and child-workflow implementation plan.
