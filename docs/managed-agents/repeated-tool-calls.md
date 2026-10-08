# Repeated tool calls

This page covers the warning Acorn gives when an agent seems stuck making the same tool call. The
setting is in [new-session defaults](./defaults.md).

An agent that makes the same tool call with the same input again and again is often stuck. When a
turn makes the same call three times in a row, the transcript gets a warning. The bell gets a row
titled **An agent may be stuck**, which opens the session. **Warn when an agent repeats a tool call**,
under Settings > Harnesses and defaults, sets the number: 3, 5, 10, or never. The warning appears
once per streak and stops nothing, because waiting and polling tools such as `task_scripts_wait`
repeat on purpose.

`plugins/agents/src/server/sessions/repeatedToolCalls.ts` counts the calls and writes the warning.
`commitProviderEvent` feeds it every tool event that has a turn and input, and loads the module on
the first one, so a Node start doesn't pay for it. Two calls match when they
have the same kind, MCP name, and input. The title doesn't count, because Claude Code titles a call
one way when it starts and another way in later updates. A call counts once, on its first event
that has input: Claude Code starts a call with empty input and fills it in on an update, and Codex
sends the input again when the call completes. Each subagent keeps its own count, so parallel
children don't break each other's streaks. Counts live in memory and reset when the turn ends. The
check covers every harness, Codex included, because it reads the event stream instead of a
[harness bridge](./loop-hooks.md). It sees a repeat only after the call has started.
