# Cloud tasks and the control plane

Status: proposed, 2026-09-29. Nothing in this programme is built or scheduled. Where a file here
disagrees with a shipped contract, the owning reference document wins until the implementation
changes that contract.

## What this is

A person chooses **Cloud** when creating a task. acorn starts a full Node for that task on a hosted
machine in the team's region, and the task shows up in the same project in desktop and TUI. The agent
keeps working when the laptop closes. Teammates can read the task. Five minutes after the work stops,
the machine archives everything and disappears.

Behind that, each team has one durable, acorn-hosted team Node for shared projects and history. The
account service from [remote access](../remote-access/README.md) gains teams, roles, placement, and
billing, and still never sees code or transcripts. The relay from the same programme joins clients to
hosted Nodes without being able to read the traffic.

This programme depends on [remote access](../remote-access/README.md), which builds accounts, sign-in,
the relay, and pairing for a person's own Node. Cloud's first hosted phase starts after remote access
phase 2.

acorn core stays free and open source. With no account, nothing changes. For why the programme
exists and the rules it keeps, read [goals](./goals.md) first.

## Read this programme

Start with the first three, in order. Take the topic files as a phase needs them.

| File | What it covers |
| --- | --- |
| [goals.md](./goals.md) | The problem, the business shape, goals and non-goals, the constraints no phase may break, and the terms used everywhere else. |
| [architecture.md](./architecture.md) | Runtime topology, what each runtime owns, trust boundaries, the main flows, and every contract that changes. |
| [phases/README.md](./phases/README.md) | The nine phases, what each deploys, who can use it, and the rules for every phase. |
| [services.md](./services.md) | Every deployable, where its code lives, environments, infrastructure, and service-to-service credentials. |
| [identity.md](./identity.md) | Grants, enrollment v2, roles, route classification, and revocation. Accounts and sign-in are in [remote access](../remote-access/accounts.md). |
| [projects-and-tasks.md](./projects-and-tasks.md) | Shared projects, snapshots, the attempt state machine, history transfer, and results. |
| [memory.md](./memory.md) | Shared project memory, private memory per account, worker seeds and write forwarding, attribution, roles, and optional approval. Depends on phase 7. |
| [archive.md](./archive.md) | The whole-root archive, verify-then-destroy, encryption, and restore with fresh credentials. |
| [plugins-and-secrets.md](./plugins-and-secrets.md) | Plugin policy and locks, cloud connections, team secrets, and how model keys reach an agent. |
| [isolation.md](./isolation.md) | Worker process isolation, egress, team policy, audit export, and the adversarial test. |
| [clients.md](./clients.md) | Every desktop and TUI change, from sign-in to routing a pane to a worker. |
| [hosting-and-cost.md](./hosting-and-cost.md) | Provider choice, regions, scale, the speed target, pricing shape, admission, and budgets. |
| [refused.md](./refused.md) | Alternatives rejected for the first release, and when to revisit them. |

## The phases at a glance

| Phase | Deployed at the end |
| --- | --- |
| [1](./phases/01-node-image.md) | The Node as a container image on the compute provider, paired by hand. |
| [2](./phases/02-team-node.md) | Teams with a region. Creating one provisions a team Node behind the relay. Desktop and TUI use it. |
| [3](./phases/03-cloud-task.md) | Publish a project and run a cloud task, with history on the team Node. |
| [4](./phases/04-archive.md) | Idle teardown with verified archives, and restore on demand. |
| [5](./phases/05-isolation.md) | Hardened workers and team policy. Closed alpha. |
| [6](./phases/06-plugins.md) | Approved loaded plugins in cloud tasks. |
| [7](./phases/07-teams.md) | Invitations and enforced roles. Closed beta. |
| [8](./phases/08-billing.md) | Metering, budgets, and invoices. Paid beta. |
| [9](./phases/09-production.md) | Three regions and operations. General availability. |

## Known gaps in the design

These are the biggest unanswered questions. Each is listed in full in the phase that must answer it.

- How a pane reaches a worker that is not the active Node. The client routing change is the largest
  unknown on the client side ([phase 3](./phases/03-cloud-task.md)).
- How egress is enforced on a provider VM that may not filter it
  ([phase 5](./phases/05-isolation.md)).
- How an agent session continues after its worker is gone, so a cloud task keeps the agent's
  memory of the conversation the way a local one does ([phase 4](./phases/04-archive.md)).
- Where admins edit plugin policy, cloud connections, and secrets, given that the web app never
  talks to a Node ([phase 6](./phases/06-plugins.md#open-questions)).
- Where the per-team archive key lives ([phase 4](./phases/04-archive.md)).
- Whether EU account metadata must stay in the EU
  ([remote access phase 2](../remote-access/phases/02-accounts.md#open-questions)).

## Owning documents this programme extends

Before changing code, read [architecture overview](../../architecture-overview.md),
[workspaces and tasks](../../workspaces-and-tasks.md), [state ownership](../../state-ownership.md),
[Node enrollment](../../node-enrollment.md), [authentication](../../authentication.md),
[plugin activation](../../plugins/activation.md), [node distribution](../../node-distribution.md),
and [security](../../security.md). [Worker isolation](./isolation.md) owns phase 5's process and
policy design. [Remote access](../remote.md) owns the future browser client.

## Verify before building

Recheck the shipped contracts and the dated provider facts before each phase. Do not turn a proposal
in this folder into a claim that a feature exists.
