# R-6: Previews put the account service inside the encryption

Found November 20, 2026, in a read-only security review of `jamesmacfie/acorn` at `31ff472da` and
`acorn-cloud` at `19fa594`. Severity: medium, latent. Confidence: follows from the design, not run
live. Status: the Acorn side is bounded, and the `acorn-cloud` side is open. The hosted service doesn't
serve previews at that commit.

On the Acorn side, previews have their own **Phone previews** switch, off by default. While it's off,
the Node orders no certificate and drops preview streams. The docs say the service can read a preview.
[The November 20 review](../../security/review-2026-11-20.md) records the change. This report covers
what the service has to do before it serves previews.

## What goes wrong

On every other remote path the relay carries bytes it can't read, because the client pins the Node's own
key. A preview is different. Its name sits under a domain the account service owns, and a public
certificate authority vouches for it. Whoever controls that domain's DNS can get a second valid
certificate for the same name and stand between the phone's browser and the Node. From there they read
the preview's entry key and cookie and use them at the Node, which proxies their requests to the task's
dev server as a local caller.

No change makes a browser pin a key, so this stays true for a Node with previews on.

## Who can do it

The account service's operator, or anyone who breaches it or its DNS. They need a phone to open a
preview while they are in the path. Someone holding a Node's relay credential can also order a
certificate for that Node's preview names.

## How it goes

1. A Node serves previews on `*.<node>.<preview domain>`. The account service names the domain and the
   certificate authority, and publishes the DNS record that proves the name
   (`packages/node-core/src/server/transport/preview/accountPreview.ts`). It can publish the same proof
   for a key of its own.
2. The relay, run by the same party, routes a browser's connection by the server name
   (`apps/relay/src/relay.ts`). It can end that connection itself with the second certificate. The
   browser shows nothing unusual.
3. The first request carries the one-time entry key in its address, and later ones carry the cookie
   (`packages/node-core/src/server/transport/preview/previewServer.ts`). The party in the middle reads
   both and replays them to the Node.
4. The Node proxies each request to the dev server from loopback
   (`packages/node-core/src/server/proxy/loopbackProxy.ts`). A dev tool that opens a console, a file
   listing, or a debugger to local callers opens it to this one.

The service's `PUT /account/v1/preview/challenge` takes the relay credential alone. The Node's switch
stops the Node from asking, but a stolen credential can still ask the service directly.

## What limits it

- `acorn-cloud` answers `404` for the preview routes (`acorn-cloud:src/api.ts:306-308`).
- The reach is the task's dev server, not the Node's API. No route of the Node answers on a preview name.
- A preview keeps the port it opened on, so a stolen cookie reaches one port.
- A certificate issued for the name appears in the public certificate logs.
- A grant lasts 12 hours and ends when the Node restarts.

## Fix

In `acorn-cloud`, before it serves previews:

- Refuse `PUT /account/v1/preview/challenge` unless the owner turned previews on. For example, the Node
  could report the switch with its registration, or the account website could hold its own copy.
- Say on the account website, where a person turns on remote access or opens a preview, that the
  service can read previews.
- Optional: watch certificate transparency logs for the preview domain and alert on a certificate no
  Node ordered. That detects the attack and doesn't stop it.

## How to check the fix

- A service test that a challenge for a Node with previews off answers an error and publishes nothing.
- Read the account website's text against [who can read a preview](../../relay/phone-channel.md#previews).

## Related

- [Previews in the account API](../../account-api/previews.md).
