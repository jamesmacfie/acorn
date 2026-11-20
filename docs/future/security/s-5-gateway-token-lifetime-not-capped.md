> **Completion note, November 21, 2026.** Fixed on the Acorn side, on branch
> `phase-s-5-node-caps-the-gateway-token-lifetime`.
>
> What landed:
>
> - `gatewayCaller` refuses a gateway token whose `exp` is more than `GATEWAY_TOKEN_LIFETIME_SECONDS`
>   (60) after its `iat`, and one whose `iat` is more than 60 seconds ahead of the Node's clock. A token
>   issued long ago fails the first check, because it can't still be live without a long life. A replay
>   after a restart has at most two minutes of the Node's time.
> - Tests: `gatewayRoute.test.ts` refuses with `401` a token that lasts 10 minutes, one issued 5 minutes
>   ago, and one dated ahead of the clock. Without the fix, the Node accepts all three.
> - Docs: `docs/authentication/gateway-routes.md` lists the two checks.
>
> Decisions and deviations:
>
> - The cap is the shared `GATEWAY_TOKEN_LIFETIME_SECONDS` from `@acorn/protocol`, not the finding's
>   "about 120 seconds". The hosted service (`src/slack/deliver.ts` in acorn-cloud) signs `iat: now` and
>   `exp: now + GATEWAY_TOKEN_LIFETIME_SECONDS` from the same constant, and so does the stand-in in
>   `accountStub.ts`, so an exact cap can't drift from what either signs. This matches R-2's assertion cap.
> - The clock allowance is 60 seconds, the same as R-2's for assertions, and is a local constant in
>   `gateway.ts`. Both checks load lazily, so sharing one constant would pull one module into the other.
> - The service bundle's static chunks stay at 1,972,223 B. `gateway.ts` loads on the first gateway
>   request, so the change adds nothing to the budgeted graph.
>
> For acorn-cloud: nothing is required. It already signs within the cap. One thing to watch: `deliver.ts`
> takes `now` before it opens the relay stream and signs after the TLS handshake. That only shortens a
> token's remaining life, so a slow handshake can't break delivery, but signing with a fresh `now` would
> give the Node the full 60 seconds.

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
