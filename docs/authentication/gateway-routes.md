# Gateway routes

A gateway route is the one way a hosted gateway of the account service, such as the Slack gateway,
reaches a Node. Read this page before you add a gateway route or change what opens one.

## What opens the route

A compiled plugin serves one with `ctx.routes.gateway(handler)`, and core mounts it at
`/v1/gateway/<plugin id>/*`. A loaded plugin has no such member, as it has no `loopback`. The registry
is `packages/node-core/src/server/routes/gatewayRoutes.ts`, and the checks, loaded on the first
request, are in `packages/node-core/src/server/auth/gateway.ts`.

On that prefix the Node accepts a gateway token ([the gateway token](../account-api/slack-gateway.md#the-gateway-token))
and nothing else. It accepts one only when all of these hold:

- The signature checks out with the owner keys the Node recorded when **Remote access** was turned on.
- `aud` is this Node's ID, and `sub` is the recorded owner account.
- `scope` is the route's plugin, and `exp` hasn't passed.
- Its `jti` hasn't been seen. Seen IDs stay in memory until they expire.
- The request came through the relay: its `Host` is the relay's name for this Node, its stream has no
  peer address, and it isn't a phone's channel.

A device, task, or service token on the prefix gets `403`. A missing or failed gateway token gets
`401`. A gateway token on any other route is no credential there, so it gets `401` too. A Node with no
owner, or a plugin with no gateway route, answers `404`. A body over 256 KiB gets `413`.

The route is mounted before `requireUser`, because its caller holds no device or task token, and it
answers every request under the prefix itself. The handler gets the request with its path relative to
the mount, and a principal of `{ kind: 'gateway', plugin, accountId }`.

## Limits

The Node fetches the owner keys only when it registers. A key the service rotates in afterward is
unknown here until the Node registers again, by turning **Remote access** off and on. An assertion has
the same limit.

## Why

The gateway is part of the account service, which signs relay tickets already, so it reaches a Node
the way any client does: a ticket opens a `tls` stream through the relay, and TLS inside it is pinned
to the Node's fingerprint. A second connection from each Node to the gateway would duplicate the relay
tunnel and give up the Node's own routes, auth, and tests.
