# Scope and refused alternatives

Date: 2026-09-12. Status: implementation proposal, not started.
Baseline: `8cb7ce45`. Paths describe the surveyed code, not a promise that it has stayed unchanged.

- No GitHub Actions, webhooks, Linear polling implementation, or general event-trigger framework.
- No second scheduler, automation engine, workflow runner, or separate workflow run-history store.
- No privileged MCP expansion, CLI, cross-Node dispatch, or control-plane task storage.
- No automatic execution of AI-generated schedules. AI authors workflows; users approve scheduling.
- No silent following of definition changes under an earlier approval.
- No workflow-length wait inside a scheduler handler and no overlap check based only on handler lifetime.
- No promise of exactly-once provider effects or cross-occurrence ticket deduplication.
- No automatic task cleanup. Completed task retention remains user-controlled.

## Verify before building

Check proposed target hooks stay generic and narrow. If integration requires core importing a
plugin implementation or a frame administering schedules, stop and amend the boundary design.
