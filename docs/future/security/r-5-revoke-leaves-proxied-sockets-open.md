> **Completion note, November 20, 2026.** Fixed on the Acorn side, on branch
> `phase-r-5-revoking-a-device-closes-its-open-connections`.
>
> What landed:
>
> - A loopback route closes on revoke. `serveLoopback` listens to `DEVICES.onRevoked` for the device that
>   made the request. A live reload upgrade is destroyed for as long as its socket lives. A proxied HTTP
>   answer still streaming, such as a dev server's event stream, is destroyed until the response closes.
> - A preview closes on revoke. The preview server remembers each connection a page made, by the grant
>   that let it in. On revoke, `startPreview` drops the device's grants and then calls `closeUngranted()`,
>   which destroys every connection whose grant is gone. That covers a hot reload socket and a keep-alive
>   connection alike.
> - A phone's channel closes on revoke. Before a request runs, the channel records the device ID its
>   bearer names, read with `namedDevice` in `deviceTokens.ts`. Revoking one of those devices closes the
>   channel, and closing it aborts every request still running on it. The hub already closed the feed.
>   `ChannelHost` takes `devices: Pick<DeviceService, 'onRevoked'>`, and the listener passes
>   `runtime.DEVICES`.
> - Docs: `security/transport-and-auth.md` § Transport, `api-reference/transport.md`, and
>   `relay/phone-channel.md` say what a revoke closes. The comments on `onRevoked` and `dropDevice` match.
>   The site's trust model page no longer says a revoke fails every request in flight. `stale --mark`
>   records it and the pairing page, whose "closes its open connections" is true as written.
> - Tests: `listener.test.ts` opens a live reload socket and an endless event stream through a loopback
>   route as a phone, opens a socket as a laptop, revokes the phone, and expects both of the phone's
>   connections closed within a second while the laptop's stays open. It fails at one second on the old
>   route. `channel.test.ts` starts a request with a device token, revokes another device and sees the
>   channel answer a ping, then revokes the token's device and sees the channel close and the request
>   abort. `preview/previewServer.test.ts` opens two previews' hot reload sockets through the real preview
>   server and checks that only the revoked device's closes.
>
> Decisions and deviations:
>
> - I took the doc's first fix, not the doc-only fix.
> - A plain request to the Node that's already running still finishes. A device may revoke itself with
>   `DELETE /v1/core/devices/:id`, and cutting every in-flight request would cut that one too. The docs say
>   so instead of promising otherwise. For the same reason, a loopback HTTP answer is watched only while
>   it streams, because its connection may carry the device's next request.
> - The channel reads the device ID from the token, not from the authenticated principal, so the auth
>   middleware doesn't change. A token that fails to authenticate can only name a device whose revoke
>   then closes the phone's own channel, so that costs nothing.
> - A phone with shell access that signs out over its channel revokes itself, as R-4 notes. Its channel
>   now closes before the sign-out answer arrives, so the phone sees the request fail rather than
>   succeed. The phone is unpaired either way.
> - The preview test drives the server the way `startPreview` does, because `startPreview` needs a
>   certificate from an account service.
> - Size: the Node service bundle measures 1,971,928 B, 440 B over the 1,971,488 B the coordinator gave.
>   Most of it is in lazy chunks: the loopback route, the channel, and the preview server.
> - I didn't run the live check in `pnpm dev:remote` with a paired phone.
>
> For later phases: anything new that holds a connection open for a device should listen to
> `DEVICES.onRevoked` and close it, because sign-out (R-4) revokes phones through the same path.
>
> What acorn-cloud would still need: nothing. A revoke is local to the Node.

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
