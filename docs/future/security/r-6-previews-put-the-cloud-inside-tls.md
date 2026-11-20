# R-6: Previews put the account service inside the encryption

Found November 20, 2026, in a read-only security review of `jamesmacfie/acorn` at `31ff472da` and
`acorn-cloud` at `19fa594`. Severity: medium, latent. Confidence: follows from the design, not run
live. Status: open. The hosted service doesn't serve previews at that commit.

## What goes wrong

On every other remote path the relay carries bytes it can't read, because the client pins the Node's own
key. A preview is different. Its name sits under a domain the account service owns, and a public
certificate authority vouches for it. Whoever controls that domain's DNS can get a second valid
certificate for the same name and stand between the phone's browser and the Node. From there they read
the preview's entry key and cookie and use them at the Node, which then proxies their requests to the
task's dev server as a local caller.

## Who can do it

The account service's operator, or anyone who breaches it or its DNS. They need a phone to open a
preview while they are in the path. An agent that stole the Node's relay credential gets part of the
way, as [L-2](./l-2-read-block-exposes-relay-credential.md) describes.

## How it goes

1. A Node serves previews on `*.<node>.<preview domain>`. The account service names the domain and the
   certificate authority (`packages/node-core/src/server/transport/preview/accountPreview.ts:9`), and it
   publishes the DNS record that proves the name
   (`packages/node-core/src/server/transport/preview/certificate.ts:111`). It can publish the same proof
   for a key of its own.
2. The relay, run by the same party, routes a browser's connection by the server name
   (`apps/relay/src/relay.ts:292-321`). It can end that connection itself with the second certificate.
   The browser shows nothing unusual.
3. The first request carries the one-time entry key in its address, and later ones carry the cookie
   (`packages/node-core/src/server/transport/preview/previewServer.ts:74-88`). The party in the middle
   reads both and replays them to the Node.
4. The Node proxies each request to the dev server with `Host: localhost:<port>`, from loopback
   (`packages/node-core/src/server/proxy/loopbackProxy.ts:71-86`). A dev tool that opens a console, a
   file listing, or a debugger to local callers opens it to this one.

The relay credential alone authorizes publishing the DNS proof
(`packages/node-core/src/server/transport/preview/accountPreview.ts:17-24`,
`packages/node-core/src/server/transport/listener.ts:256-263`). The same credential takes the Node's
route at the relay. So an agent that read it from `node.json` can get a certificate for the Node's
preview names and answer on them. The Node's code for this exists at this commit, which is the condition
L-2 names for its severity to rise.

## What limits it

- `acorn-cloud` answers `404` for the preview routes (`acorn-cloud:src/api.ts:306-308`), so no Node gets
  a certificate from the hosted service at that commit.
- The reach is the task's dev server, not the Node's API. No route of the Node answers on a preview name.
- A certificate issued for the name appears in the public certificate logs.
- A grant lasts 12 hours and ends when the Node restarts.

## Fix

No change makes a browser pin a key, so the fix is to bound the exposure and say what it is:

- Give previews their own switch, off until the owner turns it on, separate from **Remote access**. A
  person who wants a phone to reach their Node hasn't agreed to put a dev server behind a public name.
- Fix [L-2](./l-2-read-block-exposes-relay-credential.md) before the hosted service serves previews, so
  an agent can't order a certificate.
- Fix [L-6](./l-6-agent-retargets-an-open-remote-preview.md), so a stolen cookie reaches one port.
- Correct the pages listed under Related. They say the relay learns names and times only.
- Optional: have the Node read the certificate logs for its label and warn about a certificate it didn't
  order. That detects the attack and doesn't stop it.

## How to check the fix

- A unit test that `PREVIEWS.open` answers `off` on a Node with **Remote access** on and the preview
  switch off.
- The checks in L-2 and L-6.
- Read the corrected pages against this report.

## Related

- [R-1](./r-1-account-website-runs-code-through-a-phone.md) and
  [R-2](./r-2-account-service-relays-a-pairing-and-keeps-the-token.md): the other ways a breached
  account service reaches a Node.
- Docs that make a claim this finding contradicts:
  - [Previews](../../relay/phone-channel.md#previews) says the relay "passes the bytes on by name and
    reads only the server name in the first record" (`docs/relay/phone-channel.md:112-114`), and lists
    what the relay learns as names and times (`docs/relay/phone-channel.md:168`).
  - [What the relay can and can't see](../../relay.md#what-the-relay-can-and-cant-see) says a relay
    breach gives away who connected when, not what they did (`docs/relay.md:143-146`).
  - [The account service](../../security/control-plane.md#the-account-service) says the service can't
    read relayed traffic (`docs/security/control-plane.md:50-51`).
- [Previews in the account API](../../account-api/previews.md).
