# Plugin authoring: what an author sees at each level of effort

Part of [docs/future/telemetry/](./README.md). The design goal is that a plugin author who never
thinks about telemetry is already well served, and each step up costs one line.

## Level 0: do nothing

The host times and stamps everything it dispatches on a plugin's behalf, because the host is the one
place that knows which plugin it is dispatching to:

- Routes. A loaded plugin's fetch handler and a compiled plugin's Hono router are both reached under
  `/v2/p/<id>/`, so the request middleware's span already carries `owner: <id>`.
- Schedules, hooks, task checks, collections, and run sources go through `dispatchPluginRoute`,
  which spans each call with the plugin's id.
- Hook handlers get a `hook.run` span each, with the point, the handler, and the outcome.
- Frames get a `frame.boot` span from mount to handshake, and a histogram of bridge messages by kind.
- Remote trees get a histogram of applied batches.
- Channel frames on `plugin:<id>:*` are counted per plugin.
- A contribution that throws while rendering produces an error record naming the plugin and the
  contribution.
- A pane region contributed by the plugin gets a `pane.region` span from creation to content.

None of that needs a manifest entry. The trust prompt does not mention it, because the plugin is not
reading anything; the host is measuring itself.

## Level 1: log and count

`ctx.log` is a logger with the plugin id already bound:

```ts
export function init(ctx: NodePluginContext) {
  ctx.log.info('refresh scheduled', { every: 300 })
  ctx.log.warn('upstream rate limited', { retryAfter: 30 })
}
```

Each call writes a stderr line prefixed with the plugin id, as `console` would, and when telemetry is
on it also becomes a log record with `owner: <id>` and `logger: <id>`. Attributes are scalars; an
object is refused at the type level. Messages pass the scrubber.

`ctx.telemetry` carries the small verbs:

```ts
ctx.telemetry.event('cache-miss', { resource: 'issues' })
ctx.telemetry.count('items-synced', items.length)
ctx.telemetry.gauge('queue-depth', queue.length)
ctx.telemetry.error({ name: 'UpstreamError', message: scrubbed, level: 'error', handled: true })
```

## Level 2: time your own work

```ts
const result = await ctx.telemetry.measure('fetch-issues', () => fetchIssues(connection))
```

`measure` returns the wrapped value untouched and records a histogram sample, promise-aware. For a
span with a start and end that do not fit one closure:

```ts
const span = ctx.telemetry.startSpan('reindex', { attrs: { pages: total } })
try { await reindex() ; span.end('ok') } catch (error) { span.end('error'); throw error }
```

Every verb is a no-op when telemetry is off, and every verb is wrapped so that a full ring or a
throwing sink cannot reach the plugin's code.

## Inside a frame or a worker

A frame has no `ctx`. Phase 4 adds one bridge verb, `telemetry`, to the sandbox SDK
(`packages/client-core/src/host/frames/sdk.ts`), taking the same record shapes minus the owner, which
the host stamps from the binding. The bridge's existing rate window applies, so a frame that emits in
a loop kills itself before it floods the collector. Compiled client plugins import `telemetry` from
`@acorn/plugin-api/client` and pass their plugin id, which `makeContext` has already checked.

## Level 3: write a sink

A plugin that wants to read the stream declares one token and subscribes:

```json
{ "permissions": { "node": { "core": ["telemetry"] } } }
```

```ts
export function init(ctx: NodePluginContext) {
  ctx.core.telemetry.onBatch((batch) => queue.push(batch))
}
```

The trust prompt renders that token as high, with the text "Read this node's telemetry: request
timings, schedule and hook runs, logs, and error names from every plugin". A sink sees everything
from every owner, which is why it is a token and not a default. The sink's `Disposable` is returned
so a reload can drop it; the host also clears sinks for a plugin whose registrations it rolls back.

A sink must return quickly. The collector calls sinks in order on a timer, awaits none of them, and
contains a throw or a rejection. Buffering and retry are the sink's job.

## In tests

`makeTestNodeContext` from `@acorn/plugin-api/testkit` gets a recording telemetry in phase 4:
`ctx.telemetry` and `ctx.log` write to an array the test can read, and `ctx.core.telemetry` is present
when the test's permissions name the token. A plugin test can assert "this route produced one span
named `plugin.dispatch` with status `error`" without a sink.

## What the docs say

`docs/plugin-authoring.md` § The node half gains a "Telemetry and logging" subsection with the
examples above; § Permissions gains the `telemetry` token with the trust text. `docs/plugin-map.md`
§ The node API gains the two `ctx` members and the core facet. `docs/plugins.md` § Activation
replaces the "there is no `ctx.log`" paragraph with the reversal and its reason. The
`plugin_authoring` agent tool answers from `NODE_CORE_FACETS`, so it learns the token for free.
