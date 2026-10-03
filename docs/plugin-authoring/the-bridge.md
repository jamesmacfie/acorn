# The bridge

This page covers the message bridge between a plugin's client code and the host: how to reach it,
the handshake, the verbs it carries, and telemetry from a frame. It's part of
[plugin authoring](../plugin-authoring.md).

## Reaching the bridge

In-repo bundles import `connect()`, `mountFrame()`, and `mountTree()` from `@acorn/plugin-api/ui/sdk`,
and the tree nodes and `solidTree()` from `@acorn/plugin-api/ui/tree`. `connect()` is for a frame. A
tree uses the `bridge` its renderer is mounted with, because the host refuses requests on the bundle's
shared port, which is what `connect()` returns in a worker.

A hand-written `client.js` can't import those, because a bare specifier has no bundler to resolve it
and the origin couldn't serve the resolved file. There are two answers, depending on whether you have
a bundler:

- **With a bundler,** run `npm install acorn-plugin-sdk` and import `connect`, `mountFrame`,
  `mountTree`, `openLinkOnClick`, and the `AcornBridge` type from it, plus `acorn-plugin-sdk/remote`
  for tree nodes and the Solid adapter. It's the same code in-repo bundles use, with no dependencies,
  and bundling it into your one `client.js` satisfies the single-file rule. You get abort signals,
  key-claim narrowing, subscription bookkeeping, and `mountFrame`'s failure banner.
- **Without one,** inline the handshake. It's about 30 lines, the protocol is versioned, and
  `npm create acorn-plugin` writes a working copy. Read the SDK's `connection.ts`, `bridgePort.ts`, and
  `treeChannel.ts` in `packages/client-core/src/host/frames/sdk/` for the semantics.

## The handshake

The sequence is defined in `packages/protocol/src/plugin/bridge.ts`:

1. The host posts `{ acornBridge: 1 }` into your window with a `MessagePort` transferred beside it. `1`
   is `PLUGIN_BRIDGE_VERSION`. A message with no port isn't the handshake, and the port can't be
   forged.
2. You take `event.ports[0]`, set `onmessage`, and call `port.start()`.
3. The host sends `{ kind: 'ready', context }`. `context` is a snapshot, not reactive: `surface`,
   `target`, `nodeId`, and, depending on the surface, `taskId`, `projectId`, `refId`, `item`, `input`,
   `theme`, `style`, and `claimsKeys`. `input` is overlay-only: what the tree that opened the overlay
   passed.
4. You post something back. The host starts a 10-second deadline when it transfers the port and
   replaces the frame with a "This plugin's UI failed to start" placeholder if nothing arrives.
   `{ kind: 'connected' }` is the usual acknowledgement, and any message counts.

Requests are `{ id, kind, ... }` with an id you increment. Replies are
`{ id, ok: true, status, body }` or `{ id, ok: false, error: { code, message, requestId, retryable } }`.
The failure shape is the envelope every HTTP route returns, so you handle one error shape whether the
bridge or the Node refused.

Two host pushes have no request behind them:

- `{ kind: 'appearance', theme, style, tokens }` arrives on connect and on every appearance change.
  Apply it, or your frame renders unthemed: set `data-theme` and `data-style` on `documentElement`
  and write each token as a CSS custom property on it. The SDK does this for you.
- `{ kind: 'select', item }` is every rail selection after the one that opened the pane, and
  `{ kind: 'surfaceAction', command }` is a command the host resolved for you.

Three messages carry no id and get no reply: `{ kind: 'connected' }`, `{ kind: 'keydown', chord }`, and
`{ kind: 'telemetry', record }`.

Two budgets apply to the port, and tripping either closes it and shows a "plugin misbehaving"
placeholder: 100 requests in flight, and 1,000 messages in 10 seconds. Telemetry counts against them,
so a frame that emits in a render loop loses its port before it floods the collector.

## What the bridge carries

The verb set, as the SDK's `AcornBridge` type names it:

| Surface | Verbs |
| --- | --- |
| `context` | The `ready` snapshot |
| `api` | `get`, `post`, `put`, `patch`, and `del`, matching `PluginBridgeApiRequest.method` |
| `api.getBytes`, `api.postBytes` | The same call for a body that's bytes, on its own wire kind, `api.bytes`. GET and POST only, capped at 12 MiB each way, with an advisory `type` and `filename` ([binary bridge calls](../plugins/frames.md#binary-bridge-calls)) |
| `events.on` | A channel the manifest declared: a shell channel, your own `plugin:<your-id>:<verb>`, or another plugin's declared verb ([event channels](./permissions.md#event-channels)) |
| `state.get`, `state.set` | Durable storage the host keys `(pluginId, key)`, at most 1 MiB per value. It's the `plugin:<id>:*` namespace your node half's `prefs` facet reads. A frame's own `localStorage` works but is keyed by bundle hash, so it changes with every update |
| `ui.toast`, `ui.copy`, `ui.openPane`, `ui.openDestination`, `ui.openTask`, `ui.openUrl`, `ui.done`, `ui.close` | The closed effect set. `openDestination` maps a declared destination to a host target, with resource ids of at most 300 characters. `openTask` needs the `core.tasks:read` scope, follows the focus rule and once-a-second budget of `openUrl`, and rejects with `not_found` for a task the list doesn't have. `openUrl` is `https` only, honored only while the frame has focus. `done` is importer-only, and `close` is for importers and overlays. An overlay a tree opened may pass `close` a JSON result under 64 KiB |
| `document.read`, `write`, `flush` | Only from a pane whose layout puts a document region beside yours. No cursor, selection, or decorations cross |
| `webview.*` | `navigate`, `back`, `forward`, and `reload`, plus navigation and blocked events. You can't read the page or type into it |
| `keys.claim` | Narrows the manifest's declared chords at runtime. It can never widen them |
| `telemetry.*`, `log.*` | One record about your own frame, on the wire kind `telemetry`. See below |

### Telemetry from a frame

A frame reports through the same six verbs as a node half, `event`, `count`, `gauge`, `error`,
`measure`, and `startSpan`, plus `log.debug`, `log.info`, `log.warn`, and `log.error`:

```js
bridge.telemetry.event('cache-miss', { resource: 'issues' })
bridge.telemetry.count('rows-drawn', rows.length)
const chart = await bridge.telemetry.measure('draw-chart', () => draw(rows))
bridge.log.warn('upstream is slow', { retryAfter: 30 })
```

`measure` returns the callback's result and keeps its asynchronous behavior. Submitting a record
doesn't tell you whether collection is on, and it's off by default. A log line also prints to your
frame's own console.

You never pass a plugin id. The host stamps the owner from your frame's binding, mints the trace and
span ids, and drops a record it can't read ([plugins and sinks](../telemetry/plugins-and-sinks.md)). A
hand-written frame sends `{ kind: 'telemetry', record: { type: 'event', name: 'cache-miss' } }`, where
`type` is `event`, `count`, `gauge`, `span`, `log`, or `error`, attributes are scalars, and a span
carries `durationMs` because it arrives finished.
