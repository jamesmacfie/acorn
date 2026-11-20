# R-5: Revoking a device leaves in-flight requests and proxied sockets open

Found November 20, 2026, in a read-only security review of `jamesmacfie/acorn` at `90b9e61e3`.
Severity: low. Confidence: confirmed from code. Status: open.

## What goes wrong

The docs say revoking a device closes its live sockets and fails its in-flight requests. The code closes
the event hub's sockets and drops preview grants, and nothing else. A request already running finishes.
A dev server's live-reload WebSocket proxied through `serveLoopback`, and a preview's open socket, stay
open after the revoke. Every new request authenticates again, so the gap lasts only as long as those
connections do.

## Who can do it

The holder of a device token the owner just revoked, such as a lost phone or a laptop, with a long
request or a proxied socket already open at the moment of revocation.

## How it goes

1. `revokeDevice` clears the device's cached authentication entries and calls each `onRevoked` listener
   (`packages/node-core/src/server/auth/deviceTokens.ts:103-123`).
2. Two places listen: the hub, which terminates the device's sockets
   (`packages/node-core/src/server/transport/wsHub.ts:433-438`, `:463`), and previews, which drop the
   device's grants (`packages/node-core/src/server/transport/preview/start.ts:43`).
3. A live-reload upgrade through `serveLoopback` takes the socket for the life of the connection and
   registers no listener (`packages/node-core/src/server/proxy/loopbackRoute.ts:72-76`). It stays open.
4. A preview's open connection stays open, because grants are checked per request, and a socket that's
   already upgraded makes no more requests.
5. A phone channel with no event feed stays open after the revoke
   (`packages/node-core/src/server/transport/channel.ts:159-247`). Its next request fails to
   authenticate, but a request already running completes.

## What limits it

- Each new HTTP request authenticates again, and the revoke clears the cache first.
- The event hub, which carries terminal output and agent events, closes at once.
- A proxied socket reaches only a task's dev server on loopback, not the Node's routes.

## Fix

In this repository, either:

- Track upgraded loopback and preview sockets by device in `serveLoopback` and the preview server, and
  close them from an `onRevoked` listener. Close a phone's channel on revoke too, by keeping the channel's
  device ID once a request authenticates.
- Or correct the doc to say what revoking closes: event sockets and preview grants, and new requests.

The first is the fix. The second is the minimum.

## How to check the fix

- Unit: open a loopback WebSocket through a test plugin's loopback route as a device, revoke the device,
  and check that the socket closes within a second.
- Unit: in `packages/node-core/src/server/transport/channel.test.ts`, open a channel, make one request
  with a device token, revoke the device, and check that the channel closes.

## Related

- [R-4](./r-4-sign-out-leaves-phones-paired.md): signing out leaves phone devices paired.
- Docs that make a claim this finding contradicts:
  - [Transport](../../security/transport-and-auth.md#transport) says "Revoking a device closes its live
    sockets and fails its in-flight requests" (`docs/security/transport-and-auth.md:35`).
  - The comment at `packages/node-core/src/server/transport/wsHub.ts:433` quotes the same promise from
    `docs/api-reference/transport.md` § Pairing.
