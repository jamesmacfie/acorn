# Phase 4: Add the run_script tool

Date: October 16, 2026. Status: proposed. Needs phases 1 and 3.

This phase adds one agent tool, `run_script`, which runs a short program that calls other Acorn
tools and returns one result. Read it before you build the tool.

## Why

An agent pays one model round trip per tool call. Asking "which of my five child sessions failed,
and what did each say last" takes five or more calls today. Each one pays a round trip, and each
result lands whole in the agent's context. With a script, the agent writes:

```js
const sessions = await tools.agent_session_list({})
const failed = sessions.sessions.filter((s) => s.status === 'failed')
return await Promise.all(failed.map((s) => tools.agent_read({ sessionId: s.id })))
```

That's one call and one result, holding only what the agent asked for. OpenCode calls this Code
Mode (`references/opencode/packages/codemode/README.md`). Cloudflare described the idea first.

## The tool

Register `run_script` as a core agent tool beside the others in
`packages/node-core/src/server/agentTools/coreTools.ts`:

- Input: `{ code: string }`, at most 20 KB.
- Risk: `read`. The script tool itself reads nothing. Each call the program makes is checked
  against that tool's own risk, as described below.
- Description: say that `tools.<name>(input)` calls any Acorn tool listed in this session with the
  same input it takes directly, that the last expression or a `return` is the result, and what the
  limits are. Don't repeat each tool's schema. The agent already has the tool list.

The result is `{ ok, value, logs, calls }`. `calls` lists each tool call the program made, by name
and outcome, so a transcript card can show what ran. On failure, `ok` is `false` and `error` gives
the message and line number. Phase 1's cap applies to the whole result.

## Every inner call passes the same gates

This rule matters more than anything else in the phase. A call from inside a script must pass every
check a direct call passes, in the same order:

1. The tool exists, and the caller's principal may see it.
2. `requiresSession`, the permission tier and the per-tool switch, and the workflow ceiling.
3. The tool's `when` availability.
4. Input validation against the tool's schema.
5. The `core:before-tool-call` hook.
6. The provenance proof for tools that need a signed session.
7. The `tool.call` span.

All of this lives in `invoke` in `packages/node-core/src/server/routes/plugins/agentTools.ts`, tied
to the Hono request. Pull the checks after authentication into one function that takes the
principal's facts and a `ToolContext`. Have `invoke` and `run_script` both call it. Don't write a
second copy of any check.

`run_script` can't call itself. The program sees `tools.run_script` as missing.

Each inner call gets the call ID `<outer call ID>:<n>`, numbered from 1 in the order the program
starts them. A retried outer call then repeats the same inner IDs, and handlers that rely on the
ID for idempotency stay correct.

## Limits

Take the numbers from phase 3's decision. Start from these and change them only with a reason:

- 120 seconds in total, because `agent_wait` and `task_scripts_wait` can block.
- 50 tool calls.
- The interpreter's memory limit from the spike.
- Logs from `console.log`, capped with the result.

When the outer call is cancelled, cancel the program and every inner call through the same
`AbortSignal`.

## The transcript

Add a tool card for `run_script` that shows the program, collapsed, and the list from `calls`. A
person reviewing the session should see which tools ran without opening the raw result.

## Tests

- Through the real `createApp()` route and the MCP projection, as [agent tools](../../agent-tools.md)
  asks for every tool.
- A program that calls a tool switched off in permissions gets that call refused, and the program
  sees a thrown error.
- A workflow step session with a read-only ceiling can't make a write call through a script.
- A `core:before-tool-call` veto stops an inner call.
- Every escape attempt from phase 3 fails through the real tool.
- A program over the time limit or the call limit stops with a clear error, and calls already made
  are listed.

## Done when

- A real Claude Code session and a real Codex session each use `run_script` to read several child
  sessions in one call.
- [Agent tools](../../agent-tools.md) lists `run_script` and states the inner-call rule.
- [MCP](../../mcp.md#security) says that scripts run in an interpreter with no file, network, or
  process access, and that every inner call is checked like a direct call.

## Risks

- A bug in the interpreter is a bug in a security boundary. Pin its exact version, and read its
  changelog before every update.
- Agents might write long programs instead of short ones. The 20 KB input cap and the call limit
  keep the damage small.
- Harnesses with deferred tool loading, such as Claude Code, already save some of the context this
  tool saves. The round trips are the gain that doesn't overlap.
