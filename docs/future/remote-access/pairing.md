# Pairing from anywhere

Date: October 22, 2026. Status: proposed. This file covers how a signed-in person finds their Nodes,
pairs a new device with one while away from it, and approves that device on one they already paired.
[Authentication](../../authentication.md#pairing) and
[pairing by approval](../../api-reference/transport.md#pairing-by-approval) own the shipped flow this
extends.

## What changes for a person

Today, pairing a laptop with a Node at home takes one of two things. Either someone at the Node's
machine clicks **Allow**, or you type a code read off that machine. A Node on another machine also asks
you to compare six identity words.

After this programme:

1. You sign in on the new laptop. **Settings → Nodes** lists the Nodes your account owns.
2. You pick one and click **Connect**. The laptop shows three words.
3. Your phone, or any other device already paired with that Node, shows "MacBook, signed in as James,
   wants to connect" with the same three words. You tap **Allow**.
4. The laptop is paired. No code, no identity words, nobody at home.

The first remote device still pairs at home, by a click on the Node's machine or with a code read
there. After that, any paired device can approve the next.

## Your account lists your Nodes

The sign-in plugin contributes a Node provider ([Node providers](../../plugins/node-providers.md#node-providers)).
Its `list` returns each Node the account registered with remote access: the Node ID, label, TLS
fingerprint, relay route, and whether the Node is connected to the relay.

The fingerprint comes from the account service, which recorded it when the Node registered itself
over its owner's signed-in connection ([accounts](./accounts.md#the-nodes-owner-account)). The client
pins that fingerprint, so the six-word check is skipped for Nodes the account lists. A Node you reach
by address, not through your account, still shows the words.

## Adopt by pairing

The provider path today hands the client a device token the provider already holds:
`POST /v1/core/nodes/adopt` in `packages/node-core/src/server/routes/nodeProviders.ts`
refuses a record without `enrollment.deviceToken`. That fits a provider that created the Node. It
doesn't fit an account that only knows where your Node is, and the account service must never hold a
device token.

So account-listed Nodes need a second way to adopt. The provider supplies the fingerprint and relay
route, and pairing by approval supplies the credential:

1. The client takes the listed record, opens a relayed connection, and pins the listed fingerprint.
2. It raises a pairing ask over that connection, with an account assertion
   ([ask from anywhere](#ask-from-anywhere)).
3. A paired device approves, and the client collects its device token by the existing claim route.
4. The client stores a normal fleet record: endpoint, fingerprint, relay route, and device token.

Decide in phase 3 whether this is a new route beside `/adopt` or a client-side flow that only reads
the listing. The client-side flow needs no new Node route.

## Ask from anywhere

Approving an ask is already open to any paired device. `POST /v1/core/pair/requests/:id` sits behind
the device gate in `packages/node-core/src/server/routes/pairing.ts`. What's limited is raising one:
`POST /v1/pair/requests` answers `403 pairing_local_only` unless the caller is a loopback peer. The
comment there gives the reason: a dialog anyone on the network could raise is a dialog the owner
learns to click through.

The change keeps that reason. A relayed ask is allowed when it carries a valid account assertion whose
subject is the Node's owner account ([accounts](./accounts.md#account-assertions)). Only the owner can
raise the dialog. A stranger who reaches the relay, or a breached relay, can't. Everything after the
ask is unchanged: the three-word phrase on both screens, the ask ceiling of six a minute, an
overlapping ask cancelling both, and the claim by secret.

A Node with no owner account, or with remote access off, keeps the loopback-only rule.

## Approve on any paired device

The Node already broadcasts a content-free `pairing:requested` frame to every paired client. Today
only the desktop shows the dialog
([node-tray starting point](../node-tray/README.md#starting-point)). This programme adds it to:

- **The terminal client**, in phase 3.
- **The phone**, in phase 4. The gateway's blocked list refuses every pairing route today
  (`apps/mobile/src/gateway/denylist.ts`). With the gateway retired, a phone's own device may answer
  asks but not open a code window or manage devices ([phone](./phone.md#what-a-phone-device-may-do)).

The browser extension waits. The dialog shows the device name, the account it signed in as, the three
words, **Allow**, and **Deny**. The first device to answer wins, and the others close their dialog
when the request is gone.

## A headless Node

A Node installed with no desktop ([node-tray](../node-tray/README.md)) has nobody to click **Allow**
on its own machine. Its owner pairs the first device with `acorn node pair` and a code, then approves
later devices from that one.

## Trust cost

The account service vouches for each Node's fingerprint. If it were breached, it could list an
impostor Node with the impostor's fingerprint and route. A person who connects to that listing pairs
with the impostor and sends it their work. It still couldn't get into the real Node, because only a
paired device can approve an ask there.

The six-word check is what guards against that today. Skipping it for listed Nodes trades that
protection for a pairing step people can do away from home. State this on the account page and in
[security](../../security.md) when it ships.

## Verify before building

Read `packages/node-core/src/server/auth/pairingRequests.ts` and check how the dialog's request is
tied to the Node that broadcast it, since a remote approver may hold several Nodes. Check how
`FleetBridge.adopt` stores a provided Node, since adopt by pairing stores a device token the provider
never had.
