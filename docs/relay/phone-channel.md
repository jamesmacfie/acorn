# The phone channel

This page covers how a phone's browser reaches a Node through a relay: the encrypted channel, the Node's
channel key, the messages, the device each phone gets, and what a phone's device may not do. Read it
before you change the phone app's transport, the Node's channel endpoint, or the phone device rules. It's
part of [the relay](../relay.md), and [the mobile web app](../mobile.md) owns the app itself.

## What it does

A phone's browser can't run TLS inside a relay stream, and it can't pin a Node's self-signed
certificate. So the phone opens a stream marked `browser` and runs a [Noise](https://noiseprotocol.org)
handshake over it, against the Node's channel key. Inside the channel it sends requests and event frames,
and the Node answers them with its own router. The relay and the account website see ciphertext only.

| Part | Where it lives |
| --- | --- |
| The handshake and the framing | `packages/channel/src/secure.ts`, built on `@chainsafe/libp2p-noise` |
| The phone's requests, answers, and event feed | `packages/channel/src/client.ts` |
| The messages | `packages/protocol/src/transport/channel.ts` |
| The Node's end | `packages/node-core/src/server/transport/channel.ts` |
| The Node's key | `packages/node-core/src/server/transport/channelKey.ts` |
| The phone's connection, tickets, and token custody | `apps/mobile/src/client` (`openChannel.ts`, `nodeLink.ts`, `pairedNodes.ts`) |

## The handshake

The channel is `Noise_XX_25519_ChaChaPoly_SHA256`, from `@chainsafe/libp2p-noise`, which uses audited
`@noble` primitives and gives each session forward secrecy. Acorn writes no handshake and no crypto of
its own. The library wants a libp2p identity, so each side has one:

- **The Node's identity** is an Ed25519 key pair in `channel/key.pem` in the [data root](../data-layer/data-root.md),
  made the first time it's needed. The handshake signs the session's keys with it. The Node registers the
  public half, 64 hex characters, with its account when **Remote access** is turned on
  ([the account API](../account-api.md#register-a-node)).
- **The phone's identity** is made fresh for each connection and means nothing. The Node learns who the
  phone is from its device token, inside the channel.

The phone gets the Node's key from the account's list of Nodes and **pins it when it pairs**: it keeps the
key in its own record from then on. A later handshake against a different key fails with an identity error
and the phone stops retrying, the way a changed certificate does for a native client. The account's list is
read only until the phone is paired, so a changed listing can't move a paired phone.

A phone with no account has no list to take the key from, so it can't pair. Running the app against a
self-hosted relay with no account isn't supported ([open question 4](../future/remote-access/05-production.md#open-questions)).

## Open a channel

1. The phone asks its account for a ticket for the Node, with the account's session cookie.
2. It opens `wss://<relay>/v1/connect/<node ID>?kind=browser`, offering the ticket as a
   [subprotocol](../../apps/relay/PROTOCOL.md#connections), because a browser can't set `Authorization`.
3. The relay asks the Node for a stream. The Node's tunnel hands a `browser` stream to its channel endpoint,
   which loads the first time one arrives.
4. The two run the handshake. Each gives up after 10 seconds of silence.

A Node with no relay settings runs none of this. The channel's code loads when a phone connects, so it
adds nothing to a Node's start.

## The messages

One message is four bytes of header length, a JSON header, and then bytes for the three that carry a body.
Both sides send `ping` after 15 seconds of quiet and treat 30 seconds of silence as a dead channel.

| Phone sends | Node answers |
| --- | --- |
| `request`: method, path, and headers, with the body as bytes | `response`: status and headers, with the body as bytes. `failure` when the router never answered. |
| `abort`: a request ID | Nothing. The Node stops the request. |
| `events`: a device token | `events-open`, or `events-refused` when the token isn't a live device's |
| `frame`: a client frame as JSON bytes | `frame`: a hub frame as JSON bytes, `seq` included. `bytes`: terminal output. |

A request becomes an ordinary call to the Node's router, with `Host` set to `<node ID>.relay.acorn` and the
device token in `authorization`. Authentication and routes run unchanged. The Node drops the headers that
describe the phone's connection and any `x-acorn-internal` header, and it never treats a channel as a
loopback peer, so the routes that trust a caller on this computer refuse it.

An answer holds at most 16 MiB. The event feed joins the same hub a WebSocket does, so a revoked device's
feed closes at once, and a feed that falls behind holds a terminal's output back instead of dropping it.
The phone reads the `seq` of each frame. A gap means frames were lost, so it opens a new channel and
refetches.

## A device for each phone

A phone pairs by approval, as a laptop does ([pairing by approval](../api-reference/transport.md#pairing-by-approval)):
it asks with an account assertion, a paired device shows the same three words, and **Allow** hands the
phone a token. The first phone pairs at home, approved on the Node's own computer.

A device paired through a channel is marked `kind: "phone"`, whatever it calls itself, because the Node
knows which door it came through. The phone keeps its token in IndexedDB, encrypted with AES-GCM under a
key the browser made and won't hand over, so a copy of the browser's storage holds ciphertext. That
doesn't protect against script running in the app. A phone names itself from its browser and a short
random tag, such as "iPhone Safari 1a2b", so the device list and the audit log tell phones apart.

## What a phone device may do

A phone's device may not call these routes. The Node answers `403 phone_refused`, from
`server/middleware/phoneRules.ts`, and a test pins the list:

- Opening a pairing window, and everything under `/v1/core/devices`. Answering a pairing request is
  allowed.
- Every `POST`, `PUT`, `PATCH`, or `DELETE` under `/v1/core/plugins`, so a plugin write added later is
  refused too.
- Backup and restore, security settings, `PUT /v1/core/node/reach`, and `POST /v1/core/node/stop`.

A phone's device that nobody uses for 30 days is revoked the next time it asks. Revoke one phone from
**Settings → Nodes** on a computer, which lists each device. The others keep working.

The list is a denylist because the phone draws the desktop's own panes, which read most of the Node's
routes. An allowlist would be stricter, and it needs every route those panes use named first.

## Previews

A task's running app reaches a phone as a page the phone's browser loads from the Node itself, because a
page can't come from bytes on this channel: a page on the app's address would run with the phone's
session. The page is a frame of the phone app, on a name of its own, over TLS that the Node ends. The relay
passes the bytes on by name and reads only the server name in the first record
([the relay's preview listener](../../apps/relay/PROTOCOL.md#preview-streams)).

| Part | Where it lives |
| --- | --- |
| The relay's listener | `apps/relay/src/relay.ts`, `apps/relay/src/clientHello.ts` |
| The names | `packages/protocol/src/transport/relay.ts` |
| The certificate and its renewal | `packages/node-core/src/server/transport/preview/certificate.ts`, `acme.ts` |
| The server on a Node, and who may load it | `.../preview/previewServer.ts`, `grants.ts` |
| The proxy and its rules | `packages/node-core/src/server/proxy/loopbackProxy.ts`, `loopbackRoute.ts` |
| The phone's pane | `plugins/preview/src/client/PreviewPhonePane.tsx` |

**Names.** A preview is `<preview>.<node>.<preview domain>`. `<node>` is the first 32 hex characters of the
SHA-256 of `acorn-preview-node:` and the Node's ID. The account service, the relay, and the Node each
compute it. `<preview>` is 32 random hex characters for one open preview. Neither names a task, because the
relay sees the name, and a certificate log publishes the Node's.

**The certificate.** A Node with Remote access on and `ACORN_ACCOUNT_URL` set orders a wildcard certificate
for `*.<node>.<preview domain>` over ACME with a DNS-01 challenge. It asks the account service where
previews are served and which authority to use, and has the service publish the challenge's TXT record
([the account API](../account-api/previews.md)). The key is made on the Node and never leaves it. The Node
keeps the certificate in `<data root>/previews/` and renews it when a third of its life is left. A Node
without an account service, or one whose service has no preview domain, serves no previews.

**Opening one.** A phone asks as a paired device:

```text
POST /v1/p/preview/tasks/:taskId/proxy/__acorn/open        { "ancestor": "https://app.example" }
200 { "url": "https://<preview>.<node>.<domain>/__acorn/preview?key=<key>" }
```

A task's token gets `403`. The task has to have an address on the Node's own loopback (`404 no_preview`
otherwise). While the Node can't serve one it answers `503 preview_unavailable`, with the reason in
`details.reason`: `off` (no Remote access), `unsupported` (the service has no preview domain), `starting`
(no certificate yet), or `expired` (it ran out and couldn't be renewed).

**Who may load it.** The first request, `GET /__acorn/preview?key=…`, spends the one-time key, sets a
`__Host-` cookie with `SameSite=None; Secure; HttpOnly; Partitioned`, and redirects to `/`. Every other
request needs the cookie. A grant lasts 12 hours, ends when the device that opened it is revoked or the
Node restarts, and at most eight are open at once. A name nobody opened gets a bare `403`. A known name
without its cookie gets `403` and a page that tells its parent `acorn-preview:cookie-blocked`.

**Safari.** A frame from another site can't keep that cookie in Safari. The pane hears the message above,
asks for a second address with no `ancestor`, and offers it as a button that opens the preview as a page of
its own, where the cookie belongs to the page. Other browsers stay in the frame.

**What the page may do.** Every answer adds
`default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; connect-src 'self' wss://<host>; form-action 'self'; base-uri 'self'; object-src 'none'; frame-ancestors <ancestor, or 'none'>`,
so the page reaches its own origin and nothing on the phone's network. The pane's frame has no
`allow-top-navigation`. A page can still send its own frame elsewhere, which no policy the Node sends can stop, so the
phone app's `frame-src` must name the preview domain and nothing else ([serve previews](../mobile/phone-setup.md#serve-previews)).
The proxy connects only to the Node's own loopback, refuses the Node's port,
follows no redirect, drops `Authorization` and the grant cookie, and takes a WebSocket upgrade, for hot
reload, only from the page's own origin.

**What the relay learns.** The Node's label, the random preview label, and when each connection opened.

## Trust

- **The website serves the code.** The account website could ship a phone app that reads what the phone
  reads. That's true of any web app. Someone would have to change the served files on purpose, and the
  change would be visible in them.
- **The account vouches for the key.** A breached account service could list a Node with an impostor's key.
  A phone that pairs with it would send the impostor its work. It still couldn't get into the real Node.
- **A phone can approve a pairing.** Raising a request from another computer needs the owner's account
  assertion, and a phone holds the account's session as well as its device token. Someone holding an
  unlocked phone could pair a new computer. Revoke a lost phone from a computer, and the 30-day limit ends one nobody uses.
- **A Node answers as data.** A channel's answers reach the app's code as bytes, never as a page on the
  app's address, so a loaded plugin's HTML can't run with the phone's session.
