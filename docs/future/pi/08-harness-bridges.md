# 08. Reach inside a harness loop through the harness's own hooks

Status: proposed, 2026-10-07. Not started.

Execution handoff: [phase 10](./phases/10-harness-bridges.md).

## Why

This programme's [README](./README.md) rests on one finding: the agent loop belongs to the harness, so
an acorn plugin reaches only its edges. That is still true of acorn's own process. What changed is
that every harness family acorn drives now publishes hooks inside its own loop:

- Claude Code has command hooks in its settings and, since Mods, in-process function hooks. The
  [Mods reference](https://code.claude.com/docs/en/plugins/mods/reference) was public at v2.1.290 on
  2026-10-07, with `tool.call`, `tool.check`, `prompt.context`, `session.append`, `session.compact`,
  and `agent.spawn` among its events.
- Codex shipped a [hooks system](https://learn.chatgpt.com/docs/hooks) shaped like Claude's command
  hooks: `PreToolUse`, `PermissionRequest`, `PostToolUse`, `UserPromptSubmit`, `Stop`,
  `SubagentStop`, and others. Its documentation says hooks run under `app-server` as well as the
  interactive CLI.
- `omp` loads TypeScript extensions with `tool_call` and `tool_result` events
  ([01](./01-omp-harness.md)).

Acorn already passes data into every session it starts. `claudeHarness.ts` sends
`claudeCode.options` through `acpSessionMeta`, and the ACP adapter spreads those options into the
Agent SDK's own (`@agentclientprotocol/claude-agent-acp` 0.54.1, checked 2026-10-07). `codexStart.ts`
sends a `config` object on `thread/start` and `thread/resume`.

So acorn can put a small bridge into each harness that calls back into acorn at a loop point and
returns acorn's answer in the harness's own words. A plugin author writes against acorn's points
once. The bridge, not the plugin, knows each harness's spelling. Acorn still owns no loop, and
[refused.md](./refused.md) still refuses everything that would need one.

A person-installed Claude Code mod that reports to acorn is planned outside this programme. It is
the same idea from the other side, so the ingress below is a versioned contract that mod can target.

## What each harness offers at the two first points

| Acorn point | Claude Code | Codex | `omp` |
| --- | --- | --- | --- |
| Before a tool runs | `PreToolUse` command hook, or Mods `tool.call`. Deny with a reason the model reads. | `PreToolUse` with `permissionDecision: deny`. | `tool_call`, which can block. |
| After a tool runs | `PostToolUse` with `additionalContext` | `PostToolUse` with `additionalContext` | `tool_result` |

Prompt context, compaction, subagent start, and stop-blocking exist in two or more harnesses too.
They are left for later, each with a trigger, in [Later](#later-each-with-its-trigger).

## The design

### Two new points, owned by agents

Agents declares both beside `before-send` and `before-permission`, with `ctx.hooks.declare`.

`agents:before-tool` allows `observe`, `veto`, and a new `ask` mode. It uses `onTimeout: 'allow'`,
`order: 'install'`, and a 5,000 ms timeout, for the reasons
[mods.md](../mods.md#timeouts-fail-open-and-that-is-safe-here) gives for the permission hook. Its
payload is the tool subject phase 02 defines for `agents:before-permission`, so a policy plugin
registers one function and points it at both:

| Field | Meaning |
| --- | --- |
| `sessionId`, `taskId`, `providerId`, `unattended`, `root` | As on `before-permission`. |
| `toolCallId` | The harness's tool call ID when the bridge has one, otherwise `''`. A handler uses it to recognize the same call when the permission hook fires for it afterward. |
| `toolName` | The harness's own tool name, such as `Bash`. |
| `kind`, `title`, `command`, `paths` | The shared subject vocabulary from [mods.md](../mods.md#the-payload). |

`agents:after-tool` allows `observe` and `transform`. Its payload is the same subject plus
`succeeded: boolean` and `note: string`, which starts empty. A transform may set `note`, bounded to
4 KiB, and the bridge returns it as the harness's `additionalContext`. That covers the common hook
packages in the Claude ecosystem: run the linter or the tests after an edit and tell the model what
broke, inside the turn rather than in a later one.

### The `ask` verdict

`ask` is a fourth hook mode in core's registry, and a point opts into it through `allows`. A handler
answers `{ ask: true, reason }`. Agents then raises an ordinary permission request on the session,
naming the plugin and reason, and holds the bridge call until the person answers. A refusal goes back
to the harness as a deny. An approval goes back as no decision, so the harness's own checks still run.

`ask` only makes a session stricter, so it isn't auto-allow. It is the harness-neutral form of
Claude's `tool.check` returning `ask`, and of community mods that make a person confirm destructive
commands. The trust prompt names it separately from veto: "can make a tool wait for you".

### The bridge never approves

Every bridge reply is one of: deny with a reason, a context note, or no decision. It never returns
allow, even when the person approved an `ask`. A timeout, a crash, an unreachable Node, or a bad
reply is no decision. So a broken bridge leaves the session exactly as strict as the harness made
it, and acorn's rule that no plugin approves on the person's behalf holds inside the loop too.

### How each bridge is installed

Acorn owns one small bridge program, built as an entry beside `mcp.js`, the way
`apps/node/src/entries/mcp.ts` is. The program does nothing but forward. It reads the harness's hook
input, posts it with the harness and event names to the Node, and prints the reply the Node
composed. Mapping each harness's fields into the subject lives in agents beside that harness's
normalizer, where phase 02 puts permission subject extraction, so it is tested in one place.

- **Claude Code.** Add command hooks to the `settings` object acorn already sends in
  `claudeCode.options`. Command hooks are a stable, documented interface that mirrors Codex. Move to
  a Mods module, loaded through the SDK's `plugins: [{ type: 'local', path }]`, only if the per-call
  process cost measures too high. The person's own user and project hooks keep running, because the
  adapter keeps `settingSources`.
- **Codex.** Add `[[hooks.PreToolUse]]` and `[[hooks.PostToolUse]]` entries to the `config` object
  beside `mcpConfig`. Codex skips a non-managed hook until a person trusts its exact definition, and
  its bypass flag also bypasses trust for the person's own hooks. Phase 10 must find a supported way
  for a host to install a hook, such as a managed layer, or ship Codex without a bridge and record the
  limitation. Never pass the bypass flag.
- **`omp`.** An `omp` extension in the contributed harness package from
  [01](./01-omp-harness.md), posting to the same route.
- **DeepSeek and other ACP harnesses.** No bridge. They keep `before-permission` only.

### Install only what has a handler

A command hook is a process spawn and a round trip on every tool call. At session start and resume,
agents installs a bridge entry only for a point with at least one enabled handler. A handler that
registers mid-session takes effect at the next resume. Say so in the plugin authoring docs. A bridge
call that arrives with no handler registered returns no decision without running the chain.

### The ingress

One agents route under the task principal acorn's MCP server already uses. The bridge inherits the
same launch environment ([MCP § Launch environment](../../mcp.md#launch-environment)). The token,
not the request body, decides the task and session. A body names `harness`, `event`, and the raw hook
input, bounded in size. A session the token doesn't own gets no decision.

Version the request and reply shapes as `agents.loopHook.v1` in the agents contract. That is the
shape a person-installed acorn mod would post too. Sessions acorn didn't start have no task token,
so admitting them needs its own principal. That's an open decision for whoever builds the mod, not
part of phase 10.

### Coverage is visible

Add `loop_before_tool` and `loop_after_tool` to `AgentCapability` in
`plugins/agents/src/contract/wire.ts`. A driver reports them only when its bridge is installed and
verified for the running harness version. **Settings → Plugins** shows, for a plugin that handles
these points, which harnesses each one reaches. A policy that applies to every Claude and Codex tool
call but only to asked questions in DeepSeek must say so where the person turns it on.

### Relation to the permission hook and explanations

`before-permission` stays. It's the only coverage for harnesses without a bridge, and it still sees
questions a bridge wouldn't, such as a Codex network grant. A handler registered on both sees a call
twice when the bridge lets it through and the harness then asks. `toolCallId` lets it answer the same
way both times.

A bridge deny carries its reason to the model inside the turn. Where a bridge exists, the separate
explanation turn from [phase 03](./phases/03-session-messages.md) is unnecessary. It remains the
fallback for harnesses without one.

## What stays refused

- **Returning a tool's result instead of running it.** Mods' `{ result }` and `omp`'s tool shadowing.
  The transcript would show a call that never ran.
- **Rewriting tool input.** Codex and Claude both accept an updated input from `PreToolUse`. A plugin
  that changes the command a person approved is a larger grant than a veto. Revisit when a real
  consumer needs it, as its own mode.
- **Rewriting tool output before the model reads it.** Only Claude's Mods (`session.append`) can do
  this. Codex's `PostToolUse` can add context but not change output. Revisit when a second harness
  supports it and a secret-redaction consumer asks.
- **Hooks on the token stream and generic middleware.** Unchanged from [refused.md](./refused.md).

## Later, each with its trigger

- **Prompt context inside the harness.** `agents:before-send` and context sections already cover
  every prompt acorn sends. Add a bridge point only for prompts acorn doesn't send, such as a
  terminal-controlled session. Trigger: a consumer that needs it there.
- **Before compaction.** Claude and Codex both expose it. Trigger: a consumer that must save or veto
  something before compaction.
- **Subagent start.** Claude's `agent.spawn` can deny or pick a model. Codex reports `SubagentStop`.
  Trigger: a policy over subagents, and a second harness that can refuse one.
- **Blocking the end of a turn.** `Stop` with `block` makes Claude and Codex keep going. It overlaps
  the unattended turn-ending instruction in `claudeHarness.ts`. Trigger: evidence the instruction
  isn't enough.

## Verify before building

- The Claude adapter still spreads `claudeCode.options`, including `settings` and `plugins`, into the
  SDK's options. Checked in `acp-agent.js` of `claude-agent-acp` 0.54.1 and SDK 0.3.197.
- The hook input from each harness carries a tool call ID, and Codex's deny reason reaches the model.
- How a host installs a trusted hook in Codex 0.159.2 or later under `app-server`.
- Whether Mods still needs an early-access flag in the Claude Code build acorn bundles.
- The `omp` extension API for `tool_call` deny reasons at the commit phase 01 pins.
