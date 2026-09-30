# Shared projects, cloud tasks, and attempts

Status: proposed, 2026-09-29. This file covers how a local project becomes a shared one, how a cloud
task is created and run, the state machine for a worker attempt, and how history reaches the team
Node. Archive and restore have their own file, [archive](./archive.md).

## Shared projects

A local project stays private until a person publishes it to a team. Publishing is explicit and
reversible only by deleting the shared project.

1. The member chooses **Publish to team** on a project. acorn shows the team name, the people who
   can read the project, and the team's region.
2. The client calls the team Node, which mints an opaque team project ID and stores the project's
   display name and Git facets.
3. After the team Node acknowledges, the local Node records the mapping from its own project ID to
   the team project ID. The local project keeps its ID.

Repository URLs and Git provider IDs are facets, not identity. Several checkouts or forks can map
to one shared project. A team member who never had a local copy sees the shared project straight
from the team Node.

**How the rail shows it.** One project, with local tasks from the local Node and cloud tasks from
the team Node, joined by the mapping. This is a fleet fan-out and union, the same pattern every
aggregate surface already uses ([architecture overview](../../architecture-overview.md#client-state-and-fleet-behavior)).
A mutation always goes to the Node that owns the task.

**What does not move.** Project scripts (`setupScript`, `devScript`, and the rest), run targets, and
`.acorn/config.toml` trust decisions stay on the local Node. A shared project has its own copy on the
team Node, set by an admin or member, with its own trust acknowledgement. Copying executable
configuration from a laptop to a hosted machine without review would bypass
[the project-row trust snapshot](../../security.md).

## Execution location

A task gains an execution location: `local` or `cloud`. A project has a default. For `local`,
nothing changes. For `cloud`, the task row lives on the team Node and carries its attempts.

The team Node's task index is a new read model. It is not a copy of a local `tasks` row, and it does
not pretend every plugin's private data is available there.

## Inputs to a cloud task

A cloud task starts from one of two inputs:

- **A Git revision.** A repository and a commit or branch that the worker can fetch. The worker
  needs a Git credential, provided through a cloud connection. See
  [plugins and secrets](./plugins-and-secrets.md#cloud-connections).
- **A snapshot.** For a local checkout with uncommitted work. The client shows the tracked changes
  and lets the member pick untracked files. It shows the total size and file count before upload.
  The snapshot is a base commit plus a patch and a file bundle, sent once, immutable, and stored in
  the team's regional bucket under the team Node's authority. It stays until the task's result is
  secured, then a cleanup job removes it after a documented grace period.

Limits apply to snapshot size, file count, and single-file size. A secret file such as `.env` is
never selected by default, and the preview warns when a selected file matches a secret pattern.

## The attempt lifecycle

A logical task can have many attempts. Each attempt records: worker Node ID, the worker's own task
ID, region, plugin-lock digest, input snapshot or revision, archive ID, lifecycle state, and the
provider's machine handle. The team Node owns this record.

```text
 reserved ─► provisioning ─► setting-up ─► ready ◄──► running
     │             │               │          │           │
     └──────┬──────┴───────┬───────┴──────────┴─────┬─────┘
            ▼              ▼                        ▼
         failed        stopping ─► archiving ─► archived ─► restoring ─► restored
                                        │                        │
                                        └──────► failed ◄────────┘
```

| State | Entered when | Leaves when |
| --- | --- | --- |
| `reserved` | The team Node reserved the logical task, the attempt ID, a budget amount, a concurrency slot, and the plugin lock. | The provisioner accepted the create request. |
| `provisioning` | The provider is creating the machine. | The worker enrolled and pulled its seed. |
| `setting-up` | The worker is checking out, installing dependencies, and starting plugins. Clients can already adopt it. | Setup finished or failed. |
| `ready` | The worker is idle and adopted. | An agent, terminal, or person becomes active. |
| `running` | Work is in progress. | Work stops. After five idle minutes, the team Node starts `stopping`. |
| `stopping` | Idle timeout, a person's stop, or a budget cap. New work is blocked and live processes drain. | Every process stopped and history is checkpointed. |
| `archiving` | The worker writes its whole-root archive. | The team Node verified the archive's manifest and object hashes. |
| `archived` | The archive verified and the provisioner destroyed the machine. | A person asks for a restore. |
| `failed` | Any step failed. The attempt stays visible with its reason and a retry. | A retry, which reuses the same idempotency key. |

`restoring` and `restored` belong to a restore Node, not to a working attempt. See
[archive](./archive.md#restore).

Rules that hold in every state:

- Each external call has a stable idempotency key derived from the attempt ID and the step. A retry
  after a timeout finds the first worker rather than creating a second.
- A reconciliation loop on the team Node, and another in the provisioner, compare recorded state
  with the provider's machine list.
- Destroy happens only after `archiving` verified. A timed-out destroy call is retried, never
  assumed.
- A later run of the same logical task is a new attempt with a new worker. A deleted worker's Node
  ID is never reused.

### What idle means

A worker is idle when no agent turn is running, no process started by a task is running, no
terminal has had input or output, and no client has made a mutating request, for five minutes. An
agent waiting for a human answer is not idle until the runtime can checkpoint and resume that
question safely. Until then it stays running, and spend continues. The client says so.

### Boot sequence for a worker

1. The provisioner creates the machine from the Node image, in the team's region, with the
   enrollment token, the attempt token, the team Node's relay route, and the grant issuer URL in its
   environment.
2. The worker boots, enrolls through enrollment v2, and connects to the relay.
3. The worker calls the team Node with its attempt token and pulls its seed: the logical task,
   project settings, plugin lock, team policy, and the needed cloud connections and secrets.
4. The worker installs the locked plugins, creates its task, and reports `setting-up`.
5. Clients adopt the worker. See [clients](./clients.md#adopting-a-worker).
6. The worker fetches the snapshot or revision, runs the project's setup script inside the task
   sandbox, and reports `ready`. An agent that needs missing files waits and says why.

## History transfer

The team Node keeps a durable copy of each cloud task's core and agent history. It must be readable
immediately after the worker is gone, without a restore.

- **What moves.** Task metadata changes, agent sessions and their normalized events, delegation
  reports, workflow run records the task owns, and artifacts that cannot be fetched again. Not
  plugin databases in general.
- **How.** The worker pushes batches to the team Node over its attempt token. Each event carries its
  per-session sequence number, which the agents plugin already persists. The team Node stores each
  batch and acknowledges the highest sequence it holds. The worker resends anything unacknowledged
  after a reconnect. Duplicates are dropped by sequence.
- **Artifacts.** The worker uploads an artifact to the regional bucket first, then sends its
  reference. The team Node acknowledges the reference only after it can read the object.
- **Checkpoint before teardown.** `stopping` waits until every event and artifact is acknowledged.

The agents plugin on the team Node needs an import path for sessions it did not run, and a read path
that renders them. That is an additive contract inside the agents plugin, not a shared database.

**Live reads.** While a worker is up, clients read live task data from the worker. After it is gone,
core and agent reads go to the team Node. The client picks based on the attempt's state, which the
team Node reports.

## Continuing a finished task

Continuing work creates a new attempt from the saved branch, a new snapshot, or the last archived
worktree. The new attempt's history appends to the same logical task. The client shows attempts in
order.

## Getting results out

A cloud task finishes with one or more of:

- A branch pushed to the repository, through the team's Git connection.
- A pull request, through the GitHub plugin on the worker.
- A patch the member downloads and applies to their local checkout with an explicit action.

acorn does not apply cloud changes to a local worktree automatically.

## Failures the design must handle

| Failure | What the person sees |
| --- | --- |
| Client disconnects mid-turn | Nothing breaks. The agent continues. On reconnect, the client refetches. |
| Worker crashes | The attempt is `failed`, with the last acknowledged history and a **Recover** action that starts a new attempt from the last pushed state. |
| Team Node restarts | Workers keep running and buffer history. Clients show the team Node offline briefly. |
| Relay restarts | Everything reconnects. Unacknowledged history is resent. |
| Provider create times out | The reservation stays. The retry finds the existing machine or creates it once. |
| Snapshot upload interrupted | The upload resumes or restarts. No worker is created until the snapshot is complete. |
| Archive write fails | The attempt stays `archiving`, the worker keeps running, spend continues, and the team is alerted. |

## Verify before building

Check how the agents plugin stores its per-session sequence and whether its events are
self-contained enough to render on a Node that did not run them. Check which task-scoped plugin
routes a pane calls, so the client knows which must go to the worker. Check how
`CoreServices.tasks.createChild()` handles reserved IDs, because attempts may reuse the pattern.
