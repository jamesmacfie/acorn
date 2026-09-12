# Events and capabilities

Use events to announce a completed change. Use a capability when a caller needs a result from another
plugin. Both belong to one Node. A client connected to several Nodes must keep each Node's data and
subscriptions separate.

These examples use plugin API major `11`. The node context is declared in
`packages/plugin-types/src/public.ts`; the event vocabulary is in
`packages/protocol/src/nodeEvents.ts`.

## Listen to a core event

Add the event to your manifest's permissions:

```json
{
  "permissions": {
    "events": ["project:changed"]
  }
}
```

Register a listener in your node entrypoint:

```js
export default {
  name: 'project-observer',
  /** @param {import('acorn-plugin-types').NodePluginContext} ctx */
  init(ctx) {
    ctx.events.on('project:changed', (frame) => {
      if (typeof frame.projectId !== 'string') return
      ctx.log.info('Project changed', { projectId: frame.projectId })
    })
  },
}
```

The host disposes the subscription when the plugin unloads. Keep the listener short. If it starts
asynchronous work, catch failures in that work. Events have no replay or delivery guarantee; read
stored state when starting or reconnecting.

## Publish an event for another plugin

A producer called `issue-cache` declares its event in the manifest:

```json
{
  "emits": [
    { "verb": "refreshed", "description": "The cached issue list changed" }
  ]
}
```

After saving the changed data, its node half emits:

```js
ctx.events.send({ channel: 'plugin:issue-cache:refreshed' })
```

The consumer grants the exact channel:

```json
{
  "permissions": {
    "events": ["plugin:issue-cache:refreshed"]
  }
}
```

Subscribe with `ctx.events.on('plugin:issue-cache:refreshed', listener)`. The consumer receives no
notification if the producer is absent. Store durable work in a database rather than treating
notifications as a job queue.

## Provide and call a capability

A provider registers a capability in its own namespace during `init`:

```js
ctx.capabilities.provide('issue-cache.summary', {
  count: () => 0,
})
```

The zero is sample data. Replace it with a read from the provider's own store.
The consumer declares the capability grant and, if required, the provider dependency:

```json
{
  "requires": { "plugins": [{ "id": "issue-cache" }] },
  "permissions": {
    "node": { "capabilities": ["issue-cache.summary"] }
  }
}
```

Share the capability identifier and signature through a public contract. For this example, its
JavaScript declaration is:

```js
/** @typedef {{ count(): number }} IssueSummary */
/** @type {import('acorn-plugin-types').CapabilityId<IssueSummary>} */
const ISSUE_SUMMARY = 'issue-cache.summary'
```

Resolve the capability when handling a request:

```js
ctx.routes.fetch(() => {
  const summary = ctx.capabilities.get(ISSUE_SUMMARY)
  if (!summary) return new Response('Issue cache unavailable', { status: 503 })
  return Response.json({ count: summary.count() })
})
```

`get` returns `undefined` if the capability is unavailable or ungranted. `require` throws instead.
Do not import the provider's implementation or query its SQLite file.

## Choose a portable UI

Use the default `create-acorn-plugin` scaffold for a remote tree without a build step. For a bundled
tree, import the bridge from `acorn-plugin-sdk` and components from `acorn-plugin-sdk/remote`.
The private `@acorn/plugin-api` package is the repository facade, not a third-party runtime dependency.

Shared components and layouts let the desktop and terminal render the same tree. Check host
requirements before using platform operations. Iframe UI and webviews need desktop support;
provide a terminal alternative or omit the unsupported action.

For the full contracts, see [Plugin authoring](../plugin-authoring.md) and
[Contribution kinds](../contribution-kinds.md).
