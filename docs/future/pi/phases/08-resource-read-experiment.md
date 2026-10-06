# Phase 08: resource-read experiment

Status: proposed, 2026-10-03. Entry: phase 07 accepted. Next:
[phase 09](./09-session-reach.md).

## Outcome

Paired measurements establish whether read resources reduce first-turn context without reducing task
completion. The result either retains an off-by-default experiment or removes it. This phase does
not authorize replacing the normal tool surface. Source: [resource reads](../07-resource-reads.md).

## Ownership and data flow

Agent resource request → thin stdio MCP transport → task-authenticated Node tool route → existing
registered handler and tool ceiling → bounded MCP resource content. One domain implementation and
one authorization path serve tools and resource aliases.

The executable at `apps/node/src/entries/mcp.ts` delegates to
`packages/node-core/src/mcp/server.ts`. Change the library transport, not the thin executable.
Read that server, `mcp/api.ts`, the task tool manifest/invocation routes, risk tiers, and signed
session ceiling. The live registry, not the comparison's count of 26 readers, defines eligibility.

## Implementation

1. Inspect Claude and Codex resource behavior with a minimal fixture before building aliases.
   Prove the model can discover and read resources on its own, without a person mentioning a URI.
   Record unavailable client support as a failed experiment precondition rather than manufacturing
   a new Acorn read tool to change the comparison.
2. Build a bounded alias catalogue for the source proposal's implemented readers. Confirm each
   target is read-only, registered, available to the addressed task, and admitted by its tool ceiling.
   Advertise no resources outside a task and none for disabled/unavailable plugins. Re-resolve live
   availability and permission changes; an advertised URI never grants authorization by itself.
3. Add MCP resource templates/read handlers through the existing SDK. Decode parameters once,
   validate schemes and lengths, and translate to existing handler inputs. Preserve the same
   `before-tool-call` policy, principal, path validation, response bounds, and error semantics by
   invoking the existing Node route. No second domain handler or generic filesystem resolver.
4. Validate URI attempts involving another task, session, provider item, traversal, malformed
   escaping, or encoded separators at the same domain boundary as tools. Treat an URI as an alias,
   not proof of access. Keep writes, search, and nested result selectors outside the resource set.
5. Use a Node-held experiment mode, default `off`, with `tools-and-resources` and
   `resources-and-write-tools` variants. Freeze a mode for each measured session/process start.
   Hiding read tools changes discovery only; retained resource invocation still checks the signed
   ceiling. Do not turn experimental hiding into a global production removal of read tools.
6. Freeze 10 real task definitions and starting fixtures. Each needs at least two eligible reads.
   Run each on Claude and Codex in all three modes, with matched model/options, plugin roster,
   context, skill/advisor settings, and clean starting state. That is 60 runs for one paired pass.
   Use task completion criteria written before running. Do not use real outbound writes as benchmark
   side effects when fixtures or an isolated project can supply the same behavior.
7. Capture actual first-turn context tokens, completed outcome, failed/repeated reads, run settings,
   and protocol evidence. Treat unavailable token reporting as a measurement blocker. Compute
   savings against each harness's tools-only baseline, show per-task values and the aggregate, and
   rerun only ambiguous/failing comparisons whose outcome may be stochastic.
8. Apply the original stop rule per harness: resources-only must save at least 15% of aggregate
   measured first-turn context and lose no task completed by its paired tools-only run. If either
   harness fails, remove aliases and experimental modes and keep the evidence here. If both pass,
   retain the implementation off by default and propose a separate decision to change the default.

Do not expose additional plugin contribution formats, query selectors, generic URI writes, or a
new resource policy that bypasses agent-tool authorization.

## Verification and acceptance

Apply [shared verification](./README.md#verification-for-every-phase). Focus MCP/route tests on
authorization parity, mode isolation, disappearing readers, URI validation, and content conversion.
Check missing task identity, wrong task/session, restricted tool ceiling, disabled plugins, denied
tool hooks, and unavailable Node behavior through an actual MCP process.

Acceptance is a versioned benchmark table with reproducible fixtures and a clear pass/remove result.
For a removal outcome, rerun focused MCP tests to show ordinary tool discovery and calls remain
intact. A subjective report that resource reads feel simpler is insufficient.

## Documentation and handoff

Update [MCP](../../../mcp.md) and [agent tools](../../../agent-tools.md) only for retained implemented
behavior. Keep experimental measurements and the disposition in this phase and
[the source experiment](../07-resource-reads.md). Supply phase 11 with the benchmark artifacts,
configuration revision, and any code-removal revision.

## Verify before building

Recount eligible tools, inspect SDK resource support and both clients' model access, confirm
first-turn token reporting, and trace the existing tools route's principal/hook checks. Verify the
experiment mode cannot be supplied by a task principal to widen its own signed tool ceiling.
