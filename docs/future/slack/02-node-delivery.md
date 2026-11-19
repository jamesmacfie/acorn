# Phase 2: delivery to the Node

Date: November 19, 2026. Status: proposed. Depends on phase 1 for the gateway token.

## Goal

A Node accepts a gateway's request on `/v1/gateway/<plugin>` and nowhere else. A compiled plugin
serves that route, and it can call the account service as the signed-in owner.

## Starting point

- `ownerAssertion` in `packages/node-core/src/server/auth/pairingAssertion.ts` verifies an account
  assertion with the owner keys `readNodeRelay` returns. A gateway token is checked the same way.
- A relayed request arrives with `Host: <node ID>.relay.acorn` and no peer address
  ([the relay § The Node](../../relay.md#the-node)).
- Device, task, and service tokens are checked in `packages/node-core/src/server/middleware/auth.ts`.
- The account plugin holds the access token as an encrypted connection, and the host renews it
  ([the sign-in plugin](../../account-api.md#the-sign-in-plugin)).

## In scope

- The gateway token type in `packages/protocol/src/device/account.ts`.
- `ctx.routes.gateway(fetch)` for compiled plugins, and the auth rule on its prefix.
- `account.service`, a compiled capability from the account plugin.

## Out of scope

Any loaded-plugin access to either seam. Any relay change.

## Steps

1. Add `gateway` to `TOKEN_TYPES` with `typ` `acorn-gateway+jwt` and a claims schema with `scope`.
2. Add `gateway(fetch)` to the compiled route registry. Core mounts it at `/v1/gateway/<plugin id>/*`,
   so the plugin's ID is the token's `scope`. One per plugin. A loaded plugin has no such member,
   the way it has no `loopback`.
3. On that prefix, accept a gateway token and nothing else. Accept one only when all of these hold:
   - The signature checks out with the owner's keys.
   - `aud` is this Node's ID, and `sub` is the recorded owner account.
   - `scope` matches the route's plugin, and `exp` hasn't passed.
   - Its `jti` hasn't been seen. Seen IDs stay in memory until they expire.
   - The request came through the relay.

   A device, task, or service token there gets `403`. A gateway token on any other route gets `401`.
   A Node with no owner answers `404` on the prefix.
4. Give the handler a principal of `{ kind: 'gateway', plugin, accountId }`.
5. Limit a request body on the prefix to 256 KiB.
6. In the account plugin, provide `account.service`: `fetch(path, init)` against the account
   service's address, with the access token added. It throws `not_signed_in` when nobody is signed
   in. It's compiled only.

## Verify before building

- Whether the Node fetches the account service's keys again when it meets an unknown `kid`, as the
  relay does. If it doesn't, a key rotation breaks delivery until the next registration.
- Where the auth middleware's principal types live, and whether a fourth kind fits without touching
  every route.
- How the listener marks a relayed socket, so step 3 can tell it from loopback.
- The Node service size these steps add. Keep the verifier off the boot graph by loading it on the
  first request, as `ownerAssertion` is.

## Tests

- Token checks: wrong type, wrong audience, wrong owner, wrong scope, expired, replayed, and a valid
  token over loopback.
- Route isolation: each other token kind on the prefix, and a gateway token on a core route and on
  another plugin's prefix.
- `mountCoverage.test.ts` covers the prefix.
- `account.service` with nobody signed in, and with a token the host renewed.

## Checkpoint

With `pnpm dev:account` and a Node that has **Remote access** on, send a stand-in delivery to a test
plugin's gateway route through the relay and see it answer. Then replay the same token and see `401`.
Record the date and the result here.
