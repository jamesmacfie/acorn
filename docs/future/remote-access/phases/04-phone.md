# Phase 4: the phone through the account website

Date: October 22, 2026. Status: proposed.

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
- The gateway-only phases in the [security programme](../../security/README.md).
- The design in [phone](../phone.md).

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
[mobile work after the first release](../../mobile/later.md).

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

Mark phone devices. Refuse them the families in [phone](../phone.md#what-a-phone-device-may-do), allow
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

- [The mobile web app](../../../mobile.md): the platform seam, sign-in, and several Nodes.
- [Use it on a phone](../../../mobile/phone-setup.md): the website instead of Tailscale.
- [The mobile gateway](../../../security/mobile-gateway.md): delete it, or replace it with the phone
  device rules and the channel's trust model.
- [The command line](../../../cli.md): remove `acorn mobile`.
- [Remote access to a browser host](../../remote.md): the phone's answers to the five decisions.
- [Security](../../../security.md): the website-serves-the-code trust cost.

## Open questions

1. Which channel protocol and library?
2. Does the phone keep the Node's channel key from the account listing, or only after pairing?
3. Where is the phone app served: a path on the account website, or its own name?
4. How does someone who never signs in run the phone app against a self-hosted relay?

## Evidence

Record channel handshake times and phone reconnect times, with dates.

## Verify before building

Check which phone browsers the [acceptance checklist](../../../testing/mobile-on-a-phone.md) covers,
and that each offers non-extractable WebCrypto keys and the chosen protocol's primitives.
