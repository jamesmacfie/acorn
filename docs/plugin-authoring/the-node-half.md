# The node half

[Back to plugin authoring](../plugin-authoring.md)

## The node half

The loader resolves `manifest.node` inside the package directory and does
`await import(pathToFileURL(entrypoint).href)` (`server/plugins/loader.ts`). That is the entire mechanism, and
it is why multi-file plain ESM needs no build: Node resolves your relative specifiers itself.

**Relative paths and `node:` builtins only.** A bare specifier — `hono`, `zod`, `drizzle-orm` — has
nothing to resolve against, because an installed package is a bare directory with no `node_modules`.
A compiled package gets away with them only because the builder inlines every one of them into the
bundle.

There is a trap here worth stating plainly: Node's resolution walks *ancestor* directories looking for
`node_modules`, and a development data root sits inside the repository, where ancestors have one. So a
bare specifier can resolve on the machine that wrote it and fail on every machine that installs it,
where the data root is under the user's application-support directory with no `node_modules` anywhere
above it. "It worked in dev" is not evidence here.

The default export must satisfy `asNodePlugin` — a **structural** check, not `instanceof`, because a
separately-compiled bundle's classes are its own:

```js
export default {
  name: '<must equal the manifest id>',   // string, required
  init(ctx) {},                            // function, required, may be async
  ready(ctx) {},                           // optional; runs after every plugin's init
  dispose() {},                            // optional
}
```

`plugin.name` is checked against `manifest.id` and the load fails on a mismatch. The host binds every
namespace from the manifest, so a bundle cannot mount itself under another plugin's prefix by lying;
a mismatch means the package is internally inconsistent, and picking a winner silently is how
squatting starts.

What a loaded plugin's `ctx` does **not** have, whatever the manifest says: `ctx.routes.register`
(Hono), `ctx.tools`, `ctx.contextSections`, `ctx.providers.model`, `ctx.events.channel` and
`ctx.events.streams`. You do not have to keep that list: it is the difference between two types,
`NodePluginContext` and `CompiledNodePluginContext`, so reaching for one of them is an error your
editor shows you (plugins.md § The two contexts, one per tier). A Hono instance cannot cross a process
boundary; a `(Request, PluginRequestContext) => Response` function can, so `ctx.routes.fetch(handler)`
is the door. The host strips the mount before calling you, so a request to
`/v2/p/<id>/greeting` reaches your handler as `/greeting` — the same relative path a mounted router
would see. `ctx.storage`, `ctx.core`, `ctx.schedules`, `ctx.collections`,
`ctx.taskChecks`, `ctx.runs`, `ctx.audit`, `ctx.extensionPoints`, `ctx.hooks`,
`ctx.capabilities` and `ctx.events.send`/`status`/`on` are all present, shaped by the
manifest.

Those registries are owner-bound: the host stamps your plugin id onto whatever you register, so a
schedule, collection, task check, run source or audit verb cannot be filed under another package's
name. Several are also manifest keys, and the host synthesises those declarations through this same
seam, so declare in the manifest by preference — that is the copy the owner reads at install.

Three of them are newer than the rest and worth naming:

- **`ctx.runs`** — one call, `register({ runs })`, pointing at a `GET` on your own namespace that
  answers `{ runs }`. Register it if your plugin owns work that starts, takes time and ends; core
  merges every plugin's answer into Settings → Runs. You keep your own table and your own surfaces.
- **`ctx.audit`** — `declare({ id, label })` and `record(action, entry?)`. Declare your verbs in
  `contributions.auditActions` by preference; the host qualifies each as `<yourId>:<action>` and
  refuses a `record` naming one you did not declare. Record what a person reviewing this machine would
  want to see and could not otherwise: work done unattended, money spent, something leaving the node.
  Not every call your plugin makes.
- **`ctx.extensionPoints`** — the node's many-to-many seam. `declare` a point in your own namespace,
  `handle` anyone's, `handlers` to read your own — the same three words `ctx.hooks` uses, because it is
  the same shape asked a different question. Reach for a capability when there is one right answer and a
  point when there are many. See
  [plugins.md](../plugins.md) § Node-side extension points.

**Node actions and harnesses have no `ctx` member at all.** The manifest is the only way in — a command
whose verb is `runNodeAction`, and `contributions.harnesses` — and the host registers them for you
through a shape a plugin never sees. They were on the authoring context until 2026-08-27; every seam a
plugin could not usefully call was one more member to read past.

### Telemetry and logging

`ctx.log` is a logger with your plugin id already bound:

```js
export function init(ctx) {
  ctx.log.info('refresh scheduled', { every: 300 })
  ctx.log.warn('upstream rate limited', { retryAfter: 30 })
}
```

Each call writes a stderr line prefixed with your id, as `console.error` did, and when the owner has
telemetry on it also becomes a log record with `owner: <your id>`. Attributes are scalars; an object
is refused at the type level. Messages pass a scrubber.

This member was removed on 2026-08-27 for being interchangeable with `console`, and it is back
because it is not any more: the attribution, the sinks and the scrubbing are all things a
hand-prefixed `console.error` cannot give you.

`ctx.telemetry` carries the small verbs:

```js
ctx.telemetry.event('cache-miss', { resource: 'issues' })
ctx.telemetry.count('items-synced', items.length)
ctx.telemetry.gauge('queue-depth', queue.length)
ctx.telemetry.error({ name: 'UpstreamError', message: reason, handled: true })
```

To time your own work:

```js
const result = await ctx.telemetry.measure('fetch-issues', () => fetchIssues(connection))
```

`measure` hands back the wrapped value untouched and records a histogram sample. It is promise-aware
and times to settlement. For work whose start and end do not fit one closure:

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

Neither member needs a permission, because measuring your own work reads nobody else's. The owner on
every record is bound by the host from your plugin id, so you cannot file one under another
package's name, and an `owner` attribute you set is dropped.

Every verb is a no-op when the owner has telemetry off, and every verb is wrapped so a full buffer
or a throwing sink cannot reach your code. You get a lot for free without calling any of them: the
host already times and stamps your routes, your schedules, your hook handlers and every dispatch it
makes on your behalf.

Reading the stream is a different thing and a real grant. See § Permissions.

#### When there is no `ctx` in reach

Two places have no context to bind: a module that runs before or beside `init`, such as a route
factory or an engine, and your client half, whose context is contribution points and nothing else.
Both state the id instead of having it bound:

```ts
import { createLogger } from '@acorn/plugin-api/node'      // or '@acorn/plugin-api/client'
import { telemetryFor } from '@acorn/plugin-api/client'

const log = createLogger('github', 'github')               // tag, then your plugin id
const telemetry = telemetryFor('github')                   // the same core verbs, client-side
```

The client projection also has `startRenderTransition(operation, attrs?)`. Call it immediately
before a deliberate signal write when the browser work caused by that write is part of a user
interaction. It emits one `ui.render` child span through two frame opportunities and is inert when
there is no open interaction; do not put it on streaming updates, pointer moves, or component bodies.
Attributes stay content-free and scalar, with workload sizes as numbers.

`createLogger` takes the tag you were already writing by hand, so `[github] pruned 3 rows` reads
the same and gains an owner. `describeError(error).message` beside it turns a caught `unknown` into
one scrubbed line, because a logger takes scalars and not objects.

This is the compiled tier's bargain: your code is in acorn's own process, so the id is a convention
here rather than a wall. A loaded plugin's node half has `ctx.log` and does not need either.

#### In tests

`makeTestNodeContext` from `@acorn/plugin-api/testkit` records what your plugin emitted, so a test
asserts on telemetry with no sink of its own:

```ts
const ctx = makeTestNodeContext({ plugin: { name: 'github' } })
ctx.telemetry.startSpan('reindex').end('error')
expect(ctx.recorded.filter((record) => record.kind === 'span')).toMatchObject([{ name: 'reindex', status: 'error' }])
ctx.cleanup()
```

`ctx.recorded` is every record the node built since the context was made, newest last, flushed on
read so an assertion sees what the line above it did. A span appears once it has ended, and the
attributes it ended with are merged into the ones it opened with. `attrs.owner` says whose a record
is: the recorder is an ordinary sink, so it sees the host's records about your plugin as well as
your own. `cleanup()` drops it with the rest of your registrations.


## The client half

There are two ways for your bundle to draw, and the choice is one line in your package config.

**A tree** is the one to reach for. Your code runs in a Web Worker with no DOM and emits a tree of
acorn's own component names; the host mounts its own components for them. What the reader gets has the
shell's focus behaviour, keyboard handling, ARIA and appearance pack, none of which an iframe can
borrow — and you ship no stylesheet, because you never name a pixel. The four loaded plugins acorn
ships (`http`, `database`, `linear`, `rollbar`) all draw this way.

**A frame** is an iframe with your own document in it. It survives for surfaces that own their pixels —
a canvas, a chart library, a rich editor — and it is priced honestly: DOM-only, no focus or key
handling from the host, and a stylesheet of your own to keep in step. See
[Appendix: the frame path](installing-a-hand-written-package.md#appendix-the-frame-path).

### Drawing a tree

The builder points your JSX preset at the remote adapter, so every element and property in your
components compiles into acorn's tree instead of into a document. Your config names the entry and
nothing else:

```js
// acorn-plugin.config.mjs
client: { entry: './src/tree/index.tsx' }
```

```tsx
import { mountTree } from '@acorn/plugin-api/ui/sdk'
import { Button, Heading, Stack, Text, solidTree } from '@acorn/plugin-api/ui/tree'

function IssuePane(props: { taskId?: string; bridge: AcornBridge }) {
  return (
    <Stack gap="section">
      <Heading level={1} eyebrow="ENG-4102">Retries never back off</Heading>
      <Text tone="muted">Opened 3d ago</Text>
      <Button onPress={() => void props.bridge.ui.toast('hello')}>Say hello</Button>
    </Stack>
  )
}

mountTree({ pane: solidTree(IssuePane) })
```

The manifest says which renderer fills which region. A surface that draws a tree names a `layout` and
fills its `regions`; `single` is the trivial one, for a surface that is one tree:

```json
{ "target": "pane", "id": "issues", "label": "Issues",
  "layout": "single", "regions": { "body": { "kind": "remote", "entry": "pane" } } }
```

A pane may name any layout ([docs/panes.md](../panes.md) § Layout model). A reference panel and a
settings page name `single` and nothing else, because the host already draws everything around them.
All three have to name one: a surface that wants its own pixels says `"regions": { "body": "frame" }`,
and there is no way to leave the layout out and mean the same thing.

**Four rules follow from the tree being data on a message port**, and each one is checked on arrival
rather than trusted:

- **Only acorn's components.** Every node name is one the host knows; anything else draws a labelled
  placeholder and records a row on your plugin's page, which is the forward-compatibility rule applied
  to nodes. `class`, `style`, `innerHTML` and `ref` never cross.
- **Only acorn's events.** A function survives as a prop only under one of eleven names: `onPress`,
  `onChange`, `onSubmit`, `onSelect`, `onActivate`, `onToggle`, `onOpenChange`, `onExpand`,
  `onDismiss`, `onPick`, `onRemove`. A raw key, pointer or paste handler is dropped — a terminal host
  has none of them, and every one of the eleven maps onto a key there.
- **No element in a prop, and no callback in one.** A prop is JSON. A component that takes a JSX prop
  in the shell takes data over the wire instead: `Facts` takes strings, `Picker` takes `items`, and a
  split is a `ListDetail` with `ListColumn` and `DetailColumn` children.
- **Text fields commit rather than stream.** `Input`, `Textarea` and `Composer` are host-owned: you
  get the value on blur, on Enter (`onSubmit`), or on submit, never per keystroke. Per-keystroke UI
  over a message port is a hop per key, and the kit refuses to send one.

**Your subject comes from the mount props, not from `bridge.context`.** One worker serves every tree
your bundle draws, so it holds one bridge and one context; the props are per slot and always current.
A pane tree is mounted with `{ taskId, projectId }`, a project pane and a reference panel with
`{ item }`. `bridge.onSelect` and `bridge.onSurfaceAction` reach you exactly as they reach a frame.

#### Asking the host for something

Props are data, so a tree that fills somebody else's slot cannot change what it is drawing and cannot
open a rectangle. Two methods on the mount cover both, and they are on the mount rather than the bridge
for the reason above: one bridge per bundle could not say which of your four mounted previews asked.

```tsx
mountTree({
  // `solidTree` puts `host` on your props beside `bridge`. Both are stable for the mount's life, so a
  // handler that is mid-await when the owner sends new props is still holding the right one.
  attachmentPreview: solidTree((props) => (
    <Button onPress={async () => {
      const result = await props.host.openOverlay('editor', { taskId: props.taskId, attachmentId: props.attachment.id })
      if (!result) return                       // dismissed; nothing happened
      await props.host.invoke('replace', { expectedAttachmentId: props.attachment.id, ...result })
    }}>Edit {props.attachment.filename}</Button>
  )),
})
```

Writing the renderer by hand instead of through `solidTree`? It is the second argument, `mount.host`.

`host.invoke(action, payload)` calls an action the owning point declared and the owner bound to that
exact slot. You learn the names from the owner's published `actions` list; anything else is refused.
The owner decides whether to do it, so handle a rejection.

`host.openOverlay(overlayId, input)` presents the one overlay your extension descriptor associated:

```json
{ "id": "image-attachment", "point": "agents:attachment", "label": "Image markup",
  "remote": "attachmentPreview", "matches": ["image/png", "image/jpeg"], "overlay": "editor" }
```

That overlay must be a `frame` in your own manifest with `"target": "overlay"`, and naming it here is
what opens it — you do not also need a command. Inside it, `bridge.context.input` is what you passed,
and `bridge.ui.close(result)` resolves the call. Every dismissal resolves it with `null` instead, so
check for that before acting.

Three things will refuse you, all deliberate. Call `openOverlay` from a press or key handler: the host
honours it only while focus is inside your tree, and at most once a second. Keep payloads, inputs and
results under 64 KiB and made of JSON — pass an id and fetch the bytes over your own route with
`bridge.api.getBytes`. And catch `unsupported_host`: the terminal draws trees and has no iframe to put
an overlay in, so leave your static preview up there rather than showing a control that cannot work.

### Reaching the bridge

In-repo bundles import `connect()`, `mountFrame()` and `mountTree()` from `@acorn/plugin-api/ui/sdk`,
and the tree path's nodes and `solidTree()` from `@acorn/plugin-api/ui/tree`. **A hand-written
`client.js` cannot.** That is a bare specifier with no bundler to resolve it, and the origin would have
nowhere to serve the resolved file from even if there were. Copying the SDK's source in is not an
option either: `packages/client-core/src/host/frames/sdk.ts` is TypeScript and imports from
`@acorn/protocol`, so it has the same problem one level down.

There are two answers, and which one you want is decided by a question this profile otherwise never
asks you: **do you have a bundler?**

**If you do** — and you may; nothing here forbids it, the rule is that the *output* is one file —
`npm install acorn-plugin-sdk` and import `connect`, `mountFrame`, `mountTree`, `openLinkOnClick` and
the `AcornBridge` type from it, plus `acorn-plugin-sdk/remote` for the tree path's nodes and its Solid
adapter. It is the same code in-repo frames import, published from
`packages/plugin-sdk`, framework-free and dependency-free, and bundling it into your one `client.js`
satisfies the single-file rule exactly as your own modules do. Your node half still may not use bare
specifiers unless you bundle that too. What you get over the copy below is the typed surface and the
parts that are easy to get subtly wrong — abort signals, key-claim narrowing, the subscribe bookkeeping,
`mountFrame`'s failure rendering.

**If you do not**, which is the profile this document is about: **inline the handshake yourself.** It is
about thirty lines, the protocol is versioned, and `npm create acorn-plugin` writes a working copy of it
for you. Read `sdk.ts` for the semantics; it stays the reference implementation even when you are
not importing it.

The sequence (`packages/protocol/src/plugin/bridge.ts`):

1. The host posts `{ acornBridge: 1 }` into your window with a `MessagePort` transferred alongside.
   `1` is `PLUGIN_BRIDGE_VERSION`; a future protocol change is a different number rather than a
   silently mis-parsed message. There is no origin check to get wrong — a message with no port is not
   the handshake, and the port is unforgeable.
2. You take `event.ports[0]`, set `onmessage`, and call `port.start()`.
3. The host sends `{ kind: 'ready', context }`. `context` is a **snapshot**, not reactive: `surface`,
   `target`, `nodeId`, and — depending on the surface — `taskId`, `projectId`, `refId`, `item`,
   `input`, `theme`, `style`, `claimsKeys`. `input` is overlay-only and is what the remote tree that
   opened this overlay passed; it is the only thing the frame is told about who opened it.
4. **You must post something back.** The host arms a 10-second deadline when it transfers the port and
   replaces the frame with a labelled "This plugin's UI failed to start" placeholder if nothing
   arrives, because a bundle that throws at module scope otherwise renders a blank rectangle and
   reports nothing. `{ kind: 'connected' }` is the canonical ack; any message counts.

Requests are `{ id, kind, ... }` with an id you increment; replies are `{ id, ok: true, status, body }`
or `{ id, ok: false, error: { code, message, requestId, retryable } }`. The failure arm is the same
envelope every HTTP route returns, so you handle one error shape whether the call was denied at the
bridge or refused by the node.

Two host→frame pushes have no request behind them. `{ kind: 'appearance', theme, style, tokens }`
arrives on connect and on every appearance change; **apply it or your frame renders unthemed** — set
`data-theme` and `data-style` on `documentElement` and write each token as a CSS custom property on
it, which is what makes the host's `/ui.css` classes and your own `var(--bg)` rules resolve. The SDK
does this for you and a hand-written frame must not forget it. `{ kind: 'select', item }` is every rail
selection after the one that opened the pane, and `{ kind: 'surfaceAction', command }` is a command
the host resolved on your behalf.

Three messages carry no id and get no reply: `{ kind: 'connected' }`, `{ kind: 'keydown', chord }`,
and `{ kind: 'telemetry', record }`. The host acts on them and says nothing back.

Two budgets apply to the port, and tripping either kills it and swaps in a "plugin misbehaving"
placeholder: 100 requests in flight, and 1000 messages per 10 seconds. Telemetry counts against
them like everything else, which is deliberate: a frame that emits in a render loop loses its port
before it floods the collector.

#### Telemetry from a frame

Your frame reports through the same six verbs your node half has, plus a log line:

```js
bridge.telemetry.event('cache-miss', { resource: 'issues' })
bridge.telemetry.count('rows-drawn', rows.length)
const chart = await bridge.telemetry.measure('draw-chart', () => draw(rows))
bridge.log.warn('upstream is slow', { retryAfter: 30 })
```

`measure` returns the measured callback result and preserves its asynchronous behavior. Telemetry
submission does not report whether collection is enabled. Collection is off by default. That is the one rule telemetry has, that it never fails the thing it describes. A
log line also prints to your frame's own console, so it says something either way.

You never pass a plugin id. The host stamps the owner from your frame's binding, mints the trace
and span ids, and drops a record it cannot read rather than answering it
([telemetry.md](../telemetry.md) § A frame's own records). A hand-written frame sends the message
itself: `{ kind: 'telemetry', record: { type: 'event', name: 'cache-miss' } }`, where `type` is one
of `event`, `count`, `gauge`, `span`, `log` or `error`, attributes are scalars, and a span carries
`durationMs` because it arrives finished.

### What the bridge carries

The verb set, as the SDK's `AcornBridge` type names it — a hand-written client is sending the same
messages by hand:

| Surface | Verbs |
| --- | --- |
| `context` | The `ready` snapshot. |
| `api` | `get`, `post`, `put`, `patch`, `del` — five, matching `PluginBridgeApiRequest.method` exactly. A method missing from the facade is a method no plugin can reach, however permissive the scope table underneath. |
| `api.getBytes` / `api.postBytes` | The same call for a route whose body is bytes, on its own wire kind `api.bytes`. GET and POST, capped at 12 MiB each way, with an advisory `type` and `filename`. Reach for it instead of base64 whenever you are moving a file: the JSON verbs stringify everything, which costs a third more on the wire and a decode at each end. The path decision is identical, and another plugin's namespace is refused before the body is read. |
| `events.on` | Subscribe to a channel the manifest declared: one of the shell's four, or your own `plugin:<your-id>:<verb>`. The payload is whatever your node half put on the frame beside `channel`. |
| `state.get` / `state.set` | Durable storage keyed `(pluginId, key)` by the host, capped at 1 MiB per value. The same `plugin:<id>:*` namespace your node half's `prefs` facet is projected into — this is the supported node-half↔frame state channel. Distinct from the frame's own `localStorage`, which works but is keyed by bundle hash and so rotates with every update. |
| `ui.toast` / `ui.copy` / `ui.openPane` / `ui.openUrl` / `ui.done` / `ui.close` | The closed effect set. `openUrl` is `https` only, honoured only while the frame holds focus and at most once per second, and you learn nothing back. `done` is importer-only; `close` is importers and overlays. An overlay a remote tree opened as its companion may pass `close` a JSON result under 64 KiB, which is what resolves that tree's `openOverlay` call; an importer supplying one is refused. |
| `document.read` / `write` / `flush` | Only from a pane whose layout puts a document region beside your region. Nothing about the *editor* crosses — no cursor, no selection, no decorations. |
| `webview.*` | `navigate`, `back`, `forward`, `reload`, plus navigation and blocked events. Controller-only: you cannot read the page or type into it. |
| `keys.claim` | Narrow the manifest's declared chord set at runtime. It can never widen it. |
| `telemetry.event` / `count` / `gauge` / `error` / `measure` / `startSpan`, and `log.debug` / `info` / `warn` / `error` | One record about your own frame, on the wire kind `telemetry`. No id, no reply, and no plugin id to pass: the host stamps the owner from the binding. See § Telemetry from a frame. |

## Storage and migrations

A table-owning plugin ships a Drizzle chain **inside its package** and names it in the manifest. The
host — never the plugin — opens the database and applies the chain at `ctx.storage.open()`
(`server/plugins/storage.ts`, `openPluginDb`), so a plugin never picks a database path or discovers a chain by
filesystem proximity. The file is `<dataRoot>/plugins/<id>.sqlite`, and the handle you get back is a
drizzle handle with `batch` and `close`.

The chain must be a real chain: `pluginMigrationsChain` requires `meta/_journal.json` in the declared
directory, because a directory without a journal silently applies nothing, and a plugin that opens
storage while declaring no `migrations` gets a thrown `PluginMigrationsError` rather than an empty
database. A journal is small enough to write by hand:

```json
{
  "version": "7",
  "dialect": "sqlite",
  "entries": [
    { "idx": 0, "version": "6", "when": 1786177106101, "tag": "0000_init", "breakpoints": true }
  ]
}
```

with `0000_init.sql` beside it holding the DDL. A broken chain fails **contained** — that plugin ends
up `failed`, the node boots, other plugins are untouched.
