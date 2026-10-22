# The phone through the account website

Date: October 22, 2026. Status: proposed. This file covers how the phone app reaches a Node with no
Tailscale and no gateway: the app served from the account website, its own encrypted connection
through the relay, a device record for each phone, and what retiring the gateway removes.
[The mobile web app](../../mobile.md) and [the mobile gateway](../../security/mobile-gateway.md) own
the shipped design this replaces.

## Why the gateway goes

The gateway does three jobs for the phone ([why](../../security/mobile-gateway.md#why)):

1. It presents a certificate the phone's browser trusts, by sitting behind `tailscale serve`.
2. It serves the app's files from the Node's machine, so the Node can't replace them.
3. It holds the Node's device token, because a browser can't set a header on a WebSocket upgrade and
   can't pin the Node's self-signed certificate.

With the account website serving the app, the first two jobs move to the website. With the phone
running its own encrypted connection to the Node, the third job goes away. The gateway is left with
nothing to do, and it's also what makes the phone setup a list of commands someone has to keep
running.

Retiring it also fixes two of its limits ([limits](../../security/mobile-gateway.md#limits)). The Node
sees every phone behind a gateway as one device, so you can't revoke one phone from the Node, and its
audit log can't tell phones apart. Each phone becomes its own device.

## The app on the account website

The account website serves the built phone app, `apps/mobile/dist`, at a fixed path under one
ordinary public certificate. The app signs in to the account with the website's session cookie, lists
the account's Nodes, and asks for relay tickets. It installs to the home screen and runs its service
worker as today ([install it](../../mobile/phone-setup.md#install-it)).

The website serves the code, so it could ship code that reads the traffic. That's true of every web
app. It's a smaller trust ask than a server that decrypts everything, because someone would have to
change the code on purpose, and the change would be visible in the served files. State this plainly
on the account page and in [security](../../security.md) when it ships.

Who serves the files was one of the five open decisions for a browser host
([remote.md](../remote.md#build-a-single-node-browser-host)). This programme answers it for the
phone: the account website, under the trust cost above.

## The encrypted channel

A phone browser can't run TLS inside a WebSocket. So the phone and the Node run a separate encrypted
handshake over a relay stream ([relay](./relay.md#how-the-phone-connects)):

- Each Node has a channel key pair, kept in its data root beside its TLS key. The public half is
  registered with the account service when remote access is turned on
  ([accounts](./accounts.md#the-nodes-owner-account)).
- The phone learns the Node's public channel key from the account listing, and keeps it after
  pairing. A later handshake against a different key is refused, the way a changed fingerprint is
  refused today.
- Inside the channel, the phone sends requests and event frames in the shapes the gateway uses today
  (`/node` forwarding and the `/events` socket messages), with its own device token as the bearer.
  The Node's channel endpoint turns each request into an ordinary call to its own router, so auth and
  routes run unchanged.

Use a vetted implementation of a published protocol, such as a Noise handshake. Never write the
handshake by hand. The repository has no crypto library today, so the choice is an open question in
[phase 4](./04-phone.md#open-questions).

A relayed stream is never a loopback peer, so the routes that trust a loopback caller (pairing asks
without an assertion, reach changes, and stop) refuse it with no blocked list.

## A device for each phone

Each phone pairs as its own device by pairing by approval ([pairing](./pairing.md#ask-from-anywhere)).
Its first pairing happens at home, like any first remote device.

The phone stores its device token in IndexedDB, encrypted under a non-extractable WebCrypto key. That
protects a copy of the browser's storage. It doesn't protect against script running in the app itself,
as [remote.md](../remote.md#implement-browser-plugin-custody) records for browser custody.

## What a phone device may do

The gateway's blocked list keeps a phone off the routes it has no screen for
(`apps/mobile/src/gateway/denylist.ts`). A phone's own device would have full owner power, so the
list moves into the Node. A device paired from the phone app is marked as a phone device, and the Node
refuses it:

- opening a pairing window and managing devices, but not answering a pairing ask, which a phone may
  now do;
- every plugin write under `/v1/core/plugins`
  ([T4 in the October 22 review](../../security/review-2026-10-22.md#findings));
- backup and restore, security settings, reach changes, and stopping the Node.

A phone device that goes unused for 30 days is revoked, the rule
[T3 in the October 22 review](../../security/review-2026-10-22.md#findings) sets for gateway sessions.

[T2 in the October 22 review](../../security/review-2026-10-22.md#findings) fixed a risk that exists
because the gateway serves the app and the Node's answers from one address. Through the channel, the Node's
answers reach the app's code as data and never load as a page on the app's address, so that risk goes
away. The app's own content security policy still applies.

## Several Nodes

The account lists every Node it owns, so the phone app lists them too and switches between them. Each
Node gets its own connection, device token, and query cache, as
[remote.md](../remote.md#add-multiple-nodes) requires. The `fleet` group in
`apps/mobile/src/client/platform.ts` gains the read and select verbs it rejects today.

## What changes in the app

Only the `transport` and `fleet` groups in `apps/mobile/src/client/platform.ts` talk to the gateway.
They change to talk to the account website and the channel. The shell, the screens, and narrow mode
stay as they are. The sign-in screen changes from a typed code to account sign-in, then a list of
Nodes, then pairing.

## What gets deleted

When phase 4 ships:

- `apps/mobile/src/gateway` and its tests.
- The `acorn mobile` command and its bundle entry.
- `pnpm dev:mobile:gateway`, and the gateway half of `pnpm dev:mobile`.
- The Tailscale steps in [use it on a phone](../../mobile/phone-setup.md) and the gateway reference in
  [the mobile gateway](../../security/mobile-gateway.md).
- The gateway fixes from [the October 22 security review](../../security/review-2026-10-22.md).
  Their rules carry over as listed in [what a phone device may do](#what-a-phone-device-may-do).

Someone who never signs in runs their own relay in self-hosted mode and serves `apps/mobile/dist`
from a host with a trusted name.

## Verify before building

Check how the gateway's `/node` forwarding and `/events` messages are shaped in
`apps/mobile/src/gateway/gateway.ts`, since the channel carries the same shapes. Check that the
supported phone browsers offer non-extractable WebCrypto keys and the primitives the chosen protocol
needs.
