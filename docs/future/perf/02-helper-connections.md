# Phase 2: stop fast reads waiting behind slow ones

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
