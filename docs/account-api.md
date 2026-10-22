# The account API

An account service signs a person in, remembers which Nodes belong to them, and issues the short-lived
tokens that let a client reach one of those Nodes through a [relay](./relay.md). This page is the
contract between that service and the code that talks to it: the sign-in plugin, the relay, and a
Node. Read it before you build an account service or change what the open code sends one.

The contract is a public interface. Anyone can run a service that answers it, so it has a version in
its path, its schemas are published, and tests pin the two together. The hosted service acorn runs
answers it, and so does the stand-in this repository ships for tests.

**Nothing here runs unless someone signed in.** A Node with no account service address, or one that
nobody signed in to, makes no request to an account service and runs no account code beyond
registering the plugin's routes.

## The parties

| Party | What it does with the API |
| --- | --- |
| Account service | Answers the routes below. It stores accounts, Node labels, certificate fingerprints, and relay routes. It stores no task content. |
| Sign-in plugin | Runs on each person's local Node. It signs in, registers its Node, and asks for tickets for clients. See [the sign-in plugin](#the-sign-in-plugin). |
| Relay | Reads the service's public keys and revoked credential list. It never calls any other route. |
| Node | Keeps the owner account, the keys, and a relay credential in `node.json`. |

A device token still decides who gets into a Node. A ticket gets a client to the Node, and the account
service can't approve a pairing or read traffic.

## Version and shape

Every route sits under `/account/v1`. A breaking change is `/account/v2` with a new schema file, and a
service answers each version its callers still speak. Version 1 changes only by addition.

Bodies are JSON. The types are in `packages/protocol/src/device/account.ts`, and the published JSON
schemas are in [docs/schemas/account-v1.json](./schemas/account-v1.json), generated from them and
pinned by `packages/node-core/src/server/accountSchema.test.ts`. Regenerate with
`UPDATE_ACCOUNT_SCHEMA=1`.

A request is strict: a field the schema doesn't name is a `400 invalid_request`. A response is open,
and a caller ignores a field it doesn't know.

An error answers `{ "error": "<code>", "message": "<optional text>" }`:

| Code | Status | Meaning |
| --- | --- | --- |
| `authorization_pending` | 400 | The person hasn't approved the sign-in yet. Poll again. |
| `slow_down` | 400 | Poll less often. |
| `expired_token` | 400 | The device code ran out. Start again. |
| `access_denied` | 400 | The person declined. |
| `invalid_grant` | 400 | The device or refresh code is unknown, spent, or revoked. |
| `invalid_request` | 400 | The body or path doesn't match the schema. |
| `invalid_token` | 401 | The access token is missing, unknown, or expired. |
| `not_found` | 404 | No such Node for this account. A Node that belongs to someone else answers the same. |
| `conflict` | 409 | Another account owns that Node ID. |

## Routes

| Route | Caller | Authentication | What it does |
| --- | --- | --- | --- |
| `GET /account/v1/keys` | Relay, Node | None | The public keys, as a JWKS (RFC 7517). Ed25519 only. |
| `GET /account/v1/relay/revoked` | Relay | None | The IDs of relay credentials removed on purpose. |
| `POST /account/v1/device/code` | Plugin | None | Starts a device flow. |
| `POST /account/v1/token` | Plugin | None | Trades an approved device code, or a refresh token, for tokens. |
| `GET /account/v1/account` | Plugin, phone | Access token, or a browser's cookie | The signed-in account. |
| `GET /account/v1/nodes` | Plugin, phone | Access token, or a browser's cookie | The Nodes the account owns, with the fingerprint and channel key each registered. |
| `PUT /account/v1/nodes/{nodeId}` | Plugin | Access token | Registers a Node, or registers it again. |
| `DELETE /account/v1/nodes/{nodeId}` | Plugin | Access token | Removes a Node and revokes its relay credential. |
| `POST /account/v1/tickets` | Plugin, phone | Access token, or a browser's cookie | A relay ticket for one of the account's Nodes. |
| `POST /account/v1/assertions` | Plugin, phone | Access token, or a browser's cookie | An account assertion for one of the account's Nodes. |
| `GET /account/v1/browser/sign-in` | Phone | None | Signs a browser in on the service's page and sends it back. |

An access token goes in `Authorization: Bearer <token>`. The relay checks tickets and credentials with
the public keys, so a request to the service isn't on the path of every stream.

### Sign in

Sign-in is the OAuth device authorization grant (RFC 8628), with JSON bodies. The plugin posts
`{ "deviceName": "…" }` to `/device/code` and shows the person the `userCode` and `verificationUri`
from the answer. The person approves it in a browser, on the service's own page, where GitHub signs
them in. The plugin polls `/token` every `interval` seconds with
`{ "grantType": "urn:ietf:params:oauth:grant-type:device_code", "deviceCode": "…" }`.

An approved poll answers `{ accessToken, refreshToken, expiresIn, account: { id, name } }`. The
account ID has no relationship to any sign-in provider's user ID. Trade a refresh token with
`{ "grantType": "refresh_token", "refreshToken": "…" }`. A refresh token works once, and every refresh
answers with a new pair. A refused refresh means the person must sign in again.

### Register a Node

`PUT /nodes/{nodeId}` takes `{ label, fingerprint, channelKey }` and answers
`{ relay: { url, credential }, keys }`. The Node ID is the Node's own ID, and the fingerprint is the
SHA-256 of its certificate, the value a client pins. The channel key is the public half of the Node's key
for a phone's encrypted channel, 64 hex characters, which a phone pins ([the phone channel](./relay/phone-channel.md)).
A Node sends it every time, and it's optional so a Node from before phones still registers. Registering
again replaces the relay credential and revokes the old one, so turning remote access off and on gives the
Node a new credential.

A Node ID belongs to one account. A second account that registers it gets `409 conflict`.

### List the account's Nodes

`GET /nodes` answers `{ nodes: [{ nodeId, label, fingerprint, channelKey?, relayUrl }] }`, the account's
own Nodes only. The fingerprint is the one the Node registered, which a client pins when it pairs with one.
`channelKey` is absent for a Node that registered without one. The service can't see whether a Node is
connected to its relay, so the list doesn't say.

### Tickets and assertions

`POST /tickets` takes `{ nodeId }` and answers `{ ticket, expiresAt, relayUrl }`. It answers
`404 not_found` for a Node the account doesn't own, and for one that doesn't exist.

`POST /assertions` takes the same body and answers `{ assertion, expiresAt }`. An assertion says that a
person is signed in as an account, for the Node it names. A Node accepts one in a pairing ask from
another computer, when its subject is the Node's owner account
([pairing by approval](./api-reference/transport.md#pairing-by-approval)). No assertion ever acts as a
device token.

## Signed tokens

A credential, a ticket, and an assertion are compact JWS tokens (RFC 7515) signed with Ed25519
(RFC 8037), so a standard JWT library reads them. The header names the algorithm, the key ID, and a
`typ` that says what the token is for, and a verifier refuses a token of any other type.
`packages/protocol/src/device/accountToken.ts` signs and verifies them, and it's the one place the
format is written down.

| Token | `typ` | Claims | Lifetime |
| --- | --- | --- | --- |
| Relay credential | `acorn-relay-credential+jwt` | `iss`, `sub` (account), `jti`, `iat`, `aud: "relay"`, `node` | Until the Node is removed or registers again. |
| Relay ticket | `acorn-relay-ticket+jwt` | The credential's claims, plus `exp` | Five minutes. |
| Account assertion | `acorn-account-assertion+jwt` | `iss`, `sub`, `jti`, `iat`, `aud` (the Node ID), `exp` | Two minutes. |

The credential names the account that owns the Node, and the ticket names the account that may open
streams to it. The relay opens a stream only when the two match.

A service signs with one key at a time and publishes every key still in use. A verifier that meets a
`kid` it doesn't know fetches the keys again, at most every ten seconds.

### Revoking a credential

`GET /relay/revoked` answers `{ "credentials": ["<jti>", …] }`. A relay polls it every ten seconds,
closes the Node that holds a listed credential with close code 4001, and refuses it afterward. Removing
a Node from the account's website puts its credential here, so the Node drops off the relay within a
poll and keeps working locally.

## The sign-in plugin

`plugins/account` is bundled and runs on each person's local Node. It does nothing until someone signs
in: no request leaves the Node, and no timer runs. Its routes load on their first request.

- **The connection.** The access token is an encrypted connection of the `account` provider, with the
  refresh token beside it. The host renews the token before it expires, so the plugin keeps no timer.
  `ACORN_ACCOUNT_URL` names the service. A build without it offers no sign-in, as a build without a
  GitHub client ID offers no GitHub connection. Plain `http` is accepted only for a service on this
  computer.
- **Settings → Account.** **Sign in** runs the device flow, and **Sign out** ends it. The page draws in
  the desktop and the terminal client, which prints the address and the code.
- **Remote access.** The switch on that page registers the Node, records the relay and the owner in
  `node.json`, and starts the relay tunnel without a restart. Turning it off stops the tunnel and
  every stream it carries at once, forgets the relay and owner, and removes the Node from the account.
  A Node that can't reach the service still turns off, and the page says the account wasn't told.
  Signing out turns it off first.
- **Tickets.** `POST /v1/p/account/tickets` on the local Node asks the service for a ticket for another
  Node of the same account. A client's custody calls it before it opens a relayed stream and keeps the
  ticket in memory. It asks again when a minute is left.

The Node's own relay settings in `node.json` or the environment win over remote access. Turning the
switch on while they're set answers `409 relay_set_elsewhere`.

The routes are for paired devices only. A task's agent token gets a `403`, so an agent can't sign the
Node in to its own account or ask for a ticket.

## What the account service can do

It can route a client to a Node and raise a pairing request. It can't approve one, read traffic, or get
a device token. If breached, it could vouch for an impostor Node, so that a person pairs with the wrong
machine. [Control plane security](./security/control-plane.md#the-account-service) says what bounds that.

## Browsers

The phone app is served by the account website, so it calls the account service on its own origin
([browsers](./account-api/browsers.md)). Three routes that take an access token also take the website's
session cookie, with a header only a page of the service's own sends.

## Test an implementation

The stand-in is an account service for tests and for `pnpm dev:agent` flows, and one conformance suite
holds every service to the schemas ([test an account service](./account-api/testing.md)).
