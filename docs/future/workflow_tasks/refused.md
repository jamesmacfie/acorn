# Scope and refused alternatives

Date: 2026-09-12. Status: implementation proposal, not started.
Baseline: `8cb7ce45`. Paths describe the surveyed code, not a promise that it has stayed unchanged.

- Do not replace agent-only `fan-out`. Preserve saved definitions and its result shape.
- Do not create another execution engine. Dispatch invokes the ordinary workflow runner.
- Do not implement Linear queries or a generic filtering language here. Consume structured output.
- Do not add GitHub triggers, a CLI, an external API product, or broader MCP authority.
- Do not allow arbitrary recursion, cross-project dispatch, cross-Node dispatch, or detached children.
  Start with bounded same-project trees; revisit limits with usage evidence.
- Do not infer permission from an AI suggestion. Generating or saving a definition never grants authority.
- Do not claim exactly-once external effects. Durable invocation identity only deduplicates Acorn dispatch.
- Do not delete tasks or worktrees on completion or failure. Retention requires a separate user policy.

## Verify before building

Check every phase against these boundaries. If a required implementation crosses one, stop and
amend the design with the owner instead of weakening authentication or plugin isolation.
