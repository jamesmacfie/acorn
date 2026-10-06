# Prompt caching for managed agents

Date: October 6, 2026

Status: Analysis and proposal. Implementation has not started.

This analysis covers prompt caching in Acorn's Codex and Claude Code integrations. It identifies
changes for maintainers to evaluate, the boundaries that own them, and the evidence needed before
implementation. No request traces or cache performance measurements were collected.

## Execution and ownership

Acorn drives managed Codex sessions through the native app-server driver. Claude Code runs through
the generic ACP driver and the Claude adapter. The harness constructs the model API request and
owns provider history, prompt rendering, and API cache controls.

Acorn owns session configuration, standing memory snapshots, task-context attachments, and its MCP
tool projection. The relevant flow is:

1. The Node snapshots standing memory and selected MCP servers when creating a session.
2. The composer captures selected task context and queues immutable input parts.
3. The driver sends instructions and input to the harness.
4. Acorn's MCP process projects the Node's authorized tools into harness tool definitions.
5. The harness sends model requests and returns usage that Acorn normalizes into its session ledger.
6. The session header supplies usage and prices to the agent-cost plugin.

The owners are `plugins/agents/src/server/sessions/runtime.ts`,
`plugins/agents/src/client/composer/AgentComposer.tsx`,
`plugins/agents/src/server/drivers/codexDriver.ts`,
`plugins/agents/src/server/drivers/claudeHarness.ts`, and `packages/node-core/src/mcp/server.ts`.
For the shipped contracts, see [Harnesses](../managed-agents/harnesses.md),
[Context sections](../agent-tools/context-sections.md), and [MCP](../mcp.md).

## Provider differences

The following API behavior was checked against official documentation on October 6, 2026:

| Behavior | OpenAI | Claude API |
| --- | --- | --- |
| Activation | Enabled by default on supported models. | Enable with `cache_control`, automatically or on blocks. |
| Matching | Identical prompt prefixes. | Identical prompt prefixes. |
| Explicit boundaries | GPT-5.6 and later. | Up to four breakpoints. |
| Lifetime | GPT-5.6+: at least 30 minutes after reuse. Earlier models have different retention policies. | Five minutes by default; one hour is available. |
| Write price relative to ordinary input | GPT-5.6+: 1.25×. Earlier models have no write premium. | Five minutes: 1.25×. One hour: 2×. |
| Read price relative to ordinary input | Usually 0.1× on GPT-5.6+; 0.05× on GPT-6.1 Sol. | Usually 0.1×, with model exceptions. |
| Routing keys | Useful on earlier models; unnecessary for routing on GPT-5.6+. | Cache markers, rather than OpenAI's routing-key mechanism. |

Sources: [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching) and
[Claude prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).
Stable instructions, tools, and append-only history support reuse. Compaction can replace the prefix.
These API rules do not establish which controls Acorn's installed harness exposes.

Claude Code manages caching automatically. Its main conversation defaults to a one-hour lifetime
within subscription usage, and five minutes with API keys or usage credits. Its TTL controls include
`promptCacheTtl`, `subagentPromptCacheTtl`, and corresponding environment variables, subject to CLI
version support. Requests outside the main conversation can have a different TTL.
See [Claude Code cache lifetime](https://code.claude.com/docs/en/prompt-caching#cache-lifetime).

Acorn's API-equivalent cost estimate is not a subscription invoice or a measure of remaining plan
allowance. Keep that distinction when comparing providers or evaluating savings.

## Protections Acorn already provides

The inspected code supports these conclusions:

- Codex uses `thread/start`, `thread/resume`, and `turn/start`. Acorn preserves the provider thread
  rather than reconstructing its history from transcript rows on each turn.
- Standing memory and custom-agent instructions are session snapshots. Codex sends the same
  developer instructions on start and resume. Claude appends the session's instructions on create
  and resume through `acpSessionMeta`.
- `automaticTaskContextFor` compares the captured payload with the last automatic attachment and
  skips an unchanged payload. Changed context becomes a later attachment.
- Context IDs and capture timestamps are metadata. `contextBlock` sends only source, label, and
  content, so those metadata fields do not introduce timestamp-driven prompt changes.
- `normalizeCodexNotification` retains cumulative `cachedInputTokens` and `cacheWriteInputTokens`.
  Session-header accounting and the cost estimator already use these counts.
- Core sorts context sections by declared order and ID. Context assembly has a deterministic order.

The supporting files are `plugins/agents/src/client/composer/automaticTaskContext.ts`,
`plugins/context/src/client/agentContextContribution.ts`,
`plugins/agents/src/server/drivers/contextBlock.ts`,
`plugins/agents/src/server/drivers/codexNormalizer.ts`,
`plugins/agents/src/client/sessions/sessionHeaderContext.ts`,
`plugins/agent-cost/src/tree/sessionCost.ts`, and
`packages/node-core/src/server/agentTools/contextSections.ts`.

These are protections against avoidable changes. They do not prove a cache hit or a particular
hit rate. Appending refreshed context does not itself rewrite earlier history.

## Recommended first pass

### Make the MCP manifest deterministic

`AgentToolRegistry.list()` returns registration order. The task tools route preserves that order,
and the MCP server projects it without sorting. Removing and registering a plugin can move its
definitions, even when the resulting set is equivalent. The harness may normalize ordering itself;
the effect on its rendered prompt remains unmeasured.

Sort the published tool manifest by name at the projection boundary. Keep descriptions and schema
serialization deterministic. Leave registry lifecycle and authorization with their owners.

The MCP change detector compares sorted names only. It misses a changed description or schema when
names stay the same. Compare the complete canonical definition set and announce actual changes.
This also improves definition-refresh correctness independently of caching.

The owners are `packages/node-core/src/server/agentTools/registry.ts`,
`packages/node-core/src/server/routes/plugins/agentTools.ts`, and
`packages/node-core/src/mcp/server.ts`.

### Expose cache performance

The shipped `plugins/agent-cost/src/tree/SessionCostBadge.tsx` shows cost without a cache breakdown.
Add cache reads, writes, and the share of input served from cache to the session usage presentation.
Reuse normalized ledger data and the session-header contribution contract.

Codex counters are cumulative, while the header treats Claude counters as per-turn. Compute Codex
deltas before presenting per-turn counts. Treat absent fields as unavailable, and check counter
resets and accounting semantics before choosing the denominator. Avoid labeling every uncached
token as a miss; newly appended input also requires processing.

Correlate drops with observed model changes, compaction, MCP changes, resumes, and idle gaps.
Distinguish observed events from inferred causes. Do not claim cache warmth without authoritative
TTL information. Prefer counters and timing over storing prompt text in telemetry.

## Follow-up experiments

### Reduce unnecessary tool-list changes

Acorn rechecks dynamic tool availability and announces manifest changes during a session. Evaluate
stable definitions with availability checked at invocation for tools whose availability changes
frequently. Preserve permission revocations, task scope, workflow ceilings, and disabled-plugin
behavior. Stable advertising must not widen execution authority.

Measure the harness before changing this policy. Claude Code's deferred tool loading can preserve
the initial tool prefix when MCP servers change. Loaded upfront tools have different behavior.
See [Claude Code MCP changes](https://code.claude.com/docs/en/prompt-caching#connecting-or-removing-an-mcp-server).

### Check which cache controls the harness supports

The inspected Codex driver passes no explicit cache controls. The published
[Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
did not establish a supported prompt-cache setting. Check the installed app-server schema and
upstream implementation before adding a setting or passing API options through `turn/start`.

Potential API controls include explicit boundaries, retention, and prewarming. Keep any supported
integration in the provider driver. Do not expose an unsupported generic session option.

Claude Code's documented TTL settings provide a more direct experiment. Verify that the ACP adapter
accepts and retains the setting on create and resume. Select a longer TTL only when avoided rebuilds
justify its higher write price. Keep main-session and subagent controls distinct.

### Evaluate context ordering across separate chats

The composer places user text, file mentions, and attachments before task context. Different first
messages therefore precede shared task material. Test whether moving genuinely shared material
earlier improves reuse across separate chats without changing instruction precedence or behavior.

Standing memory is frozen within a session, but its index sorts by modification time. Editing a
memory can reorder the prefix in a later session. This is a secondary experiment; changing ordering
also affects which entries fit the memory cap. Preserve that selection policy unless evidence
justifies a separate change.

The relevant owners are `plugins/agents/src/client/composer/AgentComposer.tsx`,
`plugins/memory/src/server/memory.ts`, and `plugins/memory/src/server/standingContext.ts`.

## Measurement and acceptance

Start with deterministic manifests and cache diagnostics. Collect paired measurements with the same
model, harness version, account mode, tool set, instructions, and task context. Record reads, writes,
total input, time to first token, and the gap since the previous request.

Exercise the following scenarios:

1. Several append-only turns in one session.
2. Resume the same thread after stopping its provider process, within and beyond the documented TTL.
3. Reload a plugin without changing its tool definitions, then change a description or schema.
4. Toggle a tool or MCP server, including a permission revocation.
5. Send unchanged task context, then changed task context.
6. Compact the conversation and change the model or reasoning setting.
7. Start separate chats with shared context and different first messages.

Accept manifest work when equivalent definitions produce identical projections and real definition
changes notify clients. Accept diagnostics when displayed counts match provider accounting, missing
fields remain explicit, and permission behavior is preserved. Claim performance gains only from
paired measurements. Do not keep providers alive or issue paid keepalive requests solely to maintain
a remote cache without evidence that the cost is justified.

## Verify before building

Before implementing, confirm the following:

- Re-read the named owners and the shipped harness, context, and MCP contracts.
- Recheck provider documentation, model-specific rates, TTLs, and installed harness versions.
- Inspect the installed Codex schema and Claude adapter support for proposed settings.
- Establish whether each harness sorts or defers MCP definitions before rendering requests.
- Validate usage counter semantics, resets, and availability across both providers.
- Capture a baseline for the scenarios above and preserve session history and authorization gates.
- Run focused tests for changed behavior, affected package and consumer suites, lint, and architecture
  checks. Check any usage UI in the desktop and terminal clients.
