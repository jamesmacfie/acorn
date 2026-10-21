# Phase 2: stop fast reads waiting behind slow ones

## Completion note

Landed October 21, 2026, on branch `phase-2-helper-connections`. The code, tests, and docs are done.
The working day of Sentry that the acceptance asks for isn't taken, and needs the owner's machine.

What landed:

- Each Node's ordinary pool holds 16 sockets on loopback and 6 on a remote endpoint. A second pool of
  four takes any request that names `long: true` in `NodeFetchRequest` or asks for a `timeoutMs` over
  30 seconds. Usage refresh, both its routes, and task archive name `long`. Workflow generation, the
  AI authoring turn, MCP server calls, and session summaries already ask for more than 30 seconds, so
  they move without a change.
- The request's own deadline starts on its `socket` event. The whole call gets twice that, which is
  60 seconds for the default. The slow `broker.request` span carries `timeout.kind`, `queue` or `node`,
  through `slowAttrs`. Both fail as a `TimeoutError`, with different messages.
- The helper's failure reply keeps the error's `name`, and the desktop bridge restores it. The renderer
  couldn't tell a timeout from any other failure before this.
- The query client's default `retry` retries once. It never retries a `TimeoutError`, a 4xx answer, or
  a `node_offline` refusal.
- `apiClient` refuses a read to a Node the broker reports `offline` or `revoked`, with the same
  `node_offline` error a write gets. Nothing reaches the helper.
- The broker, transport, fleet, states, caching, and telemetry pages describe the two pools, the
  deadlines, and the read refusal.

Decisions and deviations:

1. No `onlineManager`. TanStack's `onlineManager` is one global for every `QueryClient`, so `fleet.ts`
   can't set it per Node. Driving it from the active Node would pause fan-out reads to Nodes that
   are up. It would also park the 28 awaited `fetchQuery` and `ensureQueryData` calls until the Node
   returned, and queue mutations for replay, which the fleet design rules out. A refused read fails
   at once instead. The active Node's reconnect already invalidates its active queries (`wsClient`
   `reconnectSubs`), which is what turns them back on. The cost: a query that refetches during a
   WebSocket blip, while the broker briefly reports `offline`, shows an error until that refetch,
   where before its read went through over HTTP.
2. Only a reported state refuses a read. A Node with no status yet still gets reads, because the
   broker may already hold its connection. A write still counts no status as offline, as before.
3. The reconnect's protocol probe now counts as HTTP working (`lastHttpOkAt`). Before, only renderer
   reads moved a Node with a dead socket and live HTTP from `offline` to `degraded`. With reads
   refused while `offline`, that Node would have stayed `offline`. No test covers it, because
   reaching `degraded` takes about seven seconds of reconnect backoff.
4. The call deadline is twice the request's deadline, not a fixed 60 seconds. A fixed 60 would cut an
   11-minute workflow generation off at one minute. `queue` means the call deadline fired. Because the
   Node's deadline didn't, more than half the call was spent waiting for a socket, so the message
   says so even when the socket came late.
5. `nodeRequest` settles the call itself on abort. Node reports a destroyed request that's still
   queued for a socket only once the agent frees one. Before this, a queued read never timed out
   while the pool stayed full, and the queue deadline couldn't have fired.
6. A 5xx answer retries once, like a failure in transit. The doc names only timeouts and 4xx as
   never retried. The default also reaches `fetchQuery` and `ensureQueryData`, which TanStack left
   unretried when no default was set, so they now retry a failure in transit once.
7. The CLI's browser bridge sends task archive through its own broker and doesn't mark it `long`. It
   carries only extension traffic.

Not done:

- The acceptance's working day in Sentry: `broker.queue` p95, renderer against Node p95 for
  `/v1/core/plugins` and `/v1/core/tasks/:id`, and offline `status:0` timeouts.
- The programme README still lists this phase. Trim it when the programme closes, as phase 1 did.

For later phases:

- Phase 3: reads to an offline Node no longer reach the helper, so a dead paired Node stops counting
  toward polls. Count the remaining polls with that in mind.
- Phase 9: queue waits should mostly be gone. Measure the opens again before building.
- `broker.queue` has no pool label, so long-pool waits share the ordinary pool's series. There are a
  handful a day against thousands of reads.
- The Node service bundle is 1,930,648 bytes against a ceiling of 1,931,900, unchanged by this phase.

Date: October 21, 2026. Status: proposed. Needs phase 1's `queue.ms`.

Every renderer read goes through the helper, which holds four sockets to each Node. Slow requests
fill them, and fast reads wait in line, and the line counts against their 30 s deadline. This phase
gives the queue room and keeps the deadline for the Node's own time. Read
[the programme](./README.md) first.

## Starting point

- `MAX_NODE_HTTP_SOCKETS = 4` in `packages/custody/src/broker/nodeBroker.ts`. `NodeBroker.upsert`
  gives each Node one keep-alive `http.Agent` or pinned `https.Agent` with that cap.
- `BrokerFetch.fetch` in `packages/custody/src/broker/brokerFetch.ts` starts its 30 s timer before the
  agent assigns a socket.
- Long requests hold a socket for minutes. Usage refresh ran at a p90 of 151 s. Workflow generation
  (`plugins/workflows/src/client/workflowsClient.ts`) can take 11 minutes. An MCP install takes up to
  150 s.
- The renderer's `QueryClient` in `packages/client-core/src/infra/node/fleet.ts` sets no `retry`, so
  TanStack retries a failed read three times. A timeout becomes up to two minutes of waiting.
- From October 14 to 21, trace `daa37e1b4d108e0edfc0dd661d8e99a4` shows 117 task reads the Node
  answered in 0 to 80 ms each, which the renderer saw at 1.1 to 3.2 s.
- A paired Node, `8398d286-ed3b-4036-bd7d-47818f55e79c`, failed every request at 30 s across 2,120
  five-second windows. Its five recurring reads made about 4,200 timeouts. Nothing stops reading a
  Node the broker already knows is offline.

## Changes

### Give each Node more sockets, and long requests their own

1. Raise the cap to 16 for a loopback endpoint and keep 6 for a remote one. A loopback socket costs a
   file descriptor. A remote one shares a slow link, where more parallel requests don't help.
2. Give each Node a second agent, capped at four sockets, for requests that name `long: true` in
   `NodeFetchRequest`. Mark usage refresh, workflow generation, MCP install, task archive, and any
   request with a `timeoutMs` over 30 s. The ordinary pool then never holds a request for minutes.

Don't remove the cap. An unbounded pool lets a polling storm open hundreds of connections to the Node.

### Start the deadline at the socket

Start the 30 s timer on the request's `socket` event. Keep a second, longer deadline of 60 s from the
call, so a request that never gets a socket still fails. Report which deadline fired as
`timeout.kind: queue` or `timeout.kind: node`.

### Don't retry a timeout

Set the default `retry` in `fleet.ts` to retry a network failure once and never retry a timeout or a
4xx answer. A timeout already waited 30 s, and a second try lands in the same queue.

### Stop reading an offline Node

When the broker reports a Node `offline`, fail its reads at once with the existing offline error
instead of sending them, the way a write is refused today. Its queries then pause through TanStack's
`onlineManager`, which `fleet.ts` can set per client from `nodeState`. A reconnect turns them back on.

## Tests

- A broker test with a 50 ms route and four 2 s requests in flight: the fast read answers in under
  100 ms.
- A `long: true` request doesn't take a socket from the ordinary pool.
- A request that waits 40 s for a socket fails with `timeout.kind: queue`. One that has its socket and
  waits 30 s fails with `timeout.kind: node`.
- A read against an offline Node fails without a network call.

## Acceptance

- `broker.request` `queue.ms` p95 under 20 ms over a working day, from phase 1's starting value.
- `/v1/core/plugins` and `/v1/core/tasks/:id` renderer p95 within 50 ms of the Node's p95.
- No renderer `status:0` timeouts from an offline Node.
- [The connection broker](../../shell/bridge-and-broker.md#connection-broker) documents the two
  pools and the deadline.
