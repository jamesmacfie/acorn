# Keeping a descriptor fresh

This page covers how a plugin tells the host to read its descriptors again, how it raises a
notification, and its own live channel. It's part of the [plugin reference](../plugins.md).

## Keeping a descriptor fresh

A descriptor's data comes from a route on the plugin's node half, so something has to say when to read
it again. There are three answers, and they aren't interchangeable:

- **A declared `refresh`** is the fallback: seconds, at least 30 and at most a day. A descriptor read
  is one HTTP call per Node, and one interval serves every plugin's chrome at the lowest declared
  value, so a short interval would spend every other plugin's budget too. Declare it for data that
  changes with nothing to trigger on.
- **`ctx.events.status()`** means "read my descriptors again". The host binds it to the calling
  plugin's id, so it refetches that plugin's rail rows, badges, and agent contexts on every connected
  client, and nobody else's. Use it after an action, not on a timer. `bumpChrome` in
  `packages/client-core/src/host/chrome/chromeData.ts` keeps one revision per plugin.
- **The plugin's own channel** is the fast path when data streams. See [the live
  channel](#the-live-channel).

## Raising a notification

`ctx.events.notice({ taskId?, title, detail?, kind?, target? })` puts a row in the owner's bell. Both
tiers have it, and it's core's, so it works with every other plugin disabled.

Leave out `taskId` for something about the Node instead of one task, such as an expired connection. A
compiled plugin names a `target` and registers a client handler for its `kind` with
`registerNoticeTargetHandler`, so the row opens the right thing. A loaded plugin's `target` and `kind`
are dropped by default, and the host lands the row on that plugin's own rail source, or on the
Settings page that lists it. A loaded frame may declare a cooperative destination with a target kind
and an optional notice kind. The host keeps a matching target and strips every undeclared pair.

[Notification rows and targets](../notifications/rows-and-targets.md#what-a-row-points-at) explains
targets and which kinds exist. Use an attention contribution instead for a lasting condition the
owner has to resolve.

## The live channel

A loaded plugin owns the WebSocket channel namespace `plugin:<its-id>:*`. Its node half broadcasts on
it with `ctx.events.send`, its own frames subscribe by naming the channel in `permissions.events`, and
each frame that arrives also refreshes that plugin's descriptors:

```js
// node half
ctx.events.send({ channel: `plugin:${ID}:sample`, cpu: 0.34, memory: 0.81 })
```

```js
// its frame
bridge.events.on(`plugin:${ID}:sample`, (sample) => paint(sample))
```

A compiled client half hears the same channel through `onPluginFrame(pluginId, channel, listener)`
from `@acorn/plugin-api/client`. The returned disposable belongs to the model or component that
subscribed. GitHub's pull model uses it to replace a stale detail after `plugin:github:pr-synced`.

Everything on the frame beside `channel` is the payload, delivered unchanged. Core reads only the
channel (`@acorn/protocol/ws.ts`). First-party plugins use the channel to announce that state they own
has changed. Payloads carry state to read again, never a delta. [Events](./events.md#hearing-another-plugin)
lists the shipped verbs and how another plugin's node half subscribes.

Four properties to know:

- **`send` is confined to the namespace.** A loaded plugin naming another prefix gets a throw. A
  compiled plugin owns real prefixes through `ctx.events.channel`.
- **A loaded plugin can't claim a prefix.** Core claims the `plugin` prefix for every loaded plugin
  and routes by the id inside the name (`client-core/host/plugins/pluginChannel.ts`).
- **Frames get every frame, and chrome gets a coalesced one.** A subscribed frame receives each
  broadcast and pays through the bridge's message budget. Chrome is refreshed at most twice a second
  per plugin.
- **`nodeStats` doesn't take part.** Fleet home reads it through a fan-out, so it refetches when the
  fleet list changes and not otherwise.

A frame may subscribe to another plugin's channel only when that plugin declares the verb in `emits`.
The trust prompt draws one host-owned sentence per producer, never the verb the manifest named.
