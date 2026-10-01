# Phase 3: the hosted team Node

Status: proposed, 2026-09-29.

## Goal

Creating a team provisions its durable team Node in the team's region. A person signs in from
desktop or TUI and uses that Node with no pairing code. The Node trusts a short-lived grant from the
account service instead of a device token.

This phase connects the control plane to a Node for the first time, and it builds the three
contracts the rest of the programme depends on: enrollment v2, the grant principal, and grant
custody in the client.

## What you can deploy at the end

On staging, creating a team starts a team Node in the chosen region. The web app's Nodes page shows
it with its state and fingerprint. A signed-in desktop or TUI sees the team Node in Settings → Nodes,
adopts it, and works on it like any remote Node. One person per team.

## Starting point

- The Node image from [phase 1](./01-node-image.md) and the account service from [phase 2](./02-account-service.md).
- Enrollment v1 in `packages/node-core/src/server/enrollment.ts`, with its schema in
  `packages/protocol/src/device/enrollment.ts` and a stub control plane in
  `packages/node-core/src/testkit/controlPlaneStub.ts`.
- The Node provider seam in `packages/node-core/src/server/nodeProviders/registry.ts`, and the
  reference provider in `plugins/nodes-file`.
- Principals in `packages/node-core/src/server/middleware/auth.ts` and
  `packages/node-core/src/server/middleware/requireUser.ts`.

## In scope

- Enrollment v2 on the Node and in the account service.
- The `member` principal, grant verification, and the admin role only.
- The revocation channel from the account service to hosted Nodes.
- The provisioner, its operation log, the local Docker adapter, and the real provider adapter.
- The cloud plugin: sign-in, Node provider, grant issuance.
- Grant custody and adoption in desktop and TUI.
- Basic volume snapshots for team Nodes.

## Out of scope

The relay. In this phase, the team Node still listens on a public address as in phase 1, and grants
are required on every request. That is a named stepping stone. Phase 4 removes the public listener.
Members other than the admin, roles other than `admin`, and route classification wait for
[phase 9](./09-teams.md). Grants with any other role are refused.

## Steps and checkpoints

### 1. Enrollment v2

Write the v2 payload in `@acorn/protocol` and publish `docs/schemas/enrollment-v2.json` (new). The
request has no device token. The reply carries the grant issuer URL, its public keys, the Node's
service credential, and, from phase 4, a relay credential. See [identity](../identity.md#what-the-enrollment-v2-change-is).

The Node chooses v2 when the provisioner sets a version variable. v1 stays exactly as it is and
keeps its tests. Extend the stub control plane to speak v2.

**Checkpoint 1: v2 against the stub.** Boot a standalone Node with v2 variables against the stub. The
stub records the enrollment with no device token. `node.json` holds the attachment and the issuer.
`GET /v1/core/devices` is empty.

### 2. The grant principal

Add grant verification beside the device and internal paths. Verify signature, issuer, audience,
expiry, and membership version. Produce a `member` principal. Only a Node enrolled through v2 accepts
grants.

Decide, route by route, what an `admin` grant reaches on a hosted Node among the routes gated by
`requireDevice` today: pairing, devices, plugins, audit, security, schedules, and backup. Pairing
should be refused on hosted Nodes. Record the decision in the mount coverage test.

**Checkpoint 2: grants work and fail correctly.** With a grant minted by the local account service,
call `GET /v1/core/projects`: 200. With the same grant for a different Node ID: 401. With an expired
grant: 401. With a `viewer` grant: 403. Against a local Node that never enrolled: 401.

### 3. The revocation channel

The hosted Node opens an outbound connection to the account service with its service credential and
receives membership changes. On a change, it closes the affected account's sockets.

**Checkpoint 3: removal closes the socket.** With the desktop connected to a team Node, delete the
team or revoke the account's session in the web app. The desktop's connection closes within seconds
and shows a sign-in reason.

### 4. The provisioner

Build the provisioner in the account service: the provider interface from
[hosting and cost](../hosting-and-cost.md#the-provider-interface), an operation log with idempotency
keys, and a reconciliation loop. Implement the local Docker adapter first, then the real provider
adapter. Team creation provisions a team Node with a volume in the team's region. Team deletion
destroys it after a confirmation that names what is lost.

**Checkpoint 4: local provisioning.** In the local stack, create a team. A Node container starts,
enrolls through v2, and the Nodes page shows it as running with its fingerprint.

**Checkpoint 5: a retry does not double-create.** Make the provider adapter time out after it has
created the machine. Retry. Exactly one machine should exist, and the log should show the retry
finding it.

**Checkpoint 6: the reconciler catches strays.** Create a machine by hand with the provisioner's
labels. The reconciler should raise an alarm for a machine it cannot account for.

### 5. The cloud plugin

Create `plugins/cloud` (new) as a loaded plugin. It runs the device flow against the account
service, stores the result as an encrypted connection, contributes a Node provider whose `list`
returns the account's team Nodes with fingerprint and address, and exposes a capability custody uses
to fetch a grant. Its client half is a Settings page with **Sign in** and **Sign out**.

Decide whether the plugin ships in the bundled roster or is installed by hand. See the open
questions.

### 6. Grant custody and adoption

Extend `@acorn/custody` with a grant-backed fleet record, refresh before expiry, and adoption through
the provided-Node path. The record holds no device token. See [clients](../clients.md#adopting-the-team-node).

**Checkpoint 7: desktop end to end.** In the desktop, sign in from Settings → Cloud. The browser
opens with the code. After approval, Settings → Nodes lists the team Node. Adopt it. Clone a
repository on it, create a task, and run an agent. No pairing code appears at any point.

**Checkpoint 8: TUI end to end.** Do the same in the TUI through the PTY driver. The TUI prints the
URL and code.

**Checkpoint 9: refresh.** Leave a desktop connected for 20 minutes with the grant lifetime at five
minutes. The connection should stay up, and the Node's audit trail should show several grant IDs.

### 7. Staging

Deploy the provisioner with the real provider adapter. Turn on nightly volume snapshots for team
Nodes.

**Checkpoint 10: a real team Node.** On staging, create a team in each region you plan to support.
Each team Node should start in its region. Sign in from the desktop and use each one.

## Acceptance

- Enrollment v1 tests still pass unchanged.
- A local Node never accepts a grant. A hosted Node never accepts a device token from pairing.
- Removing access closes live connections within seconds.
- Provisioning is idempotent under timeout and retry.
- Desktop and TUI sign in and use a team Node without a pairing code.

## Docs to update when it ships

- [Node enrollment](../../../node-enrollment.md): v2 beside v1.
- [authentication](../../../authentication.md): the `member` principal and grants.
- [security](../../../security.md): the grant issuer's trust cost.
- [Node providers](../../../plugins/node-side-extension-points.md#node-providers): grant-backed
  adoption.

## Open questions

1. JSON Web Token or PASETO for grants? A JWT library is likely already in the dependency tree
   through the JWE credential encryption.
2. How often do the issuer's signing keys rotate, and how does a Node learn a new key? Through the
   revocation channel, or by fetching a key set?
3. Which `requireDevice` routes may an `admin` grant reach on a hosted Node? Plugin install and backup
   are the hard ones.
4. Does acorn's own support staff ever get access to a team Node? If so, through what audited path,
   and does the team see it?
5. Is the cloud plugin bundled with the desktop, or installed? Bundled makes sign-in one click.
   Installed keeps the desktop free of cloud code for people who never want it.
6. Does the device flow need a local Node? A TUI or CLI on a machine with no Node of its own starts
   one, so this holds today, but a future browser client breaks it.
7. What machine size and volume size does a team Node start with, and how does it grow?
8. One provider app per team, or one shared app with many machines? This affects network isolation
   and quotas.
9. How are team Nodes upgraded to a new image without breaking connected clients? Protocol versioning
   allows it, but the rollout needs a plan before a second image version ships.
10. What happens to a team Node's data when a team is deleted, and for how long can it be recovered?

## Evidence

Record provisioning times per region and any provider findings here, with dates.

## Verify before building

Reread [Node enrollment](../../../node-enrollment.md) and [authentication](../../../authentication.md).
Check how `FleetBridge.adopt` fetches a credential from the listing Node, because grants change what
it fetches.
