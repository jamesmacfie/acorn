# Session control

`agents.sessionControl` lets another plugin stop a session's turn or change one of its options, such
as the model or the reasoning effort. Workflows uses it to cancel a step, and a loaded plugin can use
it to cycle effort from a command or move to a cheaper model past a budget. A loaded plugin can also
run a turn of its own through `agents.sessionExecute`, which
[running a turn from a plugin](#running-a-turn-from-a-plugin) covers. `agents.toolCaller`, at the end
of this page, tells another plugin's agent tool which session called it. It's part of
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
another plugin's name. A compiled plugin gets the value unbound. `agents.sessionExecute` binds the
same way. `reload.test.ts` checks both bindings across a real loaded worker.

## The grant

A loaded plugin names `agents.sessionControl` in `permissions.node.capabilities`. The trust prompt
shows it in the host's words, marked high: "Stop your agent sessions’ turns, and change their model,
reasoning effort, and other options, which changes what they spend". One grant covers both calls.

The `acorn-session-meter` plugin, kept in its own repository, is the first loaded consumer.

## Running a turn from a plugin

`agents.sessionExecute` runs one turn in a managed session of a task and returns its result. The
workflows plugin runs every agent step through it. A loaded plugin names it in
`permissions.node.capabilities`, and the trust prompt shows it marked high: "Run turns in your agent
sessions, which spends their usage and lets them act in the task".

The contract is `AgentSessionExecute` in `plugins/agents/src/contract/sessionExecute.ts`, and the
implementation is `createSessionExecute` in `plugins/agents/src/server/sessions/sessionExecute.ts`.
A plugin outside this repository imports `AgentSessionExecute` from `acorn-plugin-types`. That type
leaves out the fields only workflows set.

```js
const execute = ctx.capabilities.get('agents.sessionExecute')
const result = await execute({
  taskId,
  profileId: 'claude-code',
  title: 'Review guide',
  prompt: 'Group these hunks into sections.',
  context: [{ label: 'Hunks', source: 'acme.hunks', content: hunks }],
  schema: guideSchema,
  tools: { maxRisk: 'read' },
  stepId: `guide:${headSha}`,
  onEvent: (event) => progress.push(event),
  signal,
})
```

The result is null when the profile has no managed driver. Otherwise `status` is `ok`, `error`,
`timeout`, `malformed`, or `cancelled`, `capture.structuredOutput` holds the answer that matched
`schema`, and `agentSessionId` names the session. Pass that ID back as `managedSessionId` to continue
the same session. A retry with the same `stepId` reuses the session it started, so it doesn't start a
second one.

The copy a loaded plugin gets differs from the workflows plugin's in these ways:

- It refuses a request that sets `posture`, `allowUnguardedAgents`, or `runId`, with an error that
  names the field. The workflows plugin resolves the first two from a run. A session's run ID decides
  which workflow runs its agent may read, so a plugin can't claim one.
- It runs the turn gated. A tool the harness asks permission for waits for the person.
- It refuses to run when the harness's mode skips its own permission checks, such as Claude Code's
  `bypassPermissions`, whether the harness started that way or `configOptions` asked for it. It throws
  `UnguardedAgentError`.
- It stores the plugin's ID on the session it creates, as `startedByPlugin`. The session list shows
  "by acme" on the row, and the transcript labels the turn "From acme". A client's config change
  can't replace it.
- It continues only a session the same plugin started, and keeps its `stepId` apart from a workflow's
  and another plugin's.

Every other field works as it does for a workflow step, including `tools`, `schema`, `context`,
`configOptions`, `goal`, and `timeoutMs`. Its session is a workflow session, so the task's session
list groups it with workflow sessions.

`onEvent`, `onGoal`, and `admitAutomatic` cross the worker as functions the plugin lends for the call.
The plugin's `signal` crosses too: aborting it cancels the turn, and the result comes back
`cancelled`. `reload.test.ts` checks the binding, a streamed event, and the abort across a real
loaded worker.

To let the person pick a harness, read `agents.profiles`. Its `list()` returns the ID and label of
each profile that has a managed driver, the profiles `agents.sessionExecute` can run on. Its trust
line is "See which agent harnesses can run its turns".

## Tool callers

`agents.toolCaller` tells another plugin's agent tool which managed session made a signed call. The
contract is `plugins/agents/src/contract/toolCaller.ts`, and the implementation is
`plugins/agents/src/server/sessions/toolCaller.ts`. The workflows plugin uses it for its
[workflow tools](../agent-tools/workflow-tools.md).

- `resolve(taskId, sessionId)` answers the session's title, whether a workflow step or another agent
  started it, the run that owns it, and its running turn. It answers `null` for a terminal session, an archived one,
  and one in another task. Pass the session ID from the tool context, which the credential signs,
  never from tool input.
- `onTurnSettled(listener)` reports each turn that reaches `completed`, `cancelled`, `failed`, or
  `interrupted`, after its write commits. It isn't durable. After a restart, read `agents.turns` for
  anything missed.

Both are reads. The session store stays with the agents plugin.
