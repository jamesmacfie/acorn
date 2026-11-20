# S-5: The Node doesn't enforce the gateway token's 60-second lifetime

Found November 20, 2026, in a read-only security review of `jamesmacfie/acorn` at `90b9e61e3`.
Severity: info. Confidence: confirmed from code. Status: open.

## What goes wrong

A gateway token is meant to last 60 seconds and open one request. The Node checks only that the token
hasn't expired, not how long it was issued for. It remembers used token IDs in memory, so a restart
forgets them. A token issued with a far expiry could be replayed after a restart.

## Who can do it

The issuer, through a bug or a breach of the account service, or someone who obtained a token from
inside the pinned TLS stream. Nobody outside those can.

## How it goes

1. `verifyToken` refuses a token whose `exp` has passed and checks nothing about `iat` or the length of
   its life (`packages/protocol/src/device/accountToken.ts:72-73`).
2. `gatewayCaller` records the token ID until its `exp` (`packages/node-core/src/server/auth/gateway.ts:31-33`).
   The record lives in memory (`packages/node-core/src/server/auth/gateway.ts:14-16`).
3. After a restart, the same token passes again until its `exp`.

## What limits it

- The token is signed with the owner keys the Node recorded, and must name this Node, the owner, and
  the plugin (`packages/node-core/src/server/auth/gateway.ts:28-30`).
- It must arrive through the relay inside TLS pinned to the Node
  (`packages/node-core/src/server/auth/gateway.ts:45-46`).

## Fix

In this repo, in `packages/node-core/src/server/auth/gateway.ts`, refuse a gateway token whose `exp`
is more than about 120 seconds after `iat`, or whose `iat` is more than about 120 seconds old.

## How to check the fix

- Add cases to `packages/node-core/src/server/gatewayRoute.test.ts`: a token that lasts 10 minutes and
  a token issued 5 minutes ago are both refused with `401`.

## Related

- [X-1. Cloud account access can authorize Slack turns on the Node](./x-1-account-takeover-to-slack-agent-turns.md)
- [Gateway routes](../../authentication/gateway-routes.md) and
  [the gateway token](../../account-api/slack-gateway.md#the-gateway-token)
