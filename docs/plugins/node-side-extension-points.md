# Node-side extension points

This page covers the Node's many-to-many seam, where one plugin opens a named point and any number of
plugins deliver values into it. It's part of the [plugin reference](../plugins.md). For deciding
before something happens, see [hooks](./hooks.md).

## Node-side extension points

`ctx.extensionPoints` (`node-core/server/pluginHost/extensionPoints.ts`) has three calls:
`declare(point, label)`, `handle(point, entry)`, and `handlers(point)`. They're the same three words
[hooks](./hooks.md) use, because a hook is the same shape asked a different question.

Capabilities have one provider by construction: `ctx.capabilities.provide` throws on a second one.
That's right for a typed function with one owner, and wrong for "many plugins each add a workflow step
kind". Use a capability when there's one right answer, and a point when there are many. Use a hook
when the many are being asked a question: a point collects values, and a hook runs a chain and
returns a verdict.

The rules match the client's:

| | |
| --- | --- |
| The point's name | `<ownerPluginId>:<pointId>`, checked against the declaring plugin |
| The entry's id | `<contributorPluginId>:<entryId>`, minted by the host, so two plugins can use the same entry name |
| Ordering | By `order`, with ties broken on id |
| Duplicates | One plugin filing two entries under one id on one point throws |
| Lifecycle | Points declared and entries filed go when the plugin does |
| Resolution | `handlers()` resolves per call and is never cached. Filing into a point nobody has declared yet is fine, because init order isn't a contract. An undeclared point reads as empty |

The typed id lives in the owner's `contract/`, and it's the only thing a contributor imports:

```ts
// plugins/workflows/src/contract/extensions.ts
export const WORKFLOW_STEP_KIND = extensionPointId<StepKindContribution>('workflows:step-kind')

// the owner, once
ctx.extensionPoints.declare(WORKFLOW_STEP_KIND, 'Workflow step kinds')
for (const entry of ctx.extensionPoints.handlers(WORKFLOW_STEP_KIND)) { /* … */ }

// anyone else
ctx.extensionPoints.handle(WORKFLOW_STEP_KIND, { id: 'request', value: { handler, validate } })
```

A contributor that can't import the owner's `contract/` names the point by its string. That happens
when the import would make the package graph cyclic, as it would for `plugins/terminal`, which the
workflows plugin already depends on. The contributor mirrors the part of the value type it uses in
its own `contract/`, and the owner's tests hold the mirror against the real type.

## Values the host draws

A point's value may carry a description the host draws. A workflow step kind's value is
`{ handler, validate?, describe }`, where `describe` declares the label, icon, description, fields,
and output description. The host renders it on both hosts and applies the field rules first:
`required`, `min`, `max`, and a static select's membership. Then it calls the plugin's own
`validate`. A `GET /catalog` route on the owning plugin answers the whole vocabulary, resolved per
request ([contributed step kinds](../workflows/step-kinds.md#contributed-step-kinds)).

## Functions, not descriptors

Node points carry functions, because nothing crosses a realm boundary between the owner and the
caller. A loaded contributor's functions cross the worker RPC boundary, and the rung-1 argument
applies: this is least privilege for cooperative code, not a sandbox
([the node realm](../security/plugin-node-realm.md)). There's no manifest form for a node point. A
point is declared and filled through `ctx`.

Reach the registry only through `ctx`. A loaded plugin's bundle inlines every `@acorn/*` import it
makes, so a plugin that imported the registry module directly would get a private copy and contribute
into nothing.

## Points that exist

- The workflows plugin declares `workflows:step-kind`, `workflows:policy`, and `workflows:trigger`.
  The HTTP plugin contributes the `http:request` step kind, and neither imports the other's
  implementation ([workflows](../workflows.md)).
- The terminal plugin declares `terminal:launch-context` for plugins that supply agent startup text.
  Memory contributes its standing contract and indexes there. Terminal resolves the handlers on each
  launch and limits delivery before sending text to the terminal. The provider owns the content, and
  terminal owns delivery ([agent launch context](../plugin-authoring/the-node-half.md#contributing-agent-launch-context)).
