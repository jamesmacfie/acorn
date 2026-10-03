# Telemetry and logging

This page covers how a plugin logs and measures its own work, on the node half, in compiled client
code, and in tests. It's part of [plugin authoring](../plugin-authoring.md). A frame's telemetry is in
[the bridge](./the-bridge.md#telemetry-from-a-frame).

## Telemetry and logging

`ctx.log` is a logger with your plugin id already bound:

```js
export function init(ctx) {
  ctx.log.info('refresh scheduled', { every: 300 })
  ctx.log.warn('upstream rate limited', { retryAfter: 30 })
}
```

Each call writes a stderr line prefixed with your id, and when the owner has telemetry on, it also
becomes a log record with `owner: <your id>`. Attributes are scalars, and an object is refused at the
type level. Messages pass a scrubber.

`ctx.telemetry` carries the small verbs:

```js
ctx.telemetry.event('cache-miss', { resource: 'issues' })
ctx.telemetry.count('items-synced', items.length)
ctx.telemetry.gauge('queue-depth', queue.length)
ctx.telemetry.error({ name: 'UpstreamError', message: reason, handled: true })
const count = ctx.telemetry.measure('count-issues', () => issues.length)
```

In a loaded Node worker, `measure` accepts a synchronous callback and returns its value at once. The
compiled context also accepts a Promise-returning callback. To time asynchronous work in a loaded
worker, use `startSpan`:

```js
const span = ctx.telemetry.startSpan('reindex', { attrs: { pages: total } })
try {
  await reindex()
  span.end('ok')
} catch (error) {
  span.end('error')
  throw error
}
```

Neither member needs a permission, because measuring your own work reads nobody else's. The host binds
the owner on every record from your plugin id, and drops an `owner` attribute you set. Every verb does
nothing when the owner has telemetry off, and every verb is wrapped, so a full buffer or a throwing
sink can't reach your code. The host already times your routes, schedules, hook handlers, and every
dispatch it makes for you.

A value that's costly to take can ask first, so the work is skipped:

```js
if (ctx.telemetry.enabled()) ctx.telemetry.gauge('processes', (await listProcesses()).length)
```

Reading the stream is a separate grant ([permissions](./permissions.md#telemetry-models-and-data)).

### When there is no ctx in reach

Two places have no context to bind: a module that runs before or beside `init`, such as a route
factory, and a compiled client half. Both state the id instead:

```ts
import { createLogger } from '@acorn/plugin-api/node'      // or '@acorn/plugin-api/client'
import { telemetryFor } from '@acorn/plugin-api/client'

const log = createLogger('github', 'github')               // tag, then your plugin id
const telemetry = telemetryFor('github')                   // the same core verbs, client-side
```

`createLogger` takes the tag you'd write by hand, so `[github] pruned 3 rows` reads the same and gains
an owner. `describeError(error).message` turns a caught `unknown` into one scrubbed line.

The client projection also has `startRenderTransition(operation, attrs?)`. Call it immediately before
a deliberate signal write when the browser work that write causes is part of a user interaction. It
emits one `ui.render` child span and does nothing when no interaction is open. Don't put it on
streaming updates, pointer moves, or component bodies.

This is the compiled tier's bargain: your code is in acorn's process, so the id is a convention, not a
wall. A loaded plugin's node half has `ctx.log` and needs neither.

Asserting on telemetry in a test is in [testing](./testing.md#in-tests). [Plugins and
sinks](../telemetry/plugins-and-sinks.md) covers the collector side.
