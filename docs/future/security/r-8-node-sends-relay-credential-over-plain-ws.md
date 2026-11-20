# R-8: The Node sends its relay credential to a plain `ws://` relay the account service names

Found November 20, 2026, in a read-only security review of `jamesmacfie/acorn` at `31ff472da`.
Severity: low. Confidence: confirmed from code. Status: open.

## What goes wrong

A client refuses to send an account ticket over `ws://` to another computer, because the ticket would
cross the network in the clear. The Node has no such rule for its own relay credential. When the account
service answers a registration with a `ws://` relay address, the Node records it and dials it with the
credential in a header.

## Who can do it

The account service, through a mistake in its configuration or a breach. Anyone on the network path
between the Node and that relay then reads the credential.

## How it goes

1. The registration answer's relay address may be `wss://` or `ws://`, for any host
   (`packages/protocol/src/device/account.ts:99-100`, `packages/protocol/src/transport/relay.ts:12-16`).
2. `turnOn` records it without a further check (`plugins/account/src/server/remoteAccess.ts:47-52`), and
   `relaySettings` accepts either scheme (`packages/node-core/src/server/transport/relaySettings.ts:16`).
3. The tunnel sends `Authorization: Bearer <credential>` on the control connection and on every stream
   it opens (`packages/node-core/src/server/transport/relayTunnel.ts:53`, `:74`, `:90`).
4. The client's rule is in `relayCredentialFor` (`packages/custody/src/broker/relaySocket.ts:59`).

## What limits it

- The credential lets a holder take the Node's route at the relay. It can't read or run anything on the
  Node, because clients pin the Node's own keys. See
  [L-2](./l-2-read-block-exposes-relay-credential.md) for what the credential is worth.
- The hosted service answers with its configured `wss://` address.
- A person who sets `ws://` by hand in `node.json` or the environment chose it, and
  [run your own relay](../../relay.md#run-your-own-relay) says what that costs.

## Fix

In `plugins/account/src/server/remoteAccess.ts`, refuse a registration answer whose relay address is
`ws://` for a host that isn't this computer, with the same rule the client uses. Leave `relaySettings`
as it is, so a hand-written `ws://` relay keeps working.

## How to check the fix

- In `plugins/account/src/server/routes.test.ts`, answer a registration with `ws://relay.example.com`
  and expect `502 account_unavailable`, with nothing written to `node.json` and no tunnel started.
- Keep a case where `ws://127.0.0.1` is accepted, which the dev flows use.

## Related

- [L-2](./l-2-read-block-exposes-relay-credential.md): another way the credential leaks.
- [Relays and accounts](../../relay/accounts.md#tickets), which states the client's rule.
