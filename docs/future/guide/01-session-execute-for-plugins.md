# Phase 1: agent turns for installed plugins

Date: October 30, 2026. Status: not started.

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
