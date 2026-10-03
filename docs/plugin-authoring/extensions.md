# Extensions

This page covers the two manifest keys that cross plugins: `extensionPoints`, where you open a place
in your surface to others, and `extensions`, where you fill someone else's. It includes a complete
task-annotation example. It's part of [the manifest](./the-manifest.md).

## Extension points and extensions

`extensionPoints` and `extensions` are two halves of one thing. Both are manifest keys, both appear in
the trust prompt, and there's no third way: nothing lets you touch a plugin that didn't declare a
point, and nothing lets your code run in another plugin's realm.

An `extensionPoints` entry is `{ id, label, kind, … }`. `kind` picks which of five kinds the point
takes and which other fields it reads ([cooperative extension
points](../plugins/cooperative-extension-points.md)):

- `rows` and `annotation` take a `location` or a `key`. You write no code for them, because the host
  draws them.
- `remote` and `rectangle` take a `mode`.
- `hook` takes a `payload` and an `allows` list.

The host mints the id as `<yourId>:<pointId>`.

An `extensions` entry is `{ id, point, label, order?, … }`. `point` is `<ownerPluginId>:<pointId>`, and
naming the owner is the disclosure. Exactly one carrier says what you bring:

- `items` is a route on your own namespace, read with GET for rows and POST for annotations.
- `remote` is a key of the object your bundle passed to `mountTree`, for a tree.
- `frame` is an `inline` surface of yours, for a rectangle.
- `route` is a POST on your own namespace, for a hook handler.

`items` and `route` need a `node` entry, because only the node half serves them. `remote` and `frame`
need a client bundle. `matches` narrows a tree or a rectangle to the key values it draws, and
`onSelect` takes the narrow verb set. A `remote` extension may name one `overlay` of your own
([companion overlays](../plugins/remote-points.md#companion-overlays)).

For rows, your `items` route answers `{ items: [{ id, title, subtitle?, icon?, badge? }] }`. The host
draws those rows with its own components and stamps your plugin id beside them, and your `onSelect`
receives the clicked row's id. A contribution to a point that isn't there, because the owner isn't
installed, is disabled, or dropped the point, delivers nothing. That's the designed outcome, not a
failure to chase.

Call the `plugin_authoring` agent tool for the current location list.

## Add task annotations

Use the core-owned `core:task` annotation point to publish task status on task rows. This complete
manifest has a node entry and one route-backed extension:

```json
{
  "id": "deploy-status",
  "name": "Deploy status",
  "version": "1.0.0",
  "baseline": "acorn-1",
  "apiVersion": "3",
  "node": "./node.js",
  "contributions": {
    "extensions": [
      {
        "id": "task-deployments",
        "point": "core:task",
        "label": "Deployments",
        "items": "/v1/p/deploy-status/task-annotations"
      }
    ]
  }
}
```

The node route receives the visible task ids in one POST. Return marks only for keys you know:

```js
const deployments = new Map([
  ['task-123', { failed: false }],
  ['task-456', { failed: true }],
])

export default {
  name: 'deploy-status',
  init(ctx) {
    ctx.routes.fetch(async (request) => {
      const url = new URL(request.url)
      if (request.method !== 'POST' || url.pathname !== '/task-annotations') {
        return new Response('Not found', { status: 404 })
      }

      const body = await request.json()
      const keys = Array.isArray(body.keys) ? body.keys : []
      const items = keys.flatMap((key) => {
        if (!key || typeof key.task !== 'string') return []
        const deployment = deployments.get(key.task)
        if (!deployment) return []
        return [{
          key: { task: key.task },
          severity: deployment.failed ? 'danger' : 'info',
          text: deployment.failed ? 'Deployment failed' : 'Deployment is live',
          icon: deployment.failed ? 'circle-alert' : 'rocket',
        }]
      })
      return Response.json({ items })
    })
  },
}
```

A `core:task` key has one string field, `task`. A mark holds that key, an `info`, `warn`, or `danger`
severity, text the host caps at 200 characters, and an optional Lucide or `brand:` icon name. It holds
no JSX, CSS, geometry, color, or action. The host stamps your plugin id as provenance, accepts at most
256 valid marks per request, and draws them through its desktop and terminal rail markers. The
transport reads at most 4,096 raw rows first and drops malformed rows one at a time.

For request identity, freshness, cancellation, and failure isolation, see
[task annotations](../plugins/rows-and-annotations.md#task-annotations).
