# Versioning

This page covers which builds of a client and a Node work together, and how a route leaves the API
within a protocol version. It's part of the [API reference](../api-reference.md), beside
[Transport and pairing](./transport.md).

`NODE_PROTOCOL_VERSION` is 1 (`packages/protocol/src/device/node.ts`), and every owned HTTP and
WebSocket path uses `/v1`. Every probe and pair result also carries `baseline: "acorn-1"`. A client
refuses a missing or different baseline before pairing or opening a socket, even when the protocol
number is 1.

The protocol number is the major. There's no minor and no feature handshake. Each side refuses a
major it doesn't speak. The pairing probe refuses before pairing, and the broker probes `GET /v1/node`
again on every connect, which produces the `incompatible` connection state and the
`protocol_mismatch` error code. A check at pairing alone isn't enough, because a paired Node upgrades
by restarting, and the reconnect is where a new major shows up.

The same probe may carry `eventTransport: { viewers: 1 }`, which advertises logical event viewers. A
host that enables viewer multiplexing adds `x-acorn-viewers: 1` to its `/v1/events` upgrade only
after it sees that advertisement. An absent or malformed advertisement, an unknown viewer version, or
a failed probe keeps the single-viewer event transport. The advertisement doesn't change the major.
[WebSocket](./websocket.md#logical-event-viewers) covers the frames.

**Within a major, changes are additive.** New routes, new optional response fields, and new WebSocket
channels are safe. Renaming a field, removing one, or changing what one means is the next major. A
route can go within a major only as [Removing a route](#removing-a-route) describes.
Reads are tolerant: `readJson` doesn't validate, so unknown fields pass and a missing field arrives as
`undefined`. That's a licence to add, never to remove, because a removal surfaces as a crash deep in a
component rather than at the boundary. Mutations keep their Zod validation.

**The handshake is the most tolerant surface.** `nodeInfoSchema` and `pairResultSchema` ignore unknown
fields in every major. This is the answer by which a client learns it can't speak to a Node, so every
client must be able to read every version of it. A client that can't parse it reports "this is not an
acorn node" about something that plainly is.

A standalone Node can upgrade on its own schedule, so test compatibility at the probe and reconnect
boundaries. There's no OpenAPI document or generated client. [Node distribution](../node-distribution.md)
covers the standalone artifact.

The plugin bridge follows the same rule. Frame SDK verbs ship inside plugin bundles while the broker
ships in the shell, so within a `PLUGIN_API_MAJOR` bridge verbs are additive only. See
[the plugins doc](../plugins.md).

## Mixed builds

A client, a Node, and a loaded plugin's bundle may come from different builds of the same major, up to
90 days apart, and so may device state and stored data an earlier build wrote.

Code that lets a newer build cope with an older one is a mixed-version path. Its comment says
`Mixed-version path until <date>.`, so `git grep -n "Mixed-version path until"` lists every one. The
date is 90 days after the commit that added the path, which `git log --reverse -S'<string>'` finds.
After it, every supported build has the newer behavior, and the path can go. A comment that covers
several fields takes the newest field's date. A field that's also optional for another reason keeps
that reason. Code for builds or data from before the `acorn-1` baseline isn't a mixed-version path,
because the baseline refuses them.

The window counts from the commit because Acorn tags no releases and has no updater: a machine
upgrades when its owner rebuilds. Ninety days gives a paired Node elsewhere, or a plugin built outside
this repository, three months to catch up.

A client that meets a build outside this policy:

- **Refuses a different baseline or protocol major**, and asks the owner to upgrade the older side.
- **Refuses a loaded plugin whose `apiVersion` range misses the host's major**
  ([published packages](../plugins/publishing.md#the-compatibility-promise)).
- **Warns about a different build of the same major and keeps working.** `GET /v1/node` gives an
  authenticated caller the Node's `buildVersion`: the date and commit it was built from, stamped by
  `scripts/buildVersion.mts`. Settings → Nodes shows it beside the client's own build. Code run from
  source reports `development`, and a difference involving it shows as a plain line, not a warning. A
  request that needed a deleted path still fails where it's made, as a 404 or a missing field.

## Removing a route

Within a major, a Node keeps a route until no supported client calls it. Supported clients use the
window in [Mixed builds](#mixed-builds), counted from the first client build that stopped calling the
route. After that window, the route can go.

Record each removal as a line in `apps/node/test/integration/routeRegistry.removals.txt`: the route,
the date it went, and the date and commit of that client build. `routeRegistry.snapshot.json` beside
it lists every `/v1` route the Node mounts, with the protocol version it was written under.
`routeRegistry.test.ts` fails when a listed route is gone without a removal line, or when a line's
dates are closer together than the window. Bumping `NODE_PROTOCOL_VERSION` lifts the check. Adding a route
only needs the regenerated snapshot. Routes behind a lazy mount, such as GitHub's mirror, and loaded
plugins' routes aren't in the snapshot.
