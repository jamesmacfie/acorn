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

Start with goals and architecture, in that order, then [the phases](#the-phases). Take the topic files
as a phase needs them.

| File | What it covers |
| --- | --- |
| [goals.md](./goals.md) | The problem, the business shape, goals and non-goals, the constraints no phase may break, and the terms used everywhere else. |
| [architecture.md](./architecture.md) | Runtime topology, what each runtime owns, trust boundaries, the main flows, and every contract that changes. |
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

## The phases

| Phase | What is deployed at the end | Who can use it | Depends on |
| --- | --- | --- | --- |
| [1. Node image](./01-node-image.md) | A published acorn Node image, and a recipe to run one on the compute provider and pair it by hand. | Anyone who self-hosts. | Nothing. |
| [2. Team Node](./02-team-node.md) | Teams with a region. Creating a team provisions its team Node behind the relay. Desktop and TUI use it with no pairing code. | Internal. | 1, and [remote access phase 2](../remote-access/02-accounts.md). |
| [3. Cloud task](./03-cloud-task.md) | Publish a project and run a task in the cloud from desktop or TUI, with history kept on the team Node. Manual stop. | Internal. | 2. |
| [4. Archive](./04-archive.md) | Idle workers archive and disappear after five minutes. Plugin detail restores on demand. | Internal. | 3. |
| [5. Isolation](./05-isolation.md) | A hardened worker: sandboxed task processes, brokered model keys, enforced egress, team policy. | Closed alpha: single-person teams, own keys. | 4. |
| [6. Plugins](./06-plugins.md) | Admin-approved loaded plugins, cloud connections, and frozen plugin locks in cloud tasks. | Closed alpha. | 5. |
| [7. Teams](./07-teams.md) | Invitations, admin, member, and viewer roles enforced on every route, and live revocation. | Closed beta, free. | 6. |
| [8. Billing](./08-billing.md) | Metering, estimates, hard budgets, and invoices. | Paid beta. | 7. |
| [9. Production](./09-production.md) | Three regions, backups, quotas, runbooks, security review, and the speed target met. | General availability. | 8. |

Phase 1 has no dependency on remote access and can run beside it. Phase 5 owns the
worker execution boundary and team policy described in [isolation](./isolation.md).

## Why this order

- **The Node image first**, because every hosted thing is that image, and because it answers the
  speed and provider questions with real numbers before anything depends on them.
- **One person before many.** Phases 2 to 6 prove the whole single-person loop, including teardown
  and plugins, before multi-person roles add a second axis of complexity.
- **Remote access before any hosted Node.** Team Nodes and workers never get public addresses, so
  they use the account service and relay from [remote access](../remote-access/README.md) from
  the start.
- **Nothing is lost before anything is shared.** Archive and restore land before anyone outside the
  building team uses a worker.
- **Hardening before outsiders.** Phase 5 is the gate for the first external user, because a worker
  holds a team's secrets next to an agent.
- **Charging last.** Billing needs every metered thing to exist, and a free closed beta finds the
  problems cheaper than a paid one.

## Decisions to make before phase 1

Each is also listed in the phase that first needs it. Making them early saves rework.

1. The compute provider organization, with separate staging and production accounts.
2. Who holds the credentials for staging and production infrastructure.

The product name and domain are decided in
[remote access phase 2](../remote-access/02-accounts.md#open-questions). The hosted service
is closed source ([services](./services.md#where-the-code-lives)).

## Rules for every phase

- Each phase starts by writing its design section: exact endpoints, wire schemas, idempotency keys,
  and which owning documents change. Put the design at the top of the phase file, or in the owning
  document if the contract is shipping.
- Run `pnpm lint` and the relevant tests for each slice, and `pnpm test` for the whole suite.
- For desktop changes, test in the real Tauri window with `pnpm dev:agent` and the UI driver. For TUI
  changes, use the isolated PTY driver. See [local development](../../local-development.md).
- Test a packed Node image as well as a checkout.
- When a phase ships a contract, update the owning document under `docs/` in the same change. Move
  shipped behavior out of this folder; leave the phase file as the record of decisions and evidence.
- Record measured results, such as boot times, archive sizes, and costs, in the phase file's
  evidence section with the date.
- Each phase's open questions are answered, or explicitly deferred with a reason, before its
  acceptance is signed off.

## How a checkpoint works

A checkpoint is a manual test that someone runs and records before the phase continues. It names the
setup, the steps, and what you should see. If a checkpoint fails, fix the cause before starting the
next step. A checkpoint that is skipped is written down as skipped, with the reason.

## Known gaps in the design

These are the biggest unanswered questions. Each is listed in full in the phase that must answer it.

- How a pane reaches a worker that is not the active Node. The client routing change is the largest
  unknown on the client side ([phase 3](./03-cloud-task.md)).
- How egress is enforced on a provider VM that may not filter it
  ([phase 5](./05-isolation.md)).
- How an agent session continues after its worker is gone, so a cloud task keeps the agent's
  memory of the conversation the way a local one does ([phase 4](./04-archive.md)).
- Where admins edit plugin policy, cloud connections, and secrets, given that the web app never
  talks to a Node ([phase 6](./06-plugins.md#open-questions)).
- Where the per-team archive key lives ([phase 4](./04-archive.md)).
- Whether EU account metadata must stay in the EU
  ([remote access phase 2](../remote-access/02-accounts.md#open-questions)).

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
