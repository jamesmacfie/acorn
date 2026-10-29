# Phase 1: agent turns for installed plugins

Date: October 30, 2026. Status: done.

## Completion note

Landed October 30, 2026.

What landed:

- `agents.sessionExecute` carries a `BIND_CAPABILITY_CALLER` entry, set in `plugins/agents/src/node/index.ts`.
  `createSessionExecute` takes an optional `caller`. The workflows plugin still gets the unbound value.
- The bound copy refuses `posture`, `allowUnguardedAgents`, and `runId` by name, runs gated, stores
  `startedByPlugin` on the session it creates, and stamps `sentBy: { pluginId }` on its turns.
- A new read-only `agents.profiles` capability. Its `list()` returns `{ id, label }` for each profile
  with a managed driver. Nothing a loaded plugin could reach listed profiles before.
- Published types in `packages/plugin-types/src/contracts/agents.ts`: `AgentSessionExecute`, its
  request and result, and `AgentProfiles`. `tools/arch/agentContract.test.ts` pins them to the source,
  with the request minus the three refused fields.
- Trust lines for both capabilities. `agents.sessionExecute` is high.
- The transcript labels the plugin's turn "From acme", and the session list row shows "by acme".
- Docs: [session control](../../managed-agents/session-control.md#running-a-turn-from-a-plugin),
  and [permissions](../../plugin-authoring/permissions.md).

Decisions and deviations:

- `runId` is refused too. A session's `workflowRunId` decides which workflow runs its agent may read
  through the workflow tools, so a plugin must not be able to set it.
- The bound copy also refuses an unguarded harness mode, such as `bypassPermissions`, with
  `UnguardedAgentError`, even though it runs gated. A gated workflow step allows that mode, because
  the person chose the workflow. A plugin's turn has nobody who chose it. A person whose harness
  starts in `bypassPermissions` gets that error from any plugin turn.
- A plugin may continue only a session it started. Its session idempotency key includes the plugin
  ID and task ID, so its `stepId` can't land on a workflow's session or another task's.
- `startedByPlugin` is a server-owned session config key, so a client's config patch can't change it.
  The HTTP turn schema also refuses `sentBy` in `effectivePolicy`, so a client can't claim a plugin's name.
- Plugin sessions are still `kind: 'workflow'`. The sidebar groups them with workflow sessions.
- The refusal test and the fix landed in one commit. Against the old unbound value, the refusal test
  fails.

For later phases:

- Every callback crosses the worker. `onEvent` reaches the plugin while the turn runs, and aborting
  the plugin's `signal` returns a `cancelled` result. `reload.test.ts` covers both with a stand-in
  provider.
- Pass a stable `stepId`, for example one built from the head commit, so a retry reuses the session
  instead of spending a new one.
- Loaded plugin tests need a patched Node runtime (`>=24.18.1 <25` or `>=26.5.1 <27`). A 24.11 shell
  skips the worker and fails the test.

## Goal

Let a loaded plugin run a turn in a managed agent session through `agents.sessionExecute`, with a
published type, a trust prompt line that says what it costs, and no way to turn off the harness's
permission checks.

## Starting point

Checked against `main` at `e3d8d1e69`. Recheck before you start.

- `agents.sessionExecute` is defined in `plugins/agents/src/contract/sessionExecute.ts` and provided
  in `plugins/agents/src/node/index.ts` as a plain function. It carries no `BIND_CAPABILITY_CALLER`,
  so a loaded plugin gets the same value the workflows plugin gets.
- `scopeCapabilities` in `packages/node-core/src/server/plugins/permissions.ts` already hands out any
  capability a manifest names in `permissions.node.capabilities`. A loaded plugin can name this one
  today.
- `AgentSessionExecuteRequest` accepts `posture` and `allowUnguardedAgents`. Their comments say the
  workflows plugin resolves them, never an HTTP or tool body. Nothing strips them for a loaded caller.
  Write a test that shows this before you fix it, so the fix is proven against a real failure.
- `packages/plugin-types/src/contracts/capabilities.ts` lists the id as
  `HostOwned<'plugins/agents/contract/sessionExecute.AgentSessionExecute'>`, so an outside author gets
  no type.
- The trust prompt in `packages/client-core/src/host/trust/permissions.ts` names only
  `agents.sessionControl` in `CAPABILITY_DESCRIPTIONS`. Any other capability gets the generic line.
- `agents.sessionControl` is the pattern to copy. `createSessionControl` in
  `plugins/agents/src/server/sessions/sessionControl.ts` returns a copy bound to the caller's plugin
  ID, and the transcript names that plugin ([session control](../../managed-agents/session-control.md)).
- The request takes callbacks (`onEvent`, `onGoal`, `admitAutomatic`) and an `AbortSignal`. The
  worker transport lends callbacks for the life of a call
  ([the node realm](../../security/plugin-node-realm.md)), but no test runs this capability across a
  real loaded worker.

## In scope

### A caller-bound copy

Give the provided function a `BIND_CAPABILITY_CALLER` entry that returns a copy for the plugin's ID.
The bound copy:

- Refuses a request that sets `posture` or `allowUnguardedAgents`, with an error that names the
  field. Refusing is clearer than dropping the field without a word.
- Runs the turn gated, so a tool the harness asks permission for reaches the person.
- Records the plugin ID on the session it creates, so the transcript and the session list say which
  plugin started it. Reuse the wording `agents.sessionControl` uses.
- Keeps every other field, including `tools`, `schema`, `context`, and `managedSessionId`.

The workflows plugin keeps the unbound value, as compiled plugins do today.

### Choosing a profile

A plugin that lets the person pick a harness needs the list to pick from. First check whether a route
or capability already lists the agent profiles that have a managed driver, as the workflows step
catalog does with `managedProviderForProfile`. If none fits, add a read-only `agents.profiles`
capability that returns each such profile's ID and label, and nothing else.

### The published type

Describe `AgentSessionExecute` in `packages/plugin-types/src/contracts/agents.ts` without `posture`
and `allowUnguardedAgents`, and replace the `HostOwned` entry in the catalogue. Add the profile list
type if you added the capability. `packages/plugin-types/src/contract.test.ts` pins the catalogue's
IDs, so update it.

### The trust prompt

Add `agents.sessionExecute` to `CAPABILITY_DESCRIPTIONS`, marked high. For example: "Run turns in your
agent sessions, which spends their usage and lets them act in the task". Add the case to
`permissionLines.test.ts`.

## Tests

- In `plugins/agents/src/server/sessions/sessionExecute.test.ts`, check that a bound copy refuses
  `posture` and `allowUnguardedAgents`, runs gated, and records the caller.
- Across a real loaded worker, in the style of `packages/node-core/src/server/plugins/reload.test.ts`,
  check that a turn completes, that `onEvent` reaches the plugin, and that aborting the plugin's
  signal stops the turn. If a callback can't cross the worker, leave it out of the bound copy and
  the published type, and say so in the docs.
- The trust prompt line test above.

## Docs

Add a section on running a turn from a plugin to
[session control](../../managed-agents/session-control.md), and list the new trust line in
[permissions](../../plugin-authoring/permissions.md).

## Done when

A loaded test plugin that names `agents.sessionExecute` shows the new high line in the trust prompt,
runs a turn in a task, and fails with a readable error when it sets `posture`. The session list shows
the plugin's name on the session.
