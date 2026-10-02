# What acorn takes from oh-my-pi

Status: proposed, 2026-10-02. Nothing in this programme is built or scheduled. Where a file here
disagrees with a shipped contract, the owning reference document wins until the implementation
changes that contract.

## What this is

[oh-my-pi](https://github.com/can1357/oh-my-pi) (`omp`) is a coding agent: a fork of Mario Zechner's
Pi with a large set of built-in tools and a TypeScript extension system. This programme records what
its extensions can do that an acorn plugin cannot, why, and the changes that close the gaps worth
closing.

The finding that shapes everything else is about the agent loop, not about how many plugin features
each side has. The loop is the cycle that builds a prompt, calls the model, runs the tools it asks
for, and feeds the results back. `omp` owns its loop, so an extension sits inside it. Acorn drives
loops other people wrote: Claude Code over ACP, Codex over its app-server, and DeepSeek and any
contributed harness over ACP. An acorn plugin sits outside the loop and reaches only its edges.

That difference is structural. No amount of plugin API widening lets an acorn plugin rewrite what
Claude Code sends to Anthropic, because that happens in Claude Code's process. So the programme does
two things: it widens the edges acorn does own, and it tests whether acorn needs a loop of its own
at all by running `omp` as a harness first.

## What `omp` extensions can do

An `omp` extension is a TypeScript module with a default factory that receives an `ExtensionAPI`
(`coding-agent/src/extensibility/extensions/types.ts` under `packages/` in the `omp` repository). It loads
in-process with no isolation, and `ctx.isProjectTrusted()` always returns `true`. From that position
it can:

- Rewrite the message list before every model request (`context`), replace the raw provider request
  (`before_provider_request`), and rewrite a finished assistant message before it is stored
  (`assistant_message`).
- Block, rewrite, or annotate any tool call, including the built-in `bash` and `edit` (`tool_call`),
  patch a tool's result (`tool_result`), and replace a built-in tool while still calling the original
  through `ctx.invokeTool`.
- Stop the model's reply mid-stream when a rule matches, inject the rule, and retry from the same
  point. `omp` calls this time-traveling stream rules (TTSR).
- Ask a side question over the live conversation without adding to it (`ctx.runEphemeralTurn`), and
  pick a model by family (`ctx.models`). The advisor feature, a second model that reviews every turn
  and injects notes, is built from these.
- Push a message into a running session with a delivery mode: steer the current run, follow up after
  it, aside at the next step, or hold for the next turn (`pi.sendMessage`).
- Register model providers, slash commands, keyboard shortcuts, and terminal renderers for tool calls.
- Ship skills, rules, prompts, subagent definitions, MCP servers, and language-server and debugger
  setups as one plugin, in a format compatible with Claude Code's plugin marketplace.

## What an acorn plugin can reach

A loaded acorn plugin runs in a permission-scoped worker and reaches the agent through these seams:

- `agents:before-send`, which can observe, transform, or veto a prompt before acorn sends it.
- Context sections and agent contexts, which add bounded text to what a session starts with.
- Agent tools, which reach every harness through acorn's MCP server.
- `core:before-tool-call`, which guards acorn's own tools only.
- Lifecycle events on `plugin:agents:turn-changed`, `request-changed`, and `sessions-changed`.
- `agents.reviewInput.v1`, which reads a completed turn's user messages and final assistant message.
- `ctx.core.models.generateText` under the `models` grant, which spends a backend the caller names.
- UI points such as `agents:tool-card`, `agents:session-header`, and `agents:composer-actions`.
- Custom agents, MCP servers, and harness contributions.

That list is long, and the workspace side of the plugin system (panes, rail sources, dashboards, data
sources, trees, cooperative hooks) has no equivalent in `omp` at all. The gap is narrow and deep:
everything inside the loop.

## Read this programme

| File | What it covers |
| --- | --- |
| [01-omp-harness.md](./01-omp-harness.md) | Run `omp` as a contributed ACP harness. One manifest, no acorn change, and the test of whether acorn needs its own loop. |
| [02-before-permission.md](./02-before-permission.md) | Build the `agents:before-permission` hook already designed in [mods.md](../mods.md), and what `omp` adds to that design. |
| [03-session-messages.md](./03-session-messages.md) | A capability that lets a plugin queue an attributed turn on a live session. |
| [04-unattended-model-calls.md](./04-unattended-model-calls.md) | A host-held backend choice and spending cap per plugin, so a plugin can call a model from an event without a picker. |
| [05-advisor.md](./05-advisor.md) | A loaded advisor plugin: a second model that reviews each finished turn and sends a note back. The consumer for 03 and 04. |
| [06-agent-content.md](./06-agent-content.md) | Skills, rules, and commands as plugin contributions that acorn writes into each harness in its own format. |
| [07-resource-reads.md](./07-resource-reads.md) | An experiment: expose acorn's read-only tools as MCP resources behind one read, the way `omp` treats `pr://` as a path. |
| [refused.md](./refused.md) | What this programme decided not to take from `omp`, and why. |

## The order of work

| Step | What the owner gets at the end | Depends on |
| --- | --- | --- |
| 01 | `omp` in the Agent pane beside Claude and Codex, with its own extensions, rules, and advisor running inside it. | Nothing. |
| 02 | A plugin can refuse a harness's permission request before the person sees it. | Nothing. |
| 03 | A plugin can queue a note on a session, drawn as the plugin's, never as the person's words. | Nothing. |
| 04 | A plugin can generate text from a schedule or an event on a backend and cap the owner chose for it. | Nothing. |
| 05 | An advisor that reads each finished turn and queues a note when it finds a problem. | 03, 04. |
| 06 | A plugin can ship a skill or a rule, and every harness that supports one receives it. | Nothing. |
| 07 | A measured answer to whether resource reads beat about 26 separate read tools. | Nothing. |

Run 01 first. It costs one manifest and an afternoon, and its result changes how much the rest
matters. If `omp` runs well as a harness, the deep-loop features (context rewriting, stream rules,
tool shadowing) are available to anyone who wants them, through `omp`'s own extensions, and acorn
never has to build them. Steps 02 to 06 are still worth doing, because they work the same for Claude,
Codex, and DeepSeek, which `omp`'s extensions never will.

Steps 03 and 04 are each built once, then proved by 05. The rule in
[extensibility.md § Unexercised seams rot](../../extensibility.md#unexercised-seams-rot) applies: do
not ship 03 or 04 without 05, or another real consumer, landing behind them.

## Relation to other programmes

- [mods.md](../mods.md) owns the design for 02. File 02 only adds to it.
- [memory/](../memory/README.md) phase 2 deletes Findings. Findings is the only other consumer of
  `agents.reviewInput.v1` and the precedent 04 generalizes. Memory phase 2 has shipped first and
  removed that capability. Phase 05 must introduce its bounded read contract when implemented.
- [sandbox/](../sandbox/README.md) owns containment. Nothing here is containment, and 02 says so.
- [ecosystem/](../ecosystem/README.md) owns discovery and signing. File 06 touches the Claude Code
  marketplace format and defers to ecosystem on discovery.

## Correction to the first comparison

The conversation that started this programme said loaded plugins cannot spend model keys. That was
wrong. A loaded node plugin with `permissions.node.core: ["models"]` calls
`ctx.core.models.generateText` and spends whichever backend it names
([the manifest § Permissions](../../plugin-authoring/the-manifest.md#permissions)). What a loaded
plugin cannot do is spend a provider credential from inside an agent tool handler, which runs as a
task principal. File 04 is written against the corrected picture.

## Verify before building

Each file ends with its own list. Across all of them, recheck
[managed-agents.md](../../managed-agents.md), [agent-tools.md](../../agent-tools.md), and
[node-side extension points](../../plugins/node-side-extension-points.md) before starting. The `omp`
facts come from its repository at the commit cloned on 2026-10-02, and that project changes daily.
