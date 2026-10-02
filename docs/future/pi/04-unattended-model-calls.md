# 04. Model calls a plugin makes on its own

Status: proposed, 2026-10-02. Not started.

## Why

`omp` gives an extension `ctx.runEphemeralTurn`, a side question over the live conversation that does
not add to it, and `ctx.models`, a read-only way to list models and pick one from a different family.
Its advisor, its commit-message generator, and any extension that judges or summarizes are built on
those two.

Acorn already has the call. A loaded node plugin with `permissions.node.core: ["models"]` gets
`ctx.core.models.generateText` and `available`
(`packages/plugin-types/src/contracts/coreMisc.ts`), and core resolves the key or runs the CLI
contained ([integrations.md § Model providers](../../integrations.md#model-providers)). What it
assumes is a person in front of a picker: the caller passes the `backendId` the person picked.

A plugin that reacts to an event has no person and no picker. That leaves three gaps.

1. **Which backend.** The owner's choice for every Generate control, `models.generatePick`, is a
   device preference ([state-ownership.md](../../state-ownership.md)). A node plugin cannot read it,
   and a loaded plugin's prefs are confined to its own namespace. Falling back to `available()[0]`
   quietly spends the first connected key on work nobody asked for in that moment.
2. **How much.** Nothing bounds how often a plugin calls. `generateText` validates the size of one
   call, not the number of calls.
3. **Who spent it.** The result carries `usage`, but nothing records it against the plugin, so the
   owner cannot see that a plugin cost them anything.

Findings already solved all three for itself. It keeps its own saved backend and model from a settings
page, never falls back to another paid backend, and stores the backend, model, and usage on each job
([findings.md](../../findings.md)). That works, and it is a private copy of something every unattended
consumer needs. The advisor in [05](./05-advisor.md) would be the second copy, which is the point to
lift it into the host.

## The design

### A model grant per plugin, held by the host

Add one row per plugin to the owner's settings: a backend id, a model id, and a daily cap. It lives on
the node, because the caller does, beside the plugin's other node-held settings. It is set in
**Settings > Plugins > {plugin}**, in a section the host draws whenever the plugin's manifest holds the
`models` grant.

```ts
// Shape only. Where it lives is a decision for the build.
type PluginModelGrant = {
  pluginId: string
  backendId: string        // connection:<uuid> or harness:<profileId>
  modelId: string          // '' means the backend's default
  dailyOutputTokens: number
}
```

`generateText` gains one optional behaviour: a call with no `backendId` uses the plugin's grant. A
call with no `backendId` and no grant fails with a new `provider_not_configured` error that names the
settings page. It never falls back. A call that names a `backendId` keeps working as it does, so the
picker path every shipped plugin uses does not change.

### The cap

Count output tokens per plugin per day from the `usage` each result already returns. A harness
backend reports no usage, so count its calls instead, at a fixed estimate the settings page states.
Past the cap, `generateText` fails with `provider_budget_exhausted` until midnight in the node's time
zone, and the plugin's roster row shows why.

Output tokens rather than money, because acorn does not know every connection's price and a harness
backend has no price at all. The agent-cost plugin's price table is a client preference and cannot be
read here.

### The record

Record each call as a telemetry span with the plugin id, backend kind, model id, and token counts,
and keep a per-plugin daily total for the settings page. No prompt or response text, the same rule
the model-provider plugin keeps today.

### Which user

`generateText` needs a `userId`. An event handler has a task id. Resolve the owner through
`ctx.core.identity.active()` on a single-owner node, and check whether that is the same id
`generateText` expects. A team node in the cloud programme will need the task's owner instead; that
waits on [cloud phase 9](../cloud/phases/09-teams.md).

### A side turn over a session

`omp`'s `runEphemeralTurn` sends the whole live conversation. Acorn should not. `agents.reviewInput.v1`
gives a consumer each completed turn's user messages and final assistant message, bounded and
task-authorized, and that is enough for a reviewer. A plugin builds its own prompt from it and calls
`generateText`. No new capability. If a consumer shows it needs tool calls or diffs too, extend
`AgentReviewInput` with bounded fields rather than handing out the event ledger.

## What this does not do

- It does not let a plugin pick a model family relative to the session's model, the way
  `ctx.models.family` does. The owner picks the advisor's model in settings. If they want a different
  family from the session's, they pick one.
- It does not let an agent tool handler spend a credential. That stays refused: the handler runs as a
  task principal, and `principalMayUseProviderCredential` admits only a device or the `service`
  scope. A tool that needs a model call is core's, with a provider hook, as `issue_detail` is.
- It does not stream. `generateText` returns one result.

## Steps

1. Add the grant table and the settings section. Draw it only for plugins with the `models` grant.
2. Teach `createModelService` in `packages/node-core/src/server/core/models.ts` the no-`backendId`
   path, the cap, the two new errors, and the record. Wire the plugin id from the host, never from the
   request.
3. Test: a call with no grant fails without spending, a call over the cap fails, a call naming a
   backend ignores the grant, a harness call counts against the cap.
4. Move Findings onto the grant, or leave it if [memory phase 2](../memory/02-remove-findings.md) is
   about to delete it. Prove the grant with [05](./05-advisor.md).
5. Document the grant in [the manifest § Permissions](../../plugin-authoring/the-manifest.md#permissions)
   beside the `models` token, and the errors in [integrations.md](../../integrations.md#model-providers).

## Verify before building

- `CoreModelService` in `packages/plugin-types/src/contracts/coreMisc.ts` and how the loaded worker
  forwards it.
- How Findings stores its review backend, in `plugins/findings/src/server/runtime.ts`, before copying
  or replacing the pattern.
- What `ctx.core.identity.active()` returns and whether `generateText` takes that value as `userId`.
- Where node-held per-plugin settings already live, so the grant does not become a second store.
