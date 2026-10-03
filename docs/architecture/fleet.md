# Client state and fleet behavior

This page says how a client holds data from several Nodes: its caches, its connection states, and how
an aggregate surface behaves when some Nodes don't answer. Read it before you change a fleet surface,
a fan-out, or a request deadline.

## Client state

The client has one disposable query cache and IndexedDB persister per Node. It also persists fleet
membership, endpoint pins, device tokens, device preferences, drafts, and selection state. Pane
layouts belong to the Node they describe, not the device. [State ownership](../state-ownership.md)
covers the split.

## Freshness

Every Node-backed query renders with a `live`, `refreshing`, `stale`, `offline`, `disabled`, or
`error` status. Cached reads stay visible when a Node is offline. Mutations fail fast and keep the
user's text as a draft. There's no automatic mutation queue.

## Connection states

A paired Node's connection state, `NodeConnectionState` in `packages/protocol/src/transport/broker.ts`,
is `online`, `degraded`, `offline`, `incompatible`, or `revoked`. A certificate fingerprint mismatch
shows as `offline` with an `identity_mismatch` error, because it's a reason the Node is unreachable,
not a separate steady state. `incompatible` comes from the protocol major the probe reports before
pairing, so a client refuses to pair with a Node it can't talk to. [API reference](../api-reference.md)
§ Versioning covers it.

## Fan-out and partial results

Aggregate surfaces fan out one request per Node with bounded timeouts, merge the results that arrive,
and show partial availability with a Node label. Partial results are a banner, never a failed page.
A mutation always targets the Node that owns its resource. Node IDs are part of every cache and
persisted-state key, so the same task ID on two Nodes can't collide.

## Deadlines

The order of two deadlines is a contract. The client gives each Node a fixed window per fan-out
request. A provider plugin's per-request deadline is always shorter, so its own "this API is
unavailable" answer arrives before the client draws "this machine is unavailable". Change those
deadlines when you change the client's window.

A route that misses its deadline says something about that route, not the Node. The broker doesn't
read its own request timeout as a sign the Node is gone. Liveness comes from the WebSocket heartbeat,
and a Node that misses two pings is terminated and reconnected.

## The Fleet view

The Fleet source and the Node switcher appear only when more than one Node is paired, through
`SourceContribution.when`, so first run stays a one-Node product. When a Node stops answering, its
Fleet card keeps rendering from that Node's query cache. `createFleetQuery` falls back to whatever the
Node's `QueryClient` last held, so the card reads as stale, not failed. The "never answered" banner is
for a Node whose cache is empty.

That banner has to clear itself. A booting Node is listed as `online` the whole time, so nothing
reruns the fan-out. The desktop opens the window as soon as the helper listens, before the Node boots.
So a run that reports any Node unavailable schedules another at 2, 5, and 10 seconds, then stops. A
Node that comes back later is picked up by a fleet change, a write, or a remount, each of which reruns
the fan-out.
