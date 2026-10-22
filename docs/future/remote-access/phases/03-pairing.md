# Phase 3: pair from anywhere

Date: October 22, 2026. Status: proposed.

## Goal

A signed-in client lists the Nodes its account owns, with their fingerprints vouched by the account,
and pairs with one from anywhere. A device already paired with that Node approves the new one. The
six-word identity check goes away for Nodes the account lists.

## What you can deploy at the end

On laptop B, signed in, **Settings → Nodes** lists laptop A's Node. **Connect** shows three words. The
desktop or terminal client on any device already paired with A shows "B, signed in as James, wants to
connect" with the same words. **Allow** pairs B. Nobody needs to be at A.

## Starting point

- Accounts, registration, and tickets from [phase 2](./02-accounts.md).
- Pairing by approval in `packages/node-core/src/server/routes/pairing.ts` and
  `packages/node-core/src/server/auth/pairingRequests.ts`. Raising an ask is loopback only. Answering
  one is open to any paired device.
- The Node provider seam: `packages/node-core/src/server/nodeProviders/registry.ts`, and
  `POST /v1/core/nodes/adopt` in `packages/node-core/src/server/routes/nodeProviders.ts`, which needs a
  provider-held device token.
- The desktop's pairing dialog, the only client that answers asks today.
- The design in [pairing](../pairing.md) and [accounts](../accounts.md#account-assertions).

## In scope

- The sign-in plugin's Node provider, listing the account's Nodes.
- Adopt by pairing for listed Nodes.
- Account assertions, and relayed asks that carry one.
- The approval dialog in the terminal client.
- The extension's pairing screen listing the account's Nodes.

## Out of scope

Approval on the phone, which is phase 4. Approval in the extension. Letting the account admit a device
with no approval.

## Steps and checkpoints

### 1. List the account's Nodes

Add the Node provider to the sign-in plugin. Its `list` returns each registered Node with its label,
fingerprint, relay route, and relay state. **Settings → Nodes** shows them with **Connect**.

**Checkpoint 1: the list.** Signed in on B, **Settings → Nodes** lists A with its label and relay
state. Turn off A's remote access. A shows as not connected.

### 2. Relayed asks

Add assertions to the account API contract and the stand-in. The hosted service issues them to the
same contract. On the Node, allow `POST /v1/pair/requests` from a
relayed caller when it carries a valid assertion whose subject is the Node's owner account. Keep the
ask ceiling and every other rule.

**Checkpoint 2: only the owner asks.** Through the relay, an ask with no assertion is refused. An ask
with an assertion for another account is refused. An ask with an expired assertion is refused. An ask
with a fresh assertion for the owner raises the dialog on A's desktop.

**Checkpoint 3: the audit row.** The accepted ask writes an audit row with the account ID and the
assertion's ID.

### 3. Adopt by pairing

From a listed Node, the client pins the listed fingerprint, raises the ask, waits for the claim, and
stores a normal fleet record with the device token. Decide whether this needs a Node route or stays
in the client ([pairing](../pairing.md#adopt-by-pairing)).

**Checkpoint 4: pair from a café.** With nobody at A, B clicks **Connect** on A. The dialog shows on a
third device already paired with A. **Allow**. B is paired and runs an agent on A. No code and no
identity words appear.

**Checkpoint 5: a wrong fingerprint.** Make the account listing return a wrong fingerprint for A. B's
**Connect** should fail with an identity mismatch and pair nothing.

### 4. Approve from the terminal client

Add the approval dialog to the terminal client, listening for `pairing:requested` as the desktop
does.

**Checkpoint 6: approve in the terminal.** Repeat checkpoint 4 with the terminal client as the only
paired device. It shows the dialog, and **Allow** pairs B.

### 5. The extension's pairing screen

Show the account's Nodes on the extension's first pairing screen, under **This computer**, with
**Sign in** when nobody has.

**Checkpoint 7: extension from another machine.** In the extension on B, pick A from the list,
approve on a paired device, and use A from the sidebar.

## Acceptance

- A Node with remote access off keeps the loopback-only ask.
- Only the owner account can raise a relayed ask.
- A listed Node pairs with no code and no identity words, approved on a paired desktop or terminal
  client.
- A wrong vouched fingerprint fails the connection.

## Docs to update when it ships

- [Authentication](../../../authentication.md#pairing) and
  [pairing by approval](../../../api-reference/transport.md#pairing-by-approval): relayed asks.
- [Node providers](../../../plugins/node-providers.md#node-providers): adopt by pairing.
- [Browser extension setup](../../../browser-extension/setup.md#pair-a-node): the account's Nodes.
- [Security](../../../security.md): the trust cost of a vouched fingerprint.

## Open questions

1. Is adopt by pairing a Node route or a client flow?
2. How long does an account assertion live? Two minutes is the starting point.
3. Does the dialog need the account's display name, or is the device name enough?
4. What does a client show when the only paired device is the Node's own desktop and nobody is there?

## Evidence

Record the time from **Connect** to paired, with dates.

## Verify before building

Check how the pairing dialog ties a request to the Node that broadcast it, since a remote approver can
hold several Nodes. Check how `FleetBridge.adopt` stores a provided Node.
