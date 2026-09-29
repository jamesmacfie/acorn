# Cloud tasks and the control plane

Status: proposed architecture, 2026-09-29. No cloud service in this programme is shipped or
scheduled. The choices below came from the cloud-task planning conversation; technical gates in
the [work plan](./work-plan.md) still need measured results. Where a proposal here disagrees with a
shipped contract, the owning reference document wins until implementation changes that contract.

## The product decision

Desktop and TUI remain the clients for doing work. A small web app administers accounts, teams,
roles, billing, Node inventory, and plugin policy. A team has one durable, Acorn-hosted Node for
shared projects and task history. A cloud task runs on a full Acorn Node that is provisioned for that
task, can run its selected plugins, and is destroyed after inactivity. The task stays in its logical
project in both clients. A later web client may use the same Node API to do work in a browser.

Local projects stay private until a person explicitly publishes one to a team. A project can then
have local and cloud tasks. An explicit, reviewed snapshot carries uncommitted local files into a
cloud task; Acorn does not continuously synchronize worktrees. Finished work can become a branch,
pull request, or patch. The team Node retains core and agent history for immediate reading and an
encrypted archive of the entire worker data root for later restoration of other plugin state.

The control plane stores accounts, membership, Node inventory, placement, and billing metadata. It
does not store task content. A separate relay moves encrypted traffic between clients and private
Nodes without interpreting it. This extends the [three-party boundary](../../architecture-overview.md#the-three-parties-and-what-a-control-plane-may-hold),
and changes the relay timing proposed in [remote access](../remote.md#the-relay-service-acorndev-or-similar):
desktop and TUI need private-Node reachability before a browser workspace exists.

## Read this programme

| File | Purpose |
| --- | --- |
| [architecture.md](./architecture.md) | Runtime topology, data ownership, task lifecycle, plugin policy, identity, security, hosting, cost, and speed. |
| [work-plan.md](./work-plan.md) | Ordered slices, public contract changes, experiments, acceptance checks, and launch gates. |
| [refused.md](./refused.md) | Alternatives rejected for the first release and the conditions for revisiting them. |

Before changing code, read [architecture overview](../../architecture-overview.md),
[workspaces and tasks](../../workspaces-and-tasks.md), [state ownership](../../state-ownership.md),
[Node enrollment](../../node-enrollment.md), [plugin activation](../../plugins/activation.md), and
[authentication](../../authentication.md). These describe the contracts the cloud work must extend.

## Verify before building

Recheck the shipped contracts and the dated provider findings in [architecture.md](./architecture.md).
In particular, confirm Node protocol compatibility, plugin package and archive formats, regional
placement, and the current billing terms. Do not turn a proposal in this folder into a claim that a
feature already exists.
