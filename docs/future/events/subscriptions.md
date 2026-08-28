# Subscriptions: letting one plugin hear another

Part of [docs/future/events/](./README.md). This is the piece with real design risk, and the one to
build last: it is worth nothing until [core-events.md](./core-events.md) and
[plugin-events.md](./plugin-events.md) have put something on the wire worth hearing.

## What is refused today, by name

Cross-plugin listening is not merely missing; it is denied at every layer, deliberately, with the
same answer routes give:

- **Client, frame tier.** `onPluginFrame` throws when the channel belongs to another plugin
  (`client-core/src/plugins/pluginChannel.ts:94-97`), reached from the frame's `subscribe`
  (`frames/frameServices.ts:94`). The broker separately checks the manifest's `permissions.events`.
- **Node, loaded tier.** `ctx.events.send` throws unless the channel is the plugin's own
  (`node-core/src/server/plugin/context.ts`). The receive side exists since 2026-08-28 but hears only
  core: `ctx.events.on` accepts the channels in `NODE_EVENT_CHANNELS` and nothing under `plugin:`.
- **Node, both tiers.** A plugin's node half reacts to its own routes, its schedule ticks, the core
  events above, and the node-side extension points (`docs/plugins.md § Node-side extension points`,
  which the [layout programme](../layout/08-hooks.md) grows into hooks).

So "other plugins can listen" is one new contract now, the cross-plugin grant below, applied to the
`on` that already exists on the node and the `subscribe` that already exists in a frame.

## The node-side `on`

**Shipped for core events, 2026-08-28**: `ctx.events.on` over `NODE_EVENT_CHANNELS`, disposed with
the plugin. What follows is the argument that produced it and the shape the cross-plugin half reuses.

A plugin's node half subscribing to core events is the half with the most leverage and the least
design risk. The consumer that motivates the whole folder — a CI plugin reacting to HEAD moved by
fetching pipeline state — has no client half in the loop at all: node event in, node fetch out,
mirror written, its own `items-changed` verb emitted. Requiring a mounted frame to relay core events
into a node half would rebuild the renderer-locality defect this folder exists to remove.

Shape: an `on(event, listener)` beside the existing send-side on `PluginBroadcast`, scoped the same
way the send side is — core events by name, subject to a manifest grant, and (once cross-plugin
subscription exists) other plugins' verbs under the same grant vocabulary as the frame side, so
there is one permission model, not two. Disposal follows plugin unload exactly as route registration
does today.

## The cross-plugin grant

Four problems, in the order they bite.

**Discovery.** Core cannot enumerate verbs it never sees — the allowlist admits the namespace by
shape for exactly that reason. A consumer cannot subscribe to a verb it cannot name, and a reviewer
cannot evaluate a grant against a vocabulary that exists only in another plugin's source. The fix is
an `emits` list in the producer's manifest: verb, payload sketch, one-line description. It costs the
producer a declaration it should be making anyway, gives the host something to validate a
subscription against, and gives documentation something to render. An undeclared verb can still be
sent to the plugin's own frames (today's contract, unchanged); only *subscribable-by-others* requires
declaration.

**Trust copy.** Every grant sentence the prompt draws must be host-owned; a verb is manifest text
and never gets interpolated into copy. The own-channel precedent already solves this shape with one
host-owned sentence for the whole namespace. Cross-plugin follows it at the producer grain:
"Receive live updates from the github plugin" — host-owned template, plugin *id* interpolated (an
id is already rendered elsewhere and held to `CHANNEL_PART`), verb never. Per-verb sentences would
be manifest text in the prompt; per-producer sentences are honest and writable.

**Absent producers.** The producer may be uninstalled, disabled, or a loaded plugin that failed
reload. The contract is silence: a subscription to an absent producer delivers nothing, errors
nothing, and starts delivering if the producer appears. This is only tolerable because payloads
carry state and consumers re-read on receipt — a consumer that cannot tolerate "no events, ever"
is polling with extra steps and should keep polling. Whether the subscribe surface *reports*
producer presence (so a consumer can show "github plugin not installed") is a UX question; the
delivery contract itself stays fire-and-forget.

**Payload contracts.** Verbs have no schema and should not grow one — a typed cross-plugin payload
contract is a plugin-to-plugin API, and the place for those is capabilities, which have owners,
types, and a review path. The event contract stays thinner on purpose: the payload is a hint, the
producer's routes are the truth, and a consumer that needs more than "go re-read" is asking for a
capability. Writing this down is what keeps the events surface from becoming an untyped RPC layer.

## What this is not

- **Not a message bus between plugins.** There is no send-to-plugin, no request/reply, no
  addressing. A producer announces state changes to whoever listens; that asymmetry is the design.
- **Not an escape from the tier rules.** Streams stay owned (test: does the payload arrive more
  than about once per human action), components stay out of the wire format, and there is still no
  uncooperative extension — a producer that declares no `emits` has said no, and that answer is
  final.

## Order of work

1. Node-side `on` for core events only. Unblocks the CI shape against HEAD moved with no new
   permission surface beyond a manifest grant mirroring the frame one.
2. The `emits` manifest declaration, validated at load, rendered in the plugin's settings page.
3. Cross-plugin grants — frame and node sides together, one vocabulary — with the
   workflows-hears-`checks-changed` poll replacement as the proving consumer.
