# Phase 3: pair from anywhere

Date: October 22, 2026. Status: built October 22, 2026, on branch `phase-3-pairing`, except for staging.

## Completion note

October 22, 2026.

### What landed

Open source, in this repository:

- **The account API gained `GET /account/v1/nodes`**, the account's own Nodes with the fingerprint each
  registered and the relay each dials. It's in `@acorn/protocol` (`accountNodeSchema`,
  `listNodesResponseSchema`), `docs/schemas/account-v1.json`, the conformance suite, and the stand-in
  (`docs/account-api.md`). Assertion issuing already existed from phase 2.
- **Relayed asks.** `POST /v1/pair/requests` takes an optional `assertion`. A caller that isn't on loopback
  is let through only when the assertion's signature, audience (this Node), subject (the owner account),
  type, and expiry check out against the keys in `node.json`'s `owner` (`auth/pairingAssertion.ts`, loaded
  on the first such ask). A remote ask counts against the ceiling of six only after its assertion checks out.
  The request is marked `remote`, the dialog says so, and the audit trail gets `pairing.request.raised`
  with the account ID and the assertion's ID.
- **The account Node provider.** `plugins/account` registers a Node provider (only where the build has an
  account service) whose `list` returns the account's Nodes. `endpoint` is the relay address with no
  credential, and `fingerprint` is the account's word. It also declares `pairingAssertion`, which mints an
  assertion for one Node. A signed-out Node lists nothing and calls nothing.
- **Adopt by pairing.** `POST /v1/core/nodes/adopt` answers with an `assertion` in place of a `deviceToken`
  when the provider holds none. The client does the rest (`custody/broker/vouchedNode.ts`): probe through
  the relay with a ticket, refuse a certificate other than the vouched one, ask with the assertion, wait
  for a paired device, and store a normal fleet record with `provider` provenance. The desktop's
  `adopt` answers `{ node }` or `{ phrase }`, and `collectAdoption` finishes it. **Settings → Nodes**
  shows the three words, **Connect**, and **Cancel**.
- **The approval dialog.** One model (`host/trust/pairingRequestModel.ts`) serves the desktop's dialog and
  the terminal client, which asks through the shell's confirmation (`chrome/PairingRequests.tsx`).
- **The extension.** The bridge gained `nodes.provided` and `node.adopt` (and reuses `node.collect`). The
  sidebar lists the account's Nodes under **This computer**, with an **Approve on another device** step.
  The bridge asks the Node it selected, or the Node that listed the one it selected, for tickets, and keeps
  that Node connected (`relayTicketNode` on `NodeBroker`). Typed relay addresses with no credential work in
  the extension too.
- **Docs.** The account API, the transport reference's pairing by approval, authentication, Node providers,
  the browser extension's setup and native messaging pages, the bridge and broker, control plane security,
  security, relays and accounts, first-party plugins, the terminal client's process page, and the site's
  pairing page.

Hosted service, in its own repository: `GET /account/v1/nodes`, one commit on its `main` ("Phase 3: List an
account's Nodes", `decdfbc`). It passes the same conformance suite, 18 tests, with its own 8.

### Decisions and deviations

- **Question 1: a client flow.** Adopt by pairing is the client asking, with no new Node route. The one
  change on the Node is that `adopt` may hand back an assertion where it handed back a token. The provider
  seam grew `pairingAssertion` and `list(signal, caller)`, where `caller` is only the user ID, because
  passing a request context would give a loaded plugin's provider the Node's secrets. The provider reaches
  its connection with `ctx.providers.withConnection`.
- **Question 2: two minutes stays.** Nothing needed longer. A Node checks an assertion on arrival, and the
  client asks for a fresh one for each Connect.
- **Question 3: no account name.** An ask from another computer is always the owner's own account, so a
  name says nothing the person doesn't know. The dialog says "signed in to your account on another
  computer" and the device name stays the machine's name.
- **Question 4: nothing new.** When nobody can approve, the wait ends at two minutes with "The request was
  denied or has expired", and **Cancel** ends it sooner. A headless Node still pairs its first device with
  `acorn node pair` and a code.
- **The list has no relay state.** The account service can't see whether a Node is connected, and a relay
  never calls it, so a listing says nothing about it. Turning remote access off removes the Node from the
  list, so it disappears from **Settings → Nodes** rather than reading "not connected". A Node that is off
  or asleep lists as ready, and **Connect** fails with "The Node isn't connected to its relay."
- **The extension lists through a paired Node.** Its first screen has no Node to ask, so it lists nothing
  until one is paired, and it has no **Sign in** of its own: the empty state says to sign in under Acorn's
  **Settings → Account**. Signing in a second way would put a device flow in the extension for no gain.
- **The terminal client has no **Allow** delay.** Its confirmation starts on **Cancel**, which denies, and
  that is the safe default in place of the desktop's one-second wait.
- **`hasNodeProviders` now means "has something to draw"**, a Node, a failure, or a provider that can make
  Nodes. Otherwise every build with an account service would show an empty **Nodes from a provider**
  section to a signed-out person. The button reads **Connect**, as this page asked.
- **No replay check on an assertion.** Its ID is in the audit row, and the ceiling of six a minute and the
  two-minute life bound a replay. Keeping seen IDs would be one more table of state for a caller who
  would have to be inside the encrypted connection to replay anything.
- **`acorn --node` still takes no ticket.** No flow in this phase needs it.
- **Architecture lists.** `@acorn/client-core` allows 212 entrypoints (from 211), for the shared request
  model. `apps/cli/src/browser/bridge.ts` joined the list of app-to-plugin contract imports, for the ticket
  route. `@acorn/custody` publishes `broker/vouchedNode.ts`.
- **The relay tests share a harness.** `apps/relay/src/testkit/nodes.ts` starts real Nodes for
  `remoteAccess.test.ts` and the new `pairFromAnywhere.test.ts`.

### Checkpoints

All were run on October 22, 2026, on this machine, against the stand-in (`pnpm dev:account`, ports 48781
and 48782) and its relay. Each "laptop" is a separate Node and client with its own data folder.

| Checkpoint | Result |
| --- | --- |
| 1. The list | Passed in `pnpm dev:agent`. Laptop B (session `p3b`) lists A (session `p3a`) in **Settings → Nodes** with **Connect**. Turning off A's remote access removes it from the list (see above). |
| 2. Only the owner asks | Passed. Through the relay, an ask with no assertion, and one with a ticket in its place, are refused (`pairFromAnywhere.test.ts`, real Nodes). Another account can't get an assertion for the Node (`404`). Another account's subject, another Node's audience, an expired assertion, another key, and a Node with no owner are refused (`pairingAsk.test.ts`). A fresh assertion raises the dialog (live and in the test). |
| 3. The audit row | Passed. The audit log in A's window shows "Pairing request from your account" with the account ID, the assertion ID, and the device name, then the answer and "Device paired". |
| 4. Pair from a café | Passed in `pnpm dev:agent`. Clicking **Connect** on B showed three words. A's desktop, a device paired with A, showed the same words in "Allow a new client?" and **Allow** paired B. No code and no identity words. B then showed A as **Live**, and `GET /v1/core/tasks` answered `200` through the relay in the test. An agent run wasn't tried: the isolated sessions have no harness. |
| 5. A wrong fingerprint | Passed live, with a proxy in front of the stand-in that rewrites the listed fingerprint: B's **Connect** failed with "presented a different identity than your account vouched for. Nothing was paired.", and A saw no request. Also in the helper, bridge, custody, and relay tests. |
| 6. Approve in the terminal | Passed with the PTY driver. A was a terminal client session (its Node, signed in, remote access on) and the only device paired with it. It showed "Allow a new client?" over Settings, and **Allow** paired desktop B. |
| 7. Extension from another machine | Passed with `pnpm dev:extension` (Chrome). The extension paired its own computer's Node with a code, listed A under **This computer**, showed **Approve on another device**, and the terminal client on A allowed it. A then showed **In use** with its relay address. |
| Inert Node | Passed. `remoteAccess.test.ts`: two real Nodes with an account service configured, nobody signed in, make no request to it (apart from the relay's own key reads), and listing Nodes from a client doesn't change that. |
| Loopback-only ask | Passed. A real Node on a self-hosted relay with no owner account refuses an ask from a relayed peer, with or without an assertion (`pairFromAnywhere.test.ts`). |
| Staging | Skipped. Nothing here needs a domain, a product name, or a deployed service. |

### Evidence

Time from **Connect** to paired, in the desktop against the stand-in and a local relay, with no human delay
(a script clicked **Connect** on B and **Allow** on A):

- **Connect to the three words on B:** 92 ms.
- **Connect to the dialog enabled on A:** 2,105 ms. One second of that is the desktop's wait before **Allow**
  works, and the rest is the Node's ping and the dialog's read.
- **Allow to B stored and connected:** 798 ms.
- **Connect to paired:** 2,904 ms. A person adds the time they take to read the words.
- The same work with no window, in `pairFromAnywhere.test.ts`, from the adopt call to a collected token:
  28 ms.

### Size budgets

- **Node service static graph:** 1,933,742 bytes on the base commit, 1,934,814 here, so +1,072 bytes, under
  the 1,939,000 ceiling by 4,186. Measured after a fresh `pnpm install` and a clean `pnpm build`. The
  assertion check is a lazy chunk.
- **Terminal client startup graph:** 793,189 bytes on the base commit, 793,898 here, so +709 bytes. It's over
  its 770,000 ceiling on the base commit already. The request dialog loads after the first frame.

### For later phases

- **Phase 4.** A phone device that approves asks reads `GET /v1/core/pair/requests` and answers like the
  desktop, and the model in `pairingRequestModel.ts` is where its rules live. `POST /v1/core/nodes/adopt` hands
  an assertion to any paired device, so decide whether a phone may call it. The gateway's denylist still
  refuses every pairing route. An assertion is for one Node and two minutes, and the phone asks the account
  service for it through whichever Node holds the sign-in.
- **A client that adopts a listed Node** keeps `provider.sourceNodeId` on its record. The extension's bridge
  uses it to find which Node to ask for tickets, and keeps that Node connected beside the selected one.
- **The account service can't say whether a Node is connected.** If the list should show it, the relay
  has to tell the service, which the contract says it never does. That needs its own design.
- **Found red on the base commit, not fixed here:** `@acorn/arch-tests` fails on links to
  `docs/future/perf`, `dynamic-ui`, and `marketing` pages, `pnpm pack:node` fails on the terminal client's
  startup budget and the undeclared `ci-info` import, and the terminal client's own build fails its 770,000-byte
  check. The agent launchers for the terminal client need `--no-build` for that reason.

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
- The design in [pairing](./pairing.md) and [accounts](./accounts.md#account-assertions).

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
in the client ([pairing](./pairing.md#adopt-by-pairing)).

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

- [Authentication](../../authentication.md#pairing) and
  [pairing by approval](../../api-reference/transport.md#pairing-by-approval): relayed asks.
- [Node providers](../../plugins/node-providers.md#node-providers): adopt by pairing.
- [Browser extension setup](../../browser-extension/setup.md#pair-a-node): the account's Nodes.
- [Security](../../security.md): the trust cost of a vouched fingerprint.

## Open questions

All four are answered in the completion note's decisions.

1. Is adopt by pairing a Node route or a client flow? A client flow.
2. How long does an account assertion live? Two minutes.
3. Does the dialog need the account's display name? No.
4. What does a client show when the only paired device is the Node's own desktop and nobody is there? The
   words, then "The request was denied or has expired" at two minutes.

## Evidence

Recorded in the completion note, with dates.

## Verify before building

Check how the pairing dialog ties a request to the Node that broadcast it, since a remote approver can
hold several Nodes. Check how `FleetBridge.adopt` stores a provided Node.
