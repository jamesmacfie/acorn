# Phase 6: Preview through the Node

Date: October 23, 2026. Status: proposed. Design first. Depends on the Node route in
[split phase 10](../split/10-remote-preview-proxy.md).

## Goal

The phone's Preview pane shows a task's running app in an iframe. The page comes from the Node's
loopback through the Node, over TLS that the Node ends, and the relay forwards bytes it can't read.

## What you can deploy at the end

- **The Node:** a preview listener with a publicly trusted certificate for its preview names, in
  front of split phase 10's proxy route.
- **The relay:** a TLS listener that routes by the name a browser asks for, through Server Name
  Indication (SNI), and passes the bytes to the Node as a `preview` stream.
- **Hosted service:** DNS for the preview domain, pointed at the relay, and an account API route that
  publishes a Node's DNS challenge.
- **The phone:** a Preview pane that draws an iframe.

## Starting point

- On the desktop, Preview is a native web view at the dev server's address, with
  `requires: { seam: 'preview' }` and `formFactor: ['desktop']`
  (`plugins/preview/src/client/paneContribution.ts`). The pane is off for every Node that isn't local
  (`remotePreviewBlocked` in `packages/client-core/src/infra/node/previewUrl.ts`).
- The preview plugin's Node half resolves each task's address
  (`plugins/preview/src/server/previewUrls.ts`). A port resolves to `http://localhost:<port>`.
- Split phase 10 designs `ctx.routes.loopback`, a core route kind that proxies HTTP and WebSocket
  upgrades to a loopback port under fixed rules. The preview plugin registers it at
  `/v1/p/preview/tasks/:taskId/proxy/*`. The same phase designs the desktop helper's listener for each
  preview. Neither is built.
- The relay speaks WebSocket only. Its stream kinds are `tls` and `browser`, and a Node refuses a kind
  it doesn't serve (`apps/relay/PROTOCOL.md`).
- A browser can't load a page from bytes on the phone channel, by design: a page on the app's address
  would run with the phone's session ([trust](../../relay/phone-channel.md#trust)).

## The design to write

Write this out in full before any code. The outline:

1. **Names.** Each Node gets an opaque label, and each open preview a random one:
   `<preview>.<node>.<preview domain>`. Neither is a task ID, because the relay sees the name, and
   certificate transparency logs publish the Node's.
2. **The certificate.** The Node asks an ACME certificate authority for a wildcard certificate for
   `*.<node>.<preview domain>`, with a DNS-01 challenge. It asks the account service, as the Node, to
   publish the challenge's TXT record. The private key stays on the Node, and the Node renews the
   certificate before it expires.
3. **The relay.** A TLS listener on the preview domain reads the server name from the client's first
   message, finds that Node's tunnel, and opens a `preview` stream with the raw bytes. It never ends
   TLS.
4. **The Node.** It ends TLS on a `preview` stream with the preview certificate, maps the preview
   label to a task, and hands the request to split phase 10's proxy rules. Nothing else answers on
   these names, the Node's API included.
5. **Who may load it.** The phone opens a preview over the channel, as a paired device. The Node
   answers with a one-time entry address. The first request trades it for a cookie on that preview's
   name only, as phase 10's helper listener does on loopback.
6. **The page's limits.** Every response carries phase 10's content security policy, so the page
   reaches only its own origin and can't reach the phone's network.
7. **The phone's pane.** A phone-only Preview pane, with `formFactor: ['mobile']` and
   `requires: { plugin: 'preview' }`, draws an iframe at the entry address. The phone app's
   `frame-src` gains the preview domain.

## In scope

- Split phase 10's Node route, if it hasn't shipped. Its desktop half isn't needed here.
- The account API route for the DNS challenge, with the stand-in and the conformance suite.
- The relay's preview listener and the `preview` stream kind, as an addition to protocol version 1.
- The Node's preview listener, certificate, renewal, and preview grants.
- The phone's Preview pane.

## Out of scope

- The desktop's view of a remote Node's preview. Split phase 10 builds it over the pinned connection
  the desktop already has, with no certificate.
- A preview address that isn't on the Node's loopback, as in split phase 10.

## Steps and checkpoints

### 1. Write the design

Answer the first open question, then write the design above in full: routes, message shapes, the
stream kind, header policies, and the names.

### 2. The Node route

Build split phase 10's loopback route, or confirm that it shipped.

### 3. Hosted service: the preview domain and the challenge route

Point the preview domain's wildcard DNS at the relay. Add the challenge route to the account API, the
stand-in, and the conformance suite ([test an account service](../../account-api/testing.md)).

### 4. The relay's preview listener

**Checkpoint 1: the relay reads nothing.** Capture traffic on the relay during a preview load. It
should hold TLS records only, with no readable HTTP.

### 5. The Node's listener and certificate

**Checkpoint 2: a trusted certificate.** Against a staging certificate authority, the Node gets and
renews a certificate for its preview names, and a browser accepts it.

### 6. The phone's pane

**Checkpoint 3: an app loads and reloads.** In Playwright WebKit at 390 by 844, a Vite app on the
Node's loopback loads in the pane, and a save on the Node reloads it without a page refresh.

**Checkpoint 4: no way in without a grant.** A request from another browser, with no cookie, gets 403.
A task token gets 403 when it asks for a preview.

**Checkpoint 5: no reach into the phone's network.** A probe page loaded through the preview makes no
request to a probe server on the phone's network.

**Checkpoint 6: real phones.** On an iPhone and an Android phone, repeat checkpoints 3 and 5.

## Acceptance

- A task's app loads and hot-reloads in the phone's Preview pane on both phones.
- The relay sees only TLS records.
- A preview opens only through a paired device's grant.
- The page reaches only its own origin.

## Docs to update when it ships

- `apps/relay/PROTOCOL.md`: the `preview` stream kind and the listener.
- [The phone channel](../../relay/phone-channel.md): opening a preview.
- The account API: the challenge route.
- [Features](../../features.md#phone): Preview on a phone.

## Open questions

- **Cookies in an iframe on iOS.** Safari blocks third-party cookies by default, and the preview's
  name is on a different site from the phone app's. A cookie set inside the iframe may not stick. The
  options are opening the preview as a full-screen page, where the cookie is first-party, asking for
  storage access with the Storage Access API on a tap, or carrying the grant another way. Answer this
  first, because it decides the pane's shape.
- **The ACME client.** Which library, and what it adds to the Node's service graph
  ([the node service budget](../../frontend/startup-budget.md#the-node-service)). Load it only on a
  Node with **Remote access** on.
- **Who owns the listener.** Core's transport, beside the phone channel, or the preview plugin's Node
  half. Split phase 10 puts the proxy rules in core.
- **A failed renewal.** What the pane says when the certificate expired and couldn't be renewed.
- **Traffic.** A dev build can be hundreds of requests, far more than API traffic.
  [Remote access phase 5](../remote-access/05-production.md) owns limits and metering.
- **What the relay learns.** It sees the Node's label, a random preview label, and when.

## Evidence

None yet.

## Verify before building

Check whether split phase 10 shipped, and recheck the relay's stream kinds in `apps/relay/PROTOCOL.md`.
