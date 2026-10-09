# Session control

`agents.sessionControl` lets another plugin stop a session's turn or change one of its options, such
as the model or the reasoning effort. Workflows uses it to cancel a step, and a loaded plugin can use
it to cycle effort from a command or move to a cheaper model past a budget. `agents.toolCaller`, at
the end of this page, tells another plugin's agent tool which session called it. It's part of
[managed agents](../managed-agents.md).

The contract is `AgentSessionControl` in `plugins/agents/src/contract/sessionExecute.ts`. The
implementation is `plugins/agents/src/server/sessions/sessionControl.ts`, and `setConfig`'s checks are
in `sessionConfig.ts` beside it, loaded on the first change. A plugin outside this repository imports
the same `AgentSessionControl` from `acorn-plugin-types`.

## Calls

- `cancel(taskId, sessionId)` stops the session's running turn.
- `setConfig(taskId, sessionId, optionId, value)` picks one of the values the harness advertised for
  one of its options. The session's advertised options are in its `agents.sessions` roster entry, as
  `configOptions`.

Both throw when the session isn't in that task. `setConfig` also throws for:

- An archived session.
- A session a terminal holds, or any controller other than acorn.
- An option the harness didn't advertise.
- A value the harness didn't list for that option. This is stricter than the composer's picker, which
  accepts any value for an option that lists none.

A value that's already current changes nothing.

## The picker's path

`setConfig` builds the same patch the composer's picker sends and calls `runtime.patchSession`, so the
provider, the saved session config, and the `agent:session` row every client's picker reads stay in
step. The transcript records the change with the plugin's id: "Reasoning effort changed to High by
acorn-session-meter". A plugin's change isn't the person's choice, so it doesn't become their default
for new sessions. Changing an option on a stopped session starts its harness, as the picker does.

## Who called

A capability has no caller of its own, so the host supplies one. The unbound value carries a function
under `BIND_CAPABILITY_CALLER` from `@acorn/protocol/plugin/ids.ts`. When a loaded plugin reads the
capability, `scopeCapabilities` in `packages/node-core/src/server/plugins/permissions.ts` hands it the
copy that function returns for the plugin's id. The plugin never names itself, so it can't claim
another plugin's name. A compiled plugin gets the value unbound. `reload.test.ts` checks the binding
across a real loaded worker.

## The grant

A loaded plugin names `agents.sessionControl` in `permissions.node.capabilities`. The trust prompt
shows it in the host's words, marked high: "Stop your agent sessions’ turns, and change their model,
reasoning effort, and other options, which changes what they spend". One grant covers both calls.

The `acorn-session-meter` plugin, kept in its own repository, is the first loaded consumer.

## Tool callers

`agents.toolCaller` tells another plugin's agent tool which managed session made a signed call. The
contract is `plugins/agents/src/contract/toolCaller.ts`, and the implementation is
`plugins/agents/src/server/sessions/toolCaller.ts`. The workflows plugin uses it for its
[workflow tools](../agent-tools/workflow-tools.md).

- `resolve(taskId, sessionId)` answers the session's title, whether a workflow step started it, the
  run that owns it, and its running turn. It answers `null` for a terminal session, an archived one,
  and one in another task. Pass the session ID from the tool context, which the credential signs,
  never from tool input.
- `onTurnSettled(listener)` reports each turn that reaches `completed`, `cancelled`, `failed`, or
  `interrupted`, after its write commits. It isn't durable. After a restart, read `agents.turns` for
  anything missed.

Both are reads. The session store stays with the agents plugin.
