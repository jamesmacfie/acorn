# Phase 4: the phone through the account website

Date: October 22, 2026. Status: built October 22, 2026, on branch `phase-4-phone`, except for staging, a domain,
and a real phone.

## Completion note

October 22, 2026.

### What landed

Open source, in this repository:

- **The channel library, `packages/channel` (`@acorn/channel`).** `secure.ts` runs the Noise handshake over a
  relay stream and gives length-prefixed messages. `client.ts` is the phone's end: requests that wait for
  their answers, the event feed, and a heartbeat. `errors.ts` holds the two errors a caller tells apart. The
  same code runs in the Node and in a browser. Its messages are `@acorn/protocol/channel.ts`.
- **The Node's end.** `server/transport/channel.ts` turns each request into a call on the Node's own router,
  as a peer with no address, and joins the event feed to the same hub a WebSocket joins (`HubSocket` and
  `WsHub.join` in `wsHub.ts`). The key pair is `channel/key.pem` in the data root (`channelKey.ts`). The
  tunnel hands `browser` streams to it, and the listener loads it, and the key, on the first one.
- **The relay.** A browser offers its ticket as a subprotocol, and the relay selects only its own name. The
  `browser` kind is specified in `apps/relay/PROTOCOL.md`.
- **The account API.** `channelKey` in registration and in the list, the four routes a browser calls with the
  website's cookie and `X-Acorn-Account: 1`, and `GET /account/v1/browser/sign-in`. The types, the schema
  file, the stand-in, and the conformance suite (22 tests) carry them. The conformance suite moved to
  [test an account service](../../account-api/testing.md), and [browsers](../../account-api/browsers.md) is new.
- **Phone devices.** `devices.kind` (migration 0016), set by the transport the pairing claim arrives on.
  `middleware/phoneRules.ts` refuses a phone's device the families the gateway refused, except answering a
  pairing request, and a phone unused for 30 days is revoked at its next request.
- **The phone app.** It signs in to the account, lists its Nodes, pairs with one, keeps a channel for each,
  switches between them, shows the pairing dialog, and says when a Node signed it out. Its token is sealed in
  IndexedDB under a non-extractable AES-GCM key. The app is built under `/app/`.
- **Settings → Nodes** lists each Node's paired devices, marks phones, and revokes one.
- **Deleted:** `apps/mobile/src/gateway`, `acorn mobile` with its bundle entry and staging, `pnpm
  dev:mobile:gateway`, the Tailscale steps, and the gateway page. `pnpm dev:mobile` now serves the app against
  the stand-in (`pnpm dev:account`, which now has fixed ports and `ACORN_DEV_RELAY_URL`).
- **Docs:** [the phone channel](../../relay/phone-channel.md) owns the design. The account API, the relay,
  the mobile pages, security, authentication, the transport reference, the data root, and the startup budget
  are updated.

Hosted service, in its own repository, one commit on its `main` ("Phase 4: Serve the phone app, and answer it
with the website's cookie", `df05403`). It stores and lists the channel key, answers the four routes with the
cookie, redirects `browser/sign-in` to its GitHub sign-in, and serves the built app under `/app/` when
`MOBILE_APP_DIR` names it. It passes the same 22-test conformance suite, plus 8 tests of its own.

### Decisions and deviations

- **The library is `@chainsafe/libp2p-noise`, not `@hyperswarm/secret-stream`.** The person chose secret-stream
  on October 22, 2026, with this as the fallback. It bundles for a browser (192 KB, 59 KB gzipped), but the
  first handshake message throws in WebKit and Chromium. `noise-curve-ed` needs `crypto_scalarmult_ed25519`
  and `crypto_scalarmult_ed25519_noclamp`, `sodium-javascript` 0.8.0, the latest, has neither, and the
  library swallows the error ("Noise handshake failed"). Supplying them means writing Ed25519 scalar
  multiplication by hand, which the rules forbid. libp2p-noise runs in both browsers. It needs a small
  stream subclass from `@libp2p/utils` and stub components, and it takes the pin natively: the initiator
  passes the Node's identity key and a wrong one fails with `UnexpectedPeerError`. The hand-written
  HPKE-style option stays rejected.
- **What it costs.** The phone's lazy chunk is 200,726 B, 65,342 B gzipped (October 22, 2026). The Node's lazy
  chunk is 321,133 B and imports only Node built-ins, so a packed Node needs no new runtime package.
  Dependencies: `@chainsafe/libp2p-noise` 17.0.0, `@libp2p/crypto`, `interface`, `logger`, `peer-id`, and
  `utils`, and `uint8arraylist`, which bring `@noble/curves`, `ciphers`, and `hashes`, `protons-runtime`, and
  `weald` for logging. About 40 packages in all. It couples Acorn to libp2p's stream API (`MessageStream`,
  version 3 of the interface), and `packages/channel/src/secure.ts` is the one file that touches it.
- **A shared package, not copies.** Both ends need the handshake code, so it lives in `@acorn/channel`. It
  imports no `node:` module, which an architecture test checks.
- **Messages are a JSON header and bytes, not the gateway's shapes.** The channel is a byte stream with its own
  length prefix, so a body travels as bytes with no base64. `intent` and `cleanup` are gone: there is one
  viewer on one connection, and a new channel makes client-core re-attach, as a reconnect always did.
- **The channel marks the device, not the phone.** Marking by what the phone says would let a hostile phone call
  itself a desktop, so the claim route reads `Env.browserChannel`, which only the channel endpoint sets.
- **The phone refusal list is a denylist.** An automated review asked for an allowlist. The phone draws the
  desktop's panes, which read most routes, and the phase asked for the gateway's families, so the list is
  the gateway's, with answering a pairing request allowed. An allowlist needs every route those panes use
  named first, and is still worth doing.
- **A phone approves a pairing.** The review also noted that a phone-approved pairing makes a full device.
  That is the rule this phase carries ([pairing](./pairing.md#approve-on-any-paired-device)), and checkpoint 7
  needs it. Raising a request still needs the account assertion, so an attacker needs the phone's account
  session as well as its token. The trust list in the phone channel page says so.
- **The app lives at `/app/`.** See question 3.
- **A device list is new UI.** Checkpoint 8 says to revoke a phone in Settings → Nodes, and no screen listed
  another device, only `acorn node devices`. Each Node's row now lists its devices, with **Revoke**.
- **Node links close when idle, and only the Node on screen holds the event feed.** A Node nobody has used for
  30 seconds closes its channel.
- **A phone can't sign out of the account, and can't revoke its own device.** Revoking is a refused route, so
  **Forget** drops the phone's record and leaves the device on the Node's list. The website's account page
  lists browser sessions, which ends the account session.
- **`pnpm dev:account` has fixed ports** (48781, 48782), and `ACORN_DEV_RELAY_URL` for a tunnel or a proxy.
- **The startup budgets moved.** The Node service graph is 1,936,922 B against 1,934,814 B on the base commit
  (+2,108 B), under the unchanged 1,939,000 B ceiling with 2,078 B of headroom. The channel, its key, and the
  tunnel are lazy chunks, and a test run of the built bundle shows none in the static closure. The phone's
  first screen is 506,975 B against 502,570 B on the base commit (+4,405 B), and its ceiling rose from
  507,000 B to 520,000 B for the token store, the Node links, and the channel plumbing.
- **Architecture lists grew.** `@acorn/protocol` allows 99 entrypoints, `@acorn/client-core` 213 (the fleet
  actions), and `@acorn/node-core` 70 (the channel key, and one fewer for the gateway's pairing codes). The
  relay protocol's `browser` kind is on the plugin-name exceptions, and two rules replace the gateway's:
  the phone's app holds no custody, and the channel library imports no Node module.

### Open questions

1. **Which library?** `@chainsafe/libp2p-noise`, as above.
2. **Does the phone keep the key from the listing, or only after pairing?** It keeps it. The key it takes
   from the account's list at the moment it pairs is the one it holds from then on, and the list is read only
   until it's paired.
3. **Where is the app served?** A path on the account website, `/app/`. The app calls the account API with the
   website's session cookie, so it has to share the website's origin, and its own name would need a cookie
   across hosts and cross-origin calls to the account. The cost is Vite's `base`, the router's `base`, a
   service worker at `/app/sw.js`, relative manifest paths, and `appHref` for the two plain links.
4. **How does someone who never signs in run the app against a self-hosted relay?** They can't yet, and this
   phase doesn't build it. The key a phone pins comes from the account's list. Without one, the phone needs
   the relay's address, a credential made of characters a subprotocol allows, and the Node's key, typed or
   scanned from somewhere the Node shows them. Which of those to show, and how the phone trusts a key it was
   handed by hand, is a product decision for phase 5. The relay already accepts a static credential from a
   browser.

### Checkpoints

Run on October 22, 2026, on this machine, in WebKit and Chromium at 390 by 844, **not on a real phone**,
against the stand-in (`pnpm dev:account`), its relay, two standalone Nodes, and `pnpm dev:mobile`. The
staging website, a domain, and a tunnel weren't used and aren't set up.

| Checkpoint | Result |
| --- | --- |
| 1. A channel from a test page | Passed. The phone app opened a browser stream through the relay, finished the handshake, and read `/v1/core/workspaces` with a device token, in both browsers. `apps/relay/src/phoneChannel.test.ts` does it against a real Node and a real relay. |
| 2. A changed key is refused | Passed. After the Node's `channel/key.pem` was replaced, the page showed "Identity changed" and made one handshake attempt, with no retry. The unit test and the relay test refuse a wrong pin too. |
| 3. The relay sees only ciphertext | Passed. A proxy kept the 17,439 bytes of a phone's session. It held none of `Studio work`, `/v1/core`, `acorn_dt_`, `authorization`, or `HTTP/1.1 200`. The upgrade request, with the ticket as a subprotocol, is readable, as it must be. |
| 4. Pair a phone at home | Passed, with a desktop browser, the dev server, and the stand-in in place of the staging website. The phone showed three words, the Node's own device allowed it, and the phone listed the Node's workspaces. The hosted website serves the built app (its tests), and a walk through it with real GitHub wasn't run. |
| 5. Away from home | Approximated. The proxy cut every phone connection at the relay's door and left the Nodes alone. The page showed the Node offline, kept retrying, and was back 929 ms (WebKit) and 768 ms (Chromium) after the network returned. A read then answered `200`. Answering an agent's question wasn't tried, because the isolated sessions have no agent harness. |
| 6. Refused routes | Passed. A phone's device got `403 phone_refused` for opening a pairing window, listing devices, a plugin write, backup, and stop, in both browsers and in the relay test. |
| 7. Approve from the phone | Passed. `pnpm dev:agent` (a real Tauri window) asked to connect a Node in Settings → Nodes. The phone showed "Allow a new client?" with the same three words, **Allow** paired the window, and it showed the Node as in its fleet. |
| 8. Revoke one phone | Passed. With two phones paired, **Revoke** in Settings → Nodes signed out only that one. It showed "This phone was signed out of this Node", and the other kept reading. The audit log names each phone at pairing and the device that revoked. |
| 9. Switch Nodes | Passed. With two Nodes on the account, the phone paired with both and switched between them. Each answered with its own workspace, each token and nonce was its own record, and each Node had its own cache. A pairing dialog belongs to the Node on screen. |
| 10. Nothing references the gateway | Passed. A search finds `mobile/src/gateway`, `acorn mobile`, and `mobile-gateway` only in the dated mobile and remote access phase files and the October 22 review. |
| Inert Node | Passed. A Node with no relay settings and no sign-in, run from this checkout with a module log, opened no socket beyond its listener, made no `channel/` folder, and loaded no libp2p or channel module. In the built bundle, the static closure holds none. `remoteAccess.test.ts` still shows two such Nodes call no account service. |
| Packed Node | Not run end to end. `pnpm pack:node` is red on main for unrelated reasons. The Node's channel chunk imports only built-ins and loads under plain Node. |

### Evidence

All on October 22, 2026, with the relay on the same computer, so these are costs of the code, not of a network.
The phone writes each step as a `performance` measure named `acorn.channel.<step>`.

| What | WebKit | Chromium |
| --- | --- | --- |
| First connection of a page: ticket, relay stream, handshake | 5-8 ms, 10-11 ms, 170-239 ms | 2-3 ms, 3-6 ms, 10 ms |
| Later connections: handshake | 5-17 ms | 5 ms |
| Back online after the network returns (retries 250 ms, doubling) | 929 ms | 768 ms |

The first WebKit handshake includes loading the lazy chunk and making the first key pair.

### For later phases

- **Phase 5.** Question 4 is open. The website's `/app/` files, their policy, and the 30-day phone limit have
  no metering or abuse limits yet. The relay still counts nothing. A real iPhone and Android run is open
  ([the acceptance](../../testing/mobile-on-a-phone.md)). It needs the stand-in announced at an address a
  phone can reach, which `ACORN_DEV_RELAY_URL` and a tunnel give.
- **A Node registered before this phase** has no channel key, and the phone tells the person to turn **Remote
  access** off and on.
- **The device list reads once.** It doesn't refresh while the page is open.
- **`acorn node devices` doesn't show `kind`.** Its output schema is published, so the field would be an
  addition to it.

## Goal

Serve the phone app from the account website and connect it to Nodes through the relay with its own
encrypted channel. Each phone pairs as its own device and can approve pairing asks. Delete the gateway
and the Tailscale setup.

## What you can deploy at the end

A person opens the account website on their phone, signs in, picks one of their Nodes, and pairs it
(the first time at home). After that the phone works from any network, approves new devices, and
switches between Nodes. `acorn mobile` and `apps/mobile/src/gateway` are gone.

## Starting point

- Pairing from anywhere, from [phase 3](./03-pairing.md).
- The relay's stream kind field, from [phase 1](./01-relay.md).
- The phone app in `apps/mobile/src/client`. Only the `transport` and `fleet` groups in
  `apps/mobile/src/client/platform.ts` talk to the gateway.
- The gateway in `apps/mobile/src/gateway`: request forwarding and event messages in `gateway.ts`,
  and the blocked list in `denylist.ts`.
- The gateway fixes from [the October 22 security review](../../security/review-2026-10-22.md), findings T2
  to T5.
- The design in [phone](./phone.md).

## In scope

- The Node's channel key pair and its registration with the account service.
- Browser streams on the relay and the Node's channel endpoint.
- The phone's `transport` and `fleet` groups over the channel, and account sign-in in the app.
- A device for each phone, its token stored under a non-extractable key, and the phone device rules.
- The approval dialog on the phone.
- Switching between Nodes.
- Hosted service: serving the built `apps/mobile/dist` from the account website. The app's code
  stays open in this repository.
- Deleting the gateway, `acorn mobile`, and the Tailscale docs.

## Out of scope

Push notifications, loaded plugins on the phone, and a native app, which stay in
[mobile work after the first release](../mobile/later.md).

## Steps and checkpoints

### 1. Choose the channel library

Pick a vetted implementation of a published handshake, such as Noise, that runs in the Node and in
the supported phone browsers. Write down why, and what it depends on.

### 2. The channel

Add the channel key pair to the Node's data root, add its public half to Node registration in the
account API and the stand-in, and route browser streams
to a channel endpoint that turns each request into a call on the Node's own router.

**Checkpoint 1: a channel from a test page.** From a test page in a desktop browser, open a browser
stream through a local relay, finish the handshake against the Node's key, and read
`GET /v1/core/projects` with a device token.

**Checkpoint 2: a changed key is refused.** Replace the Node's channel key. The test page should
refuse the handshake.

**Checkpoint 3: the relay sees only ciphertext.** Capture the relay's traffic during checkpoint 1. It
holds no readable HTTP.

### 3. The phone app over the channel

Rewrite the `transport` and `fleet` groups to sign in to the account, list Nodes, fetch tickets, and
talk over the channel. Replace the code sign-in screen with account sign-in, then the Node list, then
pairing.

Develop against the stand-in account service and a local relay, serving the app from the dev
server.

**Checkpoint 4: pair a phone at home.** On a phone on the home network, open the staging website,
sign in, pick the Node, and approve on the desktop. The phone shows the Node's workspaces.

**Checkpoint 5: away from home.** Turn off Wi-Fi on the phone. On mobile data, the phone reconnects
and an agent's question can be answered.

### 4. Phone device rules and approvals

Mark phone devices. Refuse them the families in [phone](./phone.md#what-a-phone-device-may-do), allow
them to answer pairing asks, and revoke one unused for 30 days. Add the approval dialog to the phone.

**Checkpoint 6: refused routes.** From the phone's device, opening a pairing window, a plugin write,
backup, and stop are each refused.

**Checkpoint 7: approve from the phone.** A new laptop asks to pair while the phone is the only device
online. The phone shows the dialog, and **Allow** pairs the laptop.

**Checkpoint 8: revoke one phone.** Pair two phones. Revoke one in **Settings → Nodes** on the
desktop. Only that phone is signed out, and the audit log names each phone.

### 5. Several Nodes

**Checkpoint 9: switch Nodes.** With two Nodes on the account, pair the phone with both and switch
between them. Data, tokens, and pending answers stay with their own Node.

### 6. Delete the gateway

Delete `apps/mobile/src/gateway`, `acorn mobile` and its bundle entry, `pnpm dev:mobile:gateway`, and
the Tailscale steps. Point `pnpm dev:mobile` at a local account service and relay.

**Checkpoint 10: nothing references the gateway.** A search of the repository for the gateway's
modules and `acorn mobile` finds only history.

## Acceptance

- The phone works from any network through the relay, with no Tailscale and no command left running.
- The relay and the website can't read the phone's traffic.
- Each phone is its own device. Revoking one leaves the others.
- A phone device can answer pairing asks and is refused the families the gateway refused.
- The gateway and its docs are gone.

## Docs to update when it ships

- [The mobile web app](../../mobile.md): the platform seam, sign-in, and several Nodes.
- [Use it on a phone](../../mobile/phone-setup.md): the website instead of Tailscale.
- The mobile gateway page: delete it, or replace it with the phone device rules and the channel's trust
  model ([the phone channel](../../relay/phone-channel.md)).
- [The command line](../../cli.md): remove `acorn mobile`.
- [Remote access to a browser host](../remote.md): the phone's answers to the five decisions.
- [Security](../../security.md): the website-serves-the-code trust cost.

## Open questions

1. Which channel protocol and library?
2. Does the phone keep the Node's channel key from the account listing, or only after pairing?
3. Where is the phone app served: a path on the account website, or its own name?
4. How does someone who never signs in run the phone app against a self-hosted relay?

## Evidence

The measured times are in [the completion note](#evidence).

## Verify before building

Check which phone browsers the [acceptance checklist](../../testing/mobile-on-a-phone.md) covers,
and that each offers non-extractable WebCrypto keys and the chosen protocol's primitives.
