# Phase 2: accounts and the hosted relay

Date: October 22, 2026. Status: built October 22, 2026, on branch `phase-2-accounts`, except for
staging. Takes the account half of cloud's former account service phase and the owner remote access step
of its former relay phase.

## Completion note

October 22, 2026.

### What landed

Open source, in this repository:

- **The account API**, [docs/account-api.md](../../account-api.md). Zod types and the signed-token format
  are in `@acorn/protocol` (`device/account.ts`, `accountToken.ts`), the schemas are in
  `docs/schemas/account-v1.json`, and `accountSchema.test.ts` pins the two together. The prefix is
  `/account/v1`.
- **The stand-in**, `packages/node-core/src/testkit/accountStub.ts`, and **one conformance suite**,
  `accountContract.test.ts`, that takes a base URL. It runs against the stand-in by default and against
  any service with `ACORN_ACCOUNT_CONTRACT_URL`. `pnpm dev:account` starts the stand-in with a relay.
- **The relay in account mode.** `apps/relay/src/auth.ts` holds the static and the account
  implementation of who may connect. `ACORN_RELAY_ACCOUNT_URL` turns it on. A Node's credential names
  its route and owner, a ticket names a route and an account, and revoked credentials are polled.
  [Relays and accounts](../../relay/accounts.md) is the owning page.
- **The Node's tunnel is controlled at run time.** The listener sets `RELAY` on the runtime bindings,
  with `apply` and `state`. The tunnel owns the relay `Host` name, and it ends every stream it opened when
  it closes. `node.json` gains `owner`, and `readNodeRelay` and `recordNodeRelay` write it.
- **`plugins/account`**, a compiled plugin: the `account` connection (device flow, host-renewed
  refresh), the routes under `/v1/p/account` (`state`, `auth/device/start` and `poll`, `remote-access`,
  `sign-out`, `tickets`), and **Settings → Account** with **Sign in**, **Sign out**, and the **Remote
  access** switch.
- **Custody tickets.** `RelayTickets` keeps a ticket per Node in memory and replaces it when a minute is
  left. `NodeBroker` asks its local Node for one through `relayTicketRoute`. `probeNode` takes a
  `relayTicket` too, so pairing over the relay works. `wss://relay/<node ID>`, with no credential, is the
  address of a Node reached with tickets.
- **Docs.** `account-api.md` and `relay/accounts.md` are new, and `relay.md`, `authentication.md`,
  `node-distribution/reaching.md`, `security.md`, `security/control-plane.md`, `first-party-plugins.md`,
  and `apps/relay/PROTOCOL.md` are updated.

The hosted service is in its own closed repository, with its README for running it and for testing it
against a worktree's `@acorn/protocol`. Its first two commits are on its `main`. It's Hono, Better
Auth (GitHub only, `disableImplicitLinking: true`), Drizzle, and Postgres: the account API, the
allowlist, the website (sign in, account with Nodes and **Remove**, browser sessions, audit log, device
approval), and tests. It passes the same conformance suite.

### Decisions and deviations

- **Credentials never expire, and a list revokes them.** A relay credential lasts until the Node is
  removed or registers again, as [accounts](./accounts.md) says. So a relay can check it with no call,
  the service publishes revoked credential IDs at `GET /relay/revoked`, and a relay polls it every ten
  seconds. That's how **Remove** on the website drops a Node "within seconds".
- **A relay that can't read the revoked list at its start doesn't start.** Later outages leave the last
  list in force. A review flagged the first as failing open, and the second is a choice: a Node that
  reconnects during an outage still gets in.
- **A ticket goes only to the relay the account lists for the Node, and never over `ws://` to another
  computer.** The same review found that a mistyped or hostile address could collect a five-minute ticket.
- **An owner mismatch is a `401`.** A ticket for a Node another account owns answers `401`, as a forged
  one does.
- **Streams close with their Node's registration.** Checkpoint 10 found that turning remote access off
  left open streams alive, because the tunnel closed only its control connection. The tunnel now ends
  its own streams, and the relay closes every stream joined through a registration when it ends, in
  self-hosted mode too. A revoked or replaced Node loses its clients the same way.
- **The switch is on the Account page, not on the Nodes row.** The Nodes page is a desktop page, and the
  terminal client has no way to show a switch there. The Account page draws in both clients, on the Node
  whose settings are open. [Accounts](./accounts.md) still describes the Nodes row.
- **Open question 6 answered.** The relay and owner account are in `node.json`, beside the reach
  settings, because the listener reads them at boot with no account code, and a later pairing check
  reads the owner there. The tokens are an encrypted connection, so the host renews them. The owner
  record holds the account ID and the service's keys, and no token.
- **A compiled plugin, not a loaded one.** Remote access needs the listener's relay control, the identity
  file, and the core connection store, none of which a loaded plugin can reach. `first-party-plugins.md`
  gains reason H. The plugin's static code is small and its routes load on first use.
- **The provider also shows in Settings → Connections.** `connectProvider` needs a connectable provider,
  so Add connection offers the same device flow. Removing the connection there signs out without turning
  remote access off. The Account page then shows the Node as on and signed out, and signing in again
  offers **Turn off**.
- **Relay state isn't in `GET /v1/node`.** The Account page is the consumer, and it reads
  `GET /v1/p/account/state`. `GET /v1/node` answers before anyone signs in, so it stays out of this.
- **Tickets for `acorn --node` and the browser extension aren't wired.** Those processes hold no
  connection to a local Node when they're pointed at another Node. The desktop and the terminal client
  have one. A library can't name the plugin's route, so each app passes `ACCOUNT_TICKET_ROUTE`
  (`plugins/account/src/contract/routes.ts`), which needed two edges in the architecture test's list.
- **Sign-in against the stand-in doesn't open a browser.** The stand-in's address is loopback `http`,
  and `safeVerificationUrl` opens only `https`, so the page shows the address and the code and the alert
  says acorn won't open it. The terminal client prints the same.
- **Architecture lists grew.** `@acorn/protocol` allows 98 entrypoints (from 96) and `@acorn/node-core`
  70 (from 69), and the three protocol files named `account` are in the plugin-named baseline, because
  the account API isn't the `account` plugin's wire. Three core files that use the word `account` as a
  field name are in the list of exceptions. The plugin API facade gained `disconnectConnection`,
  `listProviderConnections`, `readNodeRelay`, `recordNodeRelay`, and the stand-in in its testkit.
- **Hosted service.** Better Auth's device authorization plugin answers with a session token and
  issues no refresh token, so the service implements RFC 8628 over its own tables. With
  `disableImplicitLinking`, Better Auth refuses a second GitHub account that shares an email, which
  isn't a second account. So an account's email is made from the GitHub account's ID, and the service
  stores no real address. The allowlist is a table edited with a script. Question 3 is answered. Better
  Auth is 1.7.12 (question 5).
- **Hosted service, not decided here.** The domain, the region, and the terms stay open (questions 1, 2,
  and 4). The service keeps no email, which lowers what question 2 asks of a region.

### Checkpoints

| Checkpoint | Result |
| --- | --- |
| 1. The stand-in follows the contract | Passed. The suite's 15 tests pass, and requests the schema refuses answer `400`. |
| 2. Sign in, 3. No implicit merge, 4. Sessions | Passed against a fake GitHub that the service's tests run (`test/website.test.ts` in the hosted repository), not a real OAuth app. A real run needs a GitHub OAuth app with callback `http://localhost:<port>/api/auth/callback/github`, its client ID and secret, and `pnpm allow add <login>`. |
| 5. The contract holds | Passed. The hosted service passes `accountContract.test.ts` through `pnpm test:contract`. |
| 6. Desktop sign-in | Passed in `pnpm dev:agent` against the stand-in, with the code shown and approved by a command. See the note on the browser above. |
| 7. Terminal client sign-in | Passed through the PTY driver. It prints the address and the code. |
| 8. Inert until used | Passed three ways: `plugins/account/src/node/index.test.ts` shows init makes no request and starts no timer. `apps/relay/src/remoteAccess.test.ts` boots two real Nodes with an account service configured and sees no request and no relay connection. |
| 9. Nobody else gets through | Passed. The stand-in won't issue a ticket for a Node the account doesn't own, and the relay refuses a forged ticket (`accountAuth.test.ts`). |
| 10. Turn it off | Passed (`remoteAccess.test.ts`, and in the desktop). The other Node loses it at once, and the Node forgets the account. |
| 11, 12, 13. Staging | Skipped. No domain or product name is chosen. |
| Step 5. Hosted service: staging | Skipped, for the same reason. |

### Size budgets

- **Node service static graph:** 1,938,584 bytes before, 1,939,999 after, so +1,415 bytes and 999 over
  the 1,939,000 ceiling. The plugin's static part (its entry and the connection descriptor) is 1,151 bytes
  of that, and the `owner` field in the identity schema is 256. Moving the node.json read and write into
  `storage/nodeRelay.ts`, loaded only by the plugin's lazy routes, saved about 1,000 bytes, and moving the
  provider's steps into `providerSteps.ts` saved about another 1,000. **The ceiling is unchanged, so `pnpm build`
  fails its size check until it's raised.** Staging for `dev:agent` needs the steps in the project memory
  for a red budget.
- **Terminal client startup graph:** 789,180 bytes before, 791,254 after (+2,074), over its 770,000
  ceiling, which was already over on the base commit. The parts of the account API that the broker
  needs only to read a ticket are loaded on first use.

### For later phases

- **Phase 3.** `POST /account/v1/assertions` and the keys in `node.json`'s `owner` exist, and nothing
  checks an assertion yet. Listing the account's Nodes needs a `GET /account/v1/nodes` route in the
  contract, in the open repository first. `RelayTickets` and `relayTicketRoute` are how a client reaches
  a Node it found in that list. `acorn --node` and the extension need a way to reach a local Node's
  tickets before they can take an address with no credential.
- **Phase 4.** The browser stream carries a credential another way. A ticket is the same signed token.
- **Phase 5.** Nothing limits sign-ins, registrations, or tickets. The account service issues a
  ticket for any Node an account owns, with no cap.
- **Found red on the base commit, not fixed here:** `@acorn/arch-tests` fails on links to
  `docs/future/perf`, `dynamic-ui`, and `marketing` pages. `pnpm pack:node` is red as before, and a
  packed Node built from a temporary copy of the script runs the plugin and turns remote access on and off.

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
   organization membership? Answered: a table edited by hand.
4. Hosted service: what terms of service and privacy policy must exist before anyone outside the team
   signs in?
5. Hosted service: which Better Auth release, and does its device authorization plugin issue refresh
   tokens? Answered: 1.7.12, and no. See the evidence.
6. Where does the Node keep its owner account and relay credential: in the plugin's own storage, or in
   `node.json` beside the reach settings? Answered: `node.json`. See the completion note.

## Evidence

Record contract decisions and stand-in findings here, with dates. Hosted deployment details belong
with the hosted service.

- **October 22, 2026.** Better Auth 1.7.12. Its device authorization plugin returns a session token as
  `access_token` and documents no refresh token. A refresh token appears only with its OAuth Provider
  plugin, when the client asks for `offline_access`. Its `disableImplicitLinking` rejects a same-email
  sign-in of an unlinked GitHub account with `account_not_linked`.
- **October 22, 2026.** A packed Node, built from `pack-node.mjs` with its builds skipped and `ci-info`
  allowed, signed in to the stand-in, turned remote access on, connected to a relay, and turned it off.
- **October 22, 2026.** The conformance suite found no difference between the stand-in and the hosted
  service on its first run. Checkpoint 10 found the open streams left after the tunnel closed.

## Verify before building

Check how `controlPlaneStub.ts` is built and tested, so the stand-in account service follows it.
For the hosted service, recheck Better Auth's documentation for linking, device authorization, and
session revocation.
