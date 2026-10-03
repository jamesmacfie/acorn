# Architecture for cloud tasks

Status: proposed, 2026-09-29. This is the map of the runtimes, who owns what, and which shipped
contracts change. Each topic has its own file with the detail. [The phases](./phases/README.md)
order the work, and [the refusals](./refused.md) record alternatives.

## What exists and what is missing

A client connects to independent Nodes. A Node owns its projects, tasks, plugin databases,
worktrees, agent ledger, and device tokens. The desktop helper and the TUI each hold paired-Node
credentials and certificate pins. Client caches are keyed by Node ID. A Node serves one
authenticated HTTP API and one WebSocket, with no web assets. See
[architecture overview](../../architecture-overview.md), [state ownership](../../state-ownership.md),
and [API reference](../../api-reference.md).

Some preparation already shipped:

- A standalone Node builds with `pnpm pack:node` and runs headless
  ([node distribution](../../node-distribution.md)).
- A provisioned Node can enroll with a control plane at first boot through enrollment v1
  ([Node enrollment](../../node-enrollment.md)). A stub control plane is in
  `packages/node-core/src/testkit/controlPlaneStub.ts`.
- A loaded plugin can contribute a Node provider through `ctx.providers.nodes`. The host adopts a
  provided Node only after checking the fingerprint the provider vouched for
  ([Node providers](../../plugins/node-side-extension-points.md#node-providers)).
- The loopback-API gates and plugin containment rung 2 shipped
  ([security](../../security.md)).
- A task-scoped port tunnel exists at `/v1/tunnel` (`packages/node-core/src/server/transport/tunnel.ts`),
  which previews already use.

What does not exist: a container image, any hosted service, accounts, teams, roles, a relay, a
project shared across Nodes, a task that runs on a different Node from its project, an archive of a
whole data root, and any notion of a person who is not the Node's single owner.

## Runtime topology

```text
                        ┌──────────────────────── control plane ─────────────────────────┐
                        │  account service: users, teams, roles, inventory, billing       │
 admin web app ────────►│  provisioner: calls the compute provider API                    │
 (browser, admin only)  │  grant issuer: signs short-lived Node grants                    │
                        └──────────────▲───────────────────────────────▲──────────────────┘
                                       │ sign-in, grants                │ enroll, revocations
                                       │                                │
 desktop / TUI ──── outbound ────► relay (per region) ◄──── outbound ──┴── team Node (durable)
   custody pins every Node           forwards TLS bytes                     shared projects,
   end to end                        it cannot read                         task index, history,
                                           ▲                                policy, secrets
                                           │ outbound                            │
                                     worker (one per attempt) ──── history ──────┘
                                       full Node, task checkout,       (through the relay)
                                       agents, plugins
                                           │
                                     regional object store: snapshots, artifacts, archives
```

Every hosted Node dials out. No hosted Node accepts an inbound connection from the internet. The
relay is the only path to a hosted Node, for clients and for the team Node alike.

## Runtimes and what each owns

| Runtime | Owns | Does not own |
| --- | --- | --- |
| Desktop or TUI | Presentation, local drafts and caches, Node pins, device tokens, and cached grants. | The authoritative copy of a cloud task. |
| Account service | Users, sign-in, teams, membership, roles, Node inventory, placement records, enrollment records, region choice, usage ledger, and billing. | Code, prompts, transcripts, plugin databases, task history. |
| Provisioner | The compute provider API token, machine creation and destruction, and the idempotent operation log. | Any Node credential. |
| Relay | Short-lived connection routing and byte counts. | Decrypted traffic. |
| Team Node | Shared project IDs, the task index, core and agent history for cloud tasks, plugin policy, cloud connections, team secrets, snapshot and archive manifests, and admission. | A running worktree once its worker is gone. |
| Worker | One attempt's checkout, plugin runtime and databases, terminals, agent processes, and live task routes. | Team membership, the canonical project ID, or any other attempt. |
| Regional object store | Encrypted snapshots, artifacts, and whole-root archives, under the team Node's authority. | Account data, or a queryable task database. |

For how each one is built, deployed, and operated, see [services](./services.md).

## Trust boundaries

The account service is the grant issuer. Trusting it is the whole game for hosted Nodes, in the
same way that trusting a control plane is the whole game for an enrolled Node today
([security](../../security.md#the-control-plane-and-the-inversion-it-costs)). What bounds that
trust:

- The account service holds no device token for a hosted Node, and no path in it reads task
  content. It can mint a grant, and a hosted Node audits every grant it accepts with the account
  ID in it.
- The relay forwards a TLS session it does not terminate. It cannot substitute a Node, because the
  client pins the Node's certificate.
- The team Node can read everything its team does. It is the team's own server.
- A worker is isolated from other workers and the team Node by the provider's VM. Inside a worker,
  an agent is isolated from the worker Node's own secrets by the task sandbox. See
  [isolation](./isolation.md).
- A local Node is untouched. It never accepts a grant and never learns about a team unless its owner
  publishes a project.

## The main flows

| Flow | Summary | Detail |
| --- | --- | --- |
| Sign in | A client signs in to the account service through an OAuth device flow run by a cloud plugin on the local Node. | [identity](./identity.md) |
| Reach a hosted Node | The client asks for a grant and a relay ticket, dials the relay, and opens pinned TLS through it. | [relay](./relay.md), [identity](./identity.md#grants) |
| Publish a project | The member publishes a local project to the team. The team Node mints a team project ID, and the local Node stores the mapping. | [projects and tasks](./projects-and-tasks.md#shared-projects) |
| Run a task in the cloud | The team Node reserves the task and attempt, the provisioner creates a worker, the worker enrolls, pulls its seed, and the client adopts it. | [projects and tasks](./projects-and-tasks.md#the-attempt-lifecycle) |
| Keep history | The worker streams core and agent events to the team Node with sequence numbers. The team Node acknowledges each batch. | [projects and tasks](./projects-and-tasks.md#history-transfer) |
| Tear down | After five idle minutes, the worker drains, archives its whole root, and the team Node verifies the archive before the provisioner destroys it. | [archive](./archive.md) |
| Restore | A person asks for plugin detail from a finished task. A new isolated Node restores the archive with fresh credentials. | [archive](./archive.md#restore) |
| Enforce a role | Every hosted Node checks the grant's role on every route, stream, plugin bridge, and approval. | [identity](./identity.md#roles-and-route-classification) |
| Charge | Admission reserves spend before provisioning. Provider readings reconcile afterwards. | [hosting and cost](./hosting-and-cost.md#admission-and-budgets) |

## Contracts that change

Keep `/v1` and `acorn-1` compatible. Add optional protocol types and routes. Where an additive
change cannot express the behavior, add a separately versioned contract. Put Node wire shapes in
`@acorn/protocol`. Keep the account service API separate from the Node API.

| Contract | Addition | Owner | First phase |
| --- | --- | --- | --- |
| Container image | A published Node image with task tooling, running as a non-root user. | `apps/node` packaging | [1](./phases/01-node-image.md) |
| Account API | Sign-in, teams, membership, inventory, and grant issuance. A separate, versioned HTTP API. | Account service | [2](./phases/02-account-service.md) |
| Enrollment v2 | No device token in the request. The reply carries the grant issuer's keys and a relay credential. | `@acorn/protocol` and the account service | [3](./phases/03-team-node.md) |
| Grant principal | A third principal kind on hosted Nodes: a person with a team role, from a verified grant. | `packages/node-core` auth | [3](./phases/03-team-node.md) |
| Grant custody | A client credential that expires and refreshes through the cloud plugin, beside device tokens. | `@acorn/custody` | [3](./phases/03-team-node.md) |
| Relay transport | A Node-side outbound tunnel and a client-side socket factory that keep pinned TLS. | `packages/node-core` transport, `@acorn/custody` broker, relay | [4](./phases/04-relay.md) |
| Project identity | Team project IDs, the local-to-team mapping, and execution location on a task. | Team Node, projected through `@acorn/protocol` | [5](./phases/05-cloud-task.md) |
| Attempt lifecycle | Reserve, provision, set up, route, stop, archive, restore, and reconcile, each idempotent. | Team Node orchestrator | [5](./phases/05-cloud-task.md) |
| History transfer | Ordered, resumable transfer of core and agent events and artifacts. | Core and the agents plugin | [5](./phases/05-cloud-task.md) |
| Whole-root archive | A versioned, encrypted format with a manifest, verification, and credential rotation on restore. | Team Node and worker | [6](./phases/06-archive.md) |
| Execution target | An isolated task execution target inside Linux workers. | `packages/node-core`; [worker isolation](./isolation.md) | [7](./phases/07-isolation.md) |
| Team policy | Execution, egress, tool, model, and MCP policy, delivered to a worker as the managed layer. | Team Node; [team policy](./isolation.md#team-policy) | [7](./phases/07-isolation.md) |
| Plugin policy | Team baseline, project overrides, approved hashes and grants, and a frozen lock per attempt. | Team Node and the plugin loader | [8](./phases/08-plugins.md) |
| Route classification | A read or mutate declaration on every core and plugin route and action. | `packages/node-core` and each plugin | [9](./phases/09-teams.md) |
| Usage | Admission reservations, provider reconciliation, and hard budgets. | Account service and team Node admission | [10](./phases/10-billing.md) |

Before any phase writes code, its design section names exact endpoints, wire schemas, and
idempotency keys. An agent or plugin must not reach an administrative cloud grant through an
existing task-scoped token.

## Isolation inside a cloud worker

Each cloud task runs in a full Node so the Node API and plugin runtime move with it. The provider's
VM separates workers, but task processes still need a boundary around the worker Node's secrets.
[Worker isolation](./isolation.md) owns that Linux execution boundary and team policy. It must
preserve normal Git access in the worker's own checkout. This programme does not add sandboxing to
local tasks.

## Verify before building

Recheck the shipped contracts named here: [Node enrollment](../../node-enrollment.md),
[authentication](../../authentication.md), [Node providers](../../plugins/node-side-extension-points.md#node-providers),
[plugin activation](../../plugins/activation.md), and [backup](../../data-layer.md#backup-and-import).
Recheck the dated provider facts in [hosting and cost](./hosting-and-cost.md). Do not describe a
proposal in this folder as shipped.
