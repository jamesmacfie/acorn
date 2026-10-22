# Services, repositories, and environments

Date: October 22, 2026. Status: proposed. Taken from [cloud services](../cloud/services.md), which
keeps the deployables only cloud needs. This file lists what remote access deploys, where its code
lives, and which credential each caller uses.

## The deployables

| Deployable | What it is | Stack | Runs where | First phase |
| --- | --- | --- | --- | --- |
| Relay (open) | Joins client and Node connections and forwards bytes. Stateless apart from its routing table. | TypeScript on Node, or Go if measured throughput needs it | One or more instances per region | [1](./phases/01-relay.md) |
| Account service (hosted, closed) | HTTP API for sign-in, the account's Nodes, relay credentials and tickets, and account assertions. | TypeScript, Hono, Better Auth, Drizzle, Postgres | One region | [2](./phases/02-accounts.md) |
| Account website (hosted, closed) | Sign-in, the account page, the list of Nodes with **Remove**, and the phone app's files. The phone app itself is open. | Served by the account service, or a static host | Same as the account service | [2](./phases/02-accounts.md) |
| Sign-in plugin (open) | A bundled first-party plugin that signs a person in, lists the account's Nodes, and fetches tickets and assertions. | acorn plugin API | Each person's local Node | [2](./phases/02-accounts.md) |

Cloud adds the provisioner, team Nodes, workers, object storage, and billing to the same account
service ([cloud services](../cloud/services.md)).

## Where the code lives

Decided October 22, 2026: the Tailscale and ngrok model. The code that runs on a person's machines
is open source, and the hosted service acorn runs is closed source.

- **Open source, in this repository:** the relay server in `apps/relay` (new) with its self-hosted
  mode, the Node's tunnel client and channel endpoint in `packages/node-core`, the relay socket
  factory in `@acorn/custody`, the sign-in plugin in `plugins/account` (new), the phone app, the
  account API's types and published schemas, a stand-in account service for tests, and every protocol
  type in `@acorn/protocol`.
- **Closed source, run by acorn:** the hosted service. That's the account service, the account
  website's own pages, sign-up and plans, and the infrastructure that runs them. It isn't in this
  repository.

The line is that a self-hoster needs nothing closed. The relay's self-hosted mode reaches their own
Node with no account, and they serve the phone app from their own host.

### The account API is the boundary

The open code talks to the hosted service only through the account API. This repository owns that
contract: Zod types in `@acorn/protocol` and JSON schemas in `docs/schemas/`, the same way
[Node enrollment](../../node-enrollment.md) publishes enrollment v1. A change to the contract lands
here first, and the hosted service follows it.

This repository also ships a stand-in account service for tests, beside the stand-in control plane in
`packages/node-core/src/testkit/controlPlaneStub.ts`. It signs in a test account, registers Nodes,
and issues tickets and assertions with a test key. Every open-side test and the `pnpm dev:agent`
flows run against it, so nobody needs the hosted service to work on the open code.

### How the docs refer to the hosted service

Docs in this repository describe the open code and the account API. They refer to "the hosted
service" or "the account service" by what it does and which routes it answers, never by its
repository, file paths, or internals. Someone who clones this repository must be able to follow every
link and run every check.

Until the hosted service has its own repository and docs, its design stays in this folder, under
headings and steps that start with **Hosted service**. When it moves, those sections move with it,
and what stays here is the account API contract and the open-side work.
## Environments

| Environment | Purpose | Data |
| --- | --- | --- |
| Local | One developer. Nodes run from a checkout, with the relay and the stand-in account service. Working on the hosted service itself uses that service's own local setup. | Throwaway. |
| Staging | The people building acorn. A real GitHub OAuth app and one region. | Test accounts only. Reset whenever needed. |
| Production | Everyone. One region for the account service, relays where people are. | Account data. Backed up and audited. |

## Hosted service: infrastructure before production

[Phase 5](./phases/05-production.md) checks these off. Earlier phases create the staging version of
each as they need it.

- A domain, with DNS for the account website, the account API, and each regional relay.
- Public TLS certificates for the website, the account API, and the relays. Nodes keep their own
  self-signed, pinned certificates.
- Managed Postgres for the account service, with point-in-time recovery.
- Secrets storage for the service: OAuth client secrets and the signing keys for tickets and
  assertions.
- Logs, metrics, and error reporting that never carry task content. The repository has a Sentry
  plugin, `plugins/sentry-telemetry`.
- CI that runs the account service and relay tests and deploys staging on merge, and production on
  a tagged release.

## Service-to-service authentication

| Caller | Callee | Credential |
| --- | --- | --- |
| Account website and phone app | Account service | `HttpOnly` session cookie with CSRF protection. |
| Sign-in plugin on a local Node | Account service | An OAuth access and refresh token from the device flow, stored as an encrypted connection on that local Node. |
| Native client | Relay | A relay ticket from the account service, or the static credential in self-hosted mode. |
| Phone app | Relay | A relay ticket from the account service. |
| Node | Relay | The Node's relay credential, or the static credential in self-hosted mode. |
| Client | Node | A device token, inside pinned TLS or the phone's encrypted channel, as today. |

## Hosted service: operating it

- The account service and relay are stateless apart from Postgres and the relay's in-memory routing
  table. Scale them sideways.
- A relay restart drops every stream. Clients reconnect through the existing reconnect and refetch
  path, and agents on the Node keep running.
- An account service outage stops new sign-ins, tickets, and assertions. Connections already open
  stay open. A client that needs a new stream after its ticket expires can't open one until the
  service is back.

## Verify before building

Check that the relay, the sign-in plugin, and the stand-in account service need nothing from the
hosted service beyond the published account API.
