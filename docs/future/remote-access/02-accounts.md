# Phase 2: accounts and the hosted relay

Date: October 22, 2026. Status: proposed. Takes the account half of cloud's former account service
phase and the owner remote access step of its former relay phase.

## Goal

Write the account API and a stand-in for it in this repository, then stand up the hosted account
service, website, and relay. A person signs in from the desktop or terminal client, turns on
**Remote access** for their Node, and reaches it from another network with no configuration.

## What you can deploy at the end

A staging account website where an allowlisted person signs in with GitHub and sees their Nodes. A
hosted staging relay. In the desktop and terminal client, **Settings → Account** signs in, and the
**Remote access** switch on the local Node's row connects it to the relay. On a second machine signed
in to the same account, the Node is reachable. Pairing still uses a code in this phase.

## Starting point

- The relay and socket factory from [phase 1](./01-relay.md).
- The GitHub device flow in `plugins/github`, the pattern the sign-in plugin follows
  ([authentication](../../authentication.md#github-connection)).
- The design in [accounts](./accounts.md) and [services](./services.md).

## In scope

Open source, in this repository:

- The account API contract: Zod types in `@acorn/protocol` and JSON schemas in `docs/schemas/`.
- A stand-in account service for tests, beside
  `packages/node-core/src/testkit/controlPlaneStub.ts`.
- The sign-in plugin, `plugins/account` (new), bundled and inert until sign-in.
- **Settings → Account**, and the **Remote access** switch.
- Custody fetching and refreshing relay tickets.
- The relay checking tickets and Node credentials against the account service's public keys.

Hosted service, closed source:

- The account service: GitHub sign-in, linking rules, sessions, and session revocation.
- Node registration, relay credentials, relay tickets, and account assertions, as the contract says.
- The account website: sign in, account, Nodes with **Remove**, and an audit log.
- Staging with a domain, TLS, a database, CI, error reporting, and one hosted relay.
- An allowlist for sign-in.

## Out of scope

Listing Nodes in the client and pairing from anywhere, which are phase 3. The phone, which is phase 4.
Teams and roles, which are [cloud](../cloud/README.md).

## Steps and checkpoints

### 1. The account API and its stand-in

Write the account API before any code: sign-in by device flow, Node registration and removal, relay
credentials, tickets, assertions, and the public keys a Node and the relay verify against. Version it
under its own prefix, separate from the Node API. Publish the types and schemas, and pin them with
tests, as [Node enrollment](../../node-enrollment.md) pins enrollment v1.

Build the stand-in account service from the contract. It approves a device flow at once for a test
account, registers Nodes in memory, and signs tickets and assertions with a test key.

**Checkpoint 1: the stand-in follows the contract.** The schema tests pass against the stand-in's
answers, and a request the schema refuses is refused by the stand-in too.

### 2. Hosted service: the account service

Build the account service and website to the contract. The design it follows is in
[accounts](./accounts.md#accounts): Better Auth with GitHub as the only provider and
`disableImplicitLinking: true`.

**Checkpoint 2: sign in.** Sign in with GitHub on the website. Sign out and back in: the same account
ID.

**Checkpoint 3: no implicit merge.** Sign in with a second GitHub account that has the same verified
email as the first. You should get a second, separate acorn account.

**Checkpoint 4: sessions.** Sign in from two browsers. The account page lists both sessions. Revoke
one. That browser is signed out on its next request.

**Checkpoint 5: the contract holds.** The hosted service passes the same schema tests as the
stand-in.

### 3. The sign-in plugin

Create `plugins/account` as a bundled first-party plugin. It runs the device flow, stores the result
as an encrypted connection, and contributes **Settings → Account** with **Sign in** and **Sign out**.
Develop it against the stand-in.

**Checkpoint 6: desktop sign-in.** In `pnpm dev:agent` with the stand-in, click **Sign in**. The
browser opens with the code. After approval, the page shows the account.

**Checkpoint 7: terminal client sign-in.** Do the same through the PTY driver. The terminal client
prints the URL and code.

**Checkpoint 8: inert until used.** On a fresh Node, with nobody signed in, the plugin makes no
outbound connection and runs no timer.

### 4. Registration and the relay

Add the **Remote access** switch to the plugin, and ticket checks to the relay. Turning the switch on
registers the Node, stores its relay credential, and connects it. Custody asks the plugin for a ticket
before each relayed connection, and a minute before expiry. Test against the stand-in and a local
relay first.

**Checkpoint 9: nobody else gets through.** Against the stand-in, sign in a second test account and
try to open a stream to the first account's Node. The relay should refuse the ticket.

**Checkpoint 10: turn it off.** With a client connected through the relay, turn **Remote access** off.
The client loses the Node at once, and the Node makes no further outbound connection.

### 5. Hosted service: staging

Deploy the account service, website, and one relay to staging behind public TLS, with a staging GitHub
OAuth app, CI that deploys on merge, and error reporting that records account IDs and request IDs and
nothing from request bodies.

**Checkpoint 11: reach home from elsewhere.** On laptop A, sign in to staging and turn on **Remote
access**. On laptop B, on a different network and signed in to the same account, add A's Node by its
relay route and pair with a code from A. Run an agent on it.

**Checkpoint 12: remove from the website.** Click **Remove** next to A's Node on the staging website.
A drops off the relay within seconds and keeps working locally.

**Checkpoint 13: staging from outside.** From a machine that has never touched the project, sign in
with an allowlisted GitHub account. One not on the allowlist is refused with a plain message.

## Acceptance

- The account API has published types and schemas, and the stand-in and the hosted service both
  pass the tests that pin them.
- Every open-side test runs against the stand-in, with no hosted service.
- Remote access works across networks on staging and is refused to other accounts.
- A Node with nobody signed in makes no outbound connection.
- No log line, error report, or table in the hosted service holds anything beyond account metadata.

## Docs to update when it ships

- A new owning document for the account API, `docs/account-api.md` (new), with its schemas in
  `docs/schemas/`.
- [Authentication](../../authentication.md): accounts, the sign-in plugin, and the owner account.
- `docs/relay.md`: tickets and relay credentials.
- [Node distribution](../../node-distribution.md): remote access for a local Node.
- [Security](../../security.md) and [control plane security](../../security/control-plane.md):
  what the account service can and can't do.

## Open questions

1. What is the product name and domain?
2. Hosted service: where does the account service run? It holds emails and names. Do EU accounts
   need their metadata stored in the EU?
3. Hosted service: how does the allowlist work: a table edited by hand, a waitlist form, or GitHub
   organization membership?
4. Hosted service: what terms of service and privacy policy must exist before anyone outside the team
   signs in?
5. Hosted service: which Better Auth release, and does its device authorization plugin issue refresh
   tokens?
6. Where does the Node keep its owner account and relay credential: in the plugin's own storage, or in
   `node.json` beside the reach settings?

## Evidence

Record contract decisions and stand-in findings here, with dates. Hosted deployment details belong
with the hosted service.

## Verify before building

Check how `controlPlaneStub.ts` is built and tested, so the stand-in account service follows it.
For the hosted service, recheck Better Auth's documentation for linking, device authorization, and
session revocation.
