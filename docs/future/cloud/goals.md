# Goals, constraints, and terms

Status: proposed, 2026-09-29. This file says why the cloud programme exists, what it must achieve,
and which rules no phase may break. Read it before any other file in this folder. When a design
choice elsewhere looks odd, the reason is usually one of the constraints below.

## The problem

acorn runs agents on the machine you sit at. That ties a task's life to a laptop lid. An agent
stops when the machine sleeps, a long run blocks the machine's CPU and disk, and a colleague cannot
look at a task's transcript without screen sharing. A person can already pair a remote Node by
hand ([node distribution](../../node-distribution.md)), but they must buy and run the machine,
open a port, carry a pairing code, and keep the machine patched. Nobody shares it with a team.

The cloud programme makes "run this task somewhere else" a choice in the new-task flow. The task
keeps running when the laptop closes, the team can read it, and the machine it ran on disappears
when the work is done.

## The business shape

acorn core stays free and open source. A person with no account keeps the full product: the
desktop, the TUI, local Nodes, and hand-paired remote Nodes. The paid service sells three things
that are hard to do alone:

1. Machines that appear for a task and disappear after it, placed in a region the team chose.
2. A durable team Node that holds shared projects and task history, backed up and reachable.
3. Administration: accounts, team membership, roles, plugin policy, usage, and a budget cap.

Model usage is not resold. Teams bring their own provider keys. For the pricing shape, see
[hosting and cost](./hosting-and-cost.md#what-the-customer-pays-for).

## Goals

- **Run in cloud is one choice.** A member picks local or cloud when creating a task. A cloud task
  shows up in the same project, in the same rail, in desktop and TUI.
- **An authenticated task Node in 15 seconds on the warm path.** Measured from **Run in cloud** to a
  Node the client has adopted, with the project and plugin roster visible. Checkout and dependency
  installation may continue after that, with visible progress.
- **Work survives the client.** Closing the laptop does not stop an agent. Reopening shows
  everything that happened, without gaps or duplicate approvals.
- **Nothing is lost at teardown.** A worker is destroyed only after its history reached the team
  Node and its whole data root is in a verified archive.
- **Teams can read each other's work.** Members see shared projects and cloud tasks. Viewers can
  read without mutating. Admins manage people, plugins, secrets, and spend.
- **Spend has a ceiling.** Before a run starts, the member sees an estimate. A team's hard budget
  stops new work and ends running work through the same safe path as an idle teardown.

## Non-goals for the first release

- A browser workspace. The web app administers accounts and infrastructure. It never shows code or
  transcripts. The contracts must leave a future browser client possible
  ([remote access](../remote.md#web-client-what-changes-and-what-doesnt)).
- Continuous two-way sync of a local worktree with a cloud task. A snapshot goes up once. Results
  come back as a branch, pull request, or patch.
- Sharing a person's local Node with their team. The relay lets an owner reach their own Node.
- Reselling model access, or proxying model traffic for billing.
- Multi-region teams, or moving a team between regions.
- Mobile.

## Constraints no phase may break

Each rule has an owning document. The cloud work extends those documents; it does not override them.

| Rule | Why | Owner |
| --- | --- | --- |
| A local Node with no account behaves exactly as it does today. No cloud code path runs when nothing is configured. | The open-source promise, and the sandbox programme's absent-means-off rule. | [architecture overview](../../architecture-overview.md#the-three-parties-and-what-a-control-plane-may-hold), [sandbox README](../sandbox/README.md#what-must-not-regress) |
| The control plane stores what it takes to find, vouch for, place, and bill a Node. It stores no task content: no code, prompts, transcripts, or plugin data. | Keeps the control plane replaceable and the trust story short. | [architecture overview](../../architecture-overview.md#the-three-parties-and-what-a-control-plane-may-hold) |
| The relay moves encrypted bytes and cannot read them. Clients keep pinning the Node's certificate end to end. | A relay compromise yields routing metadata, not work. | [relay](./relay.md) |
| Nodes stay independent. No shared database, no cross-Node transaction. The team Node reads worker history through explicit, versioned contracts. | The Node model every client and plugin is built on. | [architecture overview](../../architecture-overview.md) |
| `/v1` routes, the `acorn-1` baseline, enrollment v1, and the meaning of a device token do not change in place. New behavior is additive or a new version. | Older clients and Nodes keep working. | [API reference](../../api-reference.md#versioning), [Node enrollment](../../node-enrollment.md#versioning) |
| A plugin's client bundle runs on a device only after that device trusted its exact hash. Team approval does not trust code on anyone's machine. | The consent surface for third-party code. | [security](../../security.md#third-party-plugin-bundles) |
| An agent or plugin never gets administrative cloud authority through a task-scoped token. | The loopback-API gates, applied to a new kind of authority. | [sandbox API gates](../sandbox/api-gates.md) |
| Compute is destroyed only after its archive verifies. A timed-out API call is never read as success. | Losing a team's work is the failure that ends the product. | [archive](./archive.md) |
| A team's data stays in its chosen region: team Node, worker, snapshots, artifacts, and archives. | The promise that justifies choosing a region at all. | [hosting and cost](./hosting-and-cost.md#regions) |

## Terms

These words have one meaning across this folder. Other files use them without redefining them.

| Term | Meaning |
| --- | --- |
| _Account service_ | The hosted service that owns users, sign-in, teams, membership, roles, Node inventory, placement, and billing. Part of the control plane. |
| _Control plane_ | The account service plus the provisioner. Holds metadata only. |
| _Provisioner_ | The part of the control plane that calls the compute provider's API to create and destroy machines. It holds the provider API token. |
| _Admin web app_ | The browser app for the account service. Administration only. |
| _Relay_ | A hosted service that joins a client's outbound connection to a Node's outbound connection and forwards encrypted bytes. |
| _Team Node_ | One durable, acorn-hosted Node per team. Owns shared projects, the task index, task history, plugin policy, secrets, and archive manifests. |
| _Worker_, or _task Node_ | A full acorn Node provisioned for one attempt at one cloud task, destroyed after inactivity. |
| _Logical task_ | The task a person sees. Its ID is minted on the team Node and never changes. |
| _Attempt_ | One worker's run of a logical task. A logical task can have many attempts over time. |
| _Shared project_ | A project on the team Node, with a team project ID. A local project maps to it after an explicit publish. |
| _Snapshot_ | An immutable upload of tracked changes and selected untracked files from a local checkout. |
| _Grant_ | A short-lived, signed statement from the account service that a person holds a role for a named Node. |
| _Whole-root archive_ | An encrypted copy of a worker's entire data root, taken after a drain. |
| _Plugin lock_ | The exact set of plugin packages and hashes a given attempt runs, frozen before it launches. |

## How to tell the programme worked

- A member starts a cloud task from desktop, closes the laptop, opens the TUI on another machine,
  and answers the agent's question there.
- Ten minutes after the agent finishes, no worker is running and no worker is billed. The transcript
  opens instantly from the team Node. A plugin pane from that task opens after a restore, with its
  data intact.
- A viewer can read the task and cannot change it, even by calling the Node API directly.
- Removing a person from the team closes their open connections within seconds.
- The monthly invoice matches the usage ledger to the cent, and no team ever paid for a worker it
  could not see.
