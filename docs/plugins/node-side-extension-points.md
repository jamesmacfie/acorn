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

## Disclosed points

A few points spend something of the person's, so a loaded plugin needs their consent before it may
join one. `DISCLOSED_NODE_POINTS` in `@acorn/protocol/extensionPoints.ts` lists them, each with the
host's fixed trust-prompt sentence. To join one, a loaded package names the point in its manifest's
`extensions` with no carrier, and then files the entry through `ctx`. The trust prompt draws the fixed
sentence, marked high, whatever the manifest's label says. `ctx.extensionPoints.handle` throws for a
loaded plugin that files into a disclosed point its manifest didn't name. A built-in plugin isn't
checked. The disclosed points are `agents:session-messenger` and `agents:turn-follow-up`.

An owner that hands a contributor something to keep, such as a sender, passes it to a function on the
entry's value. A loaded contributor's function runs in its worker, and anything it's given crosses
back as an asynchronous function, so the contributor can call it after the first call returned.

## Points that exist

- The workflows plugin declares `workflows:step-kind` and `workflows:policy`. The HTTP plugin
  contributes the `http:request` step kind, and neither imports the other's implementation
  ([workflows](../workflows.md)).
- The terminal plugin declares `terminal:launch-context` for plugins that supply agent startup text.
  Memory contributes its standing contract and indexes there. Terminal resolves the handlers on each
  launch and limits delivery before sending text to the terminal. The provider owns the content, and
  terminal owns delivery ([agent launch context](../plugin-authoring/the-node-half.md#contributing-agent-launch-context)).
- The agents plugin declares `agents:session-messenger`. Each entry's `connect` receives a sender
  bound to the contributor's plugin id, and the sender queues an attributed note on an interactive
  session. Agents connects entries when every plugin has started and after each roster change, and a
  sender fails once its entry is gone ([session messages](../managed-agents/session-messages.md)).
- The agents plugin declares `agents:turn-follow-up`. A workflow step or a delegated turn calls each
  entry's `review` with a window over its finished turn, and waits up to 30 seconds before it reports.
  The window's `signal` is an `AbortSignal` the owner aborts at close, and it crosses the loaded worker
  ([unattended follow-ups](../managed-agents/unattended-follow-ups.md)).

## Hooks inside a harness's loop

Agents' `agents:before-permission` hook sees only the permission requests a harness sends acorn, on
every harness ([permission policy](../managed-agents/permission-policy.md)). Two more of agents' hooks
reach inside a harness's own loop rather than an edge acorn owns.
`agents:before-tool` and `agents:after-tool` run on every tool call a bridged harness makes, through a
command hook acorn installs in that harness. Only Claude Code has a bridge. A handler registered while
a session runs reaches it after the session's next resume, because the bridge is installed at start
and resume, and only for a point with a handler ([harness bridges](../managed-agents/loop-hooks.md)).
