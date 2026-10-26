# Services, repositories, and environments

Status: proposed, 2026-09-29. Revised October 22, 2026: the account service, website, sign-in
plugin, and relay are built by [remote access](../remote-access/README.md), and this file lists
what cloud adds to them. This file lists every deployable the programme adds, where its code
should live, what it runs on, and how it reaches production. The choices marked _recommended_ are
defaults a phase can overturn with a reason. The rest are open and listed as questions in the phase
that first needs them.

## The deployables

| Deployable | What it is | Stack | Runs where | First phase |
| --- | --- | --- | --- | --- |
| Node image | The standalone Node plus task tooling, as an OCI image. Used for team Nodes and workers. | `apps/node` build, Debian slim base | Compute provider | [1](./01-node-image.md) |
| Account service | Built by remote access. Cloud adds teams, roles, inventory, grants, provisioning, and billing. | TypeScript, Hono, Better Auth, Drizzle, Postgres | One control-plane region | [2](./02-team-node.md) |
| Admin web app | The account website from remote access, with team administration added. | TypeScript and Solid, recommended, so it can reuse `@acorn/client-core` kit tokens | Served by the account service, or a static host | [2](./02-team-node.md) |
| Sign-in plugin | Built by remote access. Cloud adds team Nodes to its Node provider, and grants. | acorn plugin API | Each person's local Node | [2](./02-team-node.md) |
| Provisioner | Creates and destroys machines, reconciles state, and records every operation. | Part of the account service process, with its own job queue | Control-plane region | [2](./02-team-node.md) |
| Relay | Built by remote access. Cloud runs one in each team region. | TypeScript on Node, or Go if measured throughput needs it | One or more instances per team region | [2](./02-team-node.md) |
| Object storage | Buckets for snapshots, artifacts, and archives, one per region. | S3-compatible storage | Team region | [3](./03-cloud-task.md) |
| Status page | Public service status. | Hosted status-page product | Anywhere | [9](./09-production.md) |

The team Node and the worker are not separate codebases. Both are the ordinary Node from the Node
image, configured by environment at provision time. A team Node turns on the orchestrator and the
history read model. A worker turns on attempt mode. A local Node turns on neither.

## Where the code lives

Cloud follows the split [remote access](../remote-access/README.md#where-the-code-lives) decided on
October 22, 2026: the code that runs on people's machines is open, and the hosted service is closed.
Docs here follow its rule for [referring to the hosted service](../remote-access/README.md#how-the-docs-refer-to-the-hosted-service).

- **Open source, in this repository:** the Node image build, enrollment v2 and grant verification in
  `packages/node-core`, the history-transfer and archive code, the team additions to the sign-in
  plugin, the account API additions for teams and grants, and every protocol type in
  `@acorn/protocol`.
- **Closed source, run by acorn:** the hosted service's team, grant, and admin features, the
  provisioner, billing, and the infrastructure that runs them.

Anything a self-hoster needs to run acorn Nodes behind their own relay is open. The account API must
be documented well enough that someone else could write a compatible control plane, the way
[Node enrollment](../../node-enrollment.md) lets somebody else write one today.

## Environments

| Environment | Purpose | Data |
| --- | --- | --- |
| Local | One developer. `docker compose` runs Postgres, the account service, the relay, and a MinIO bucket. Nodes run as containers or from a checkout. The provisioner has a local Docker adapter. | Throwaway. |
| Staging | The team building acorn. Real provider, real GitHub OAuth app, one region. | Test accounts only. Reset whenever needed. |
| Production | Customers. Three regions for Nodes and storage, one region for the control plane. | Customer data. Backed up and audited. |

A local provisioner adapter that starts Node containers on the developer's Docker daemon is worth
building early. It makes every lifecycle phase testable on a laptop, and it is the second
implementation that keeps the provider interface honest.

## Infrastructure that must exist before production

This list is what [phase 9](./09-production.md) checks off. Earlier phases create the
staging version of each item as they need it.

- A domain, with DNS for the admin web app, the account API, and each regional relay.
- Public TLS certificates for the web app, the account API, and the relays. Nodes keep their own
  self-signed, pinned certificates.
- A compute provider organization, with separate staging and production accounts.
- A container registry the provider can pull from quickly in every region.
- Managed Postgres for the account service, with point-in-time recovery.
- An S3-compatible bucket in each team region, with region-locked placement.
- A key management approach for per-team archive keys. See [archive](./archive.md#encryption).
- Secrets storage for the service itself: provider API token, OAuth client secrets, grant signing
  keys, billing API key, and email API key.
- An email provider for invitations and account notices, from [phase 7](./07-teams.md).
- A billing provider, from [phase 8](./08-billing.md).
- Logs, metrics, and error reporting that never carry code or prompts. The repository already has
  a Sentry plugin (`plugins/sentry-telemetry`) and OTLP audit export is planned in
  [worker isolation](./isolation.md#audit-export).
- CI that builds and signs the Node image, runs the account service tests, and deploys staging on
  merge and production on a tagged release.

## Service-to-service authentication

| Caller | Callee | Credential |
| --- | --- | --- |
| Admin web app | Account service | HTTP-only session cookie with CSRF protection. |
| Sign-in plugin on a local Node | Account service | An OAuth access and refresh token from the device flow, stored as an encrypted connection on that local Node. |
| Client | Hosted Node | A grant, carried in the `Authorization` header over pinned TLS through the relay. |
| Client or Node | Relay | A relay ticket for a client, a relay credential for a Node. |
| Hosted Node | Account service | A per-Node service credential issued at enrollment v2. Used to read revocations and to request provisioning. |
| Worker | Team Node | An attempt token minted by the team Node and passed through the provisioner. Scoped to one attempt. |
| Provisioner | Compute provider | The provider API token. Never leaves the control plane. |

No hosted Node holds the compute provider token. The team Node asks the provisioner to create a
worker, and the provisioner checks the team, budget, and reservation before calling the provider.

## Operating the services

- The account service and relay are stateless apart from Postgres and the relay's in-memory
  routing table. Scale them horizontally.
- The team Node is a single-writer SQLite Node, like every acorn Node. One per team is the target.
  Its volume is the team's durable state, and its backup is the most important one in the system.
- Workers are cattle. The provisioner's reconciliation loop compares the provider's machine list
  with its own records every minute and raises an alarm on any machine it cannot account for.
- Every external operation has a stable idempotency key, and every retry reuses it.

## Verify before building

Check the current Better Auth, Hono, and Drizzle versions against the repository's. Check whether
the provider's registry pulls are fast enough in each region, or whether a regional mirror is
needed. Check that the relay can live in this repository without pulling a private dependency.
