# Phase 5: shared projects and one person's cloud task

Status: proposed, 2026-09-29.

## Goal

Publish a local project to a team, run a task for it on a worker, use that task from desktop and TUI,
and keep its core and agent history on the team Node. This is the core of the product, built for one
person, on the target architecture.

## What you can deploy at the end

On staging, a member of a single-person team publishes a project, chooses **Cloud** in the new-task
flow from a Git revision or a snapshot, and gets a worker in the team's region. They run an agent,
open terminals, read the diff, and push a branch or open a pull request. They close the laptop and
pick up in the TUI. When they are done, they choose **Stop and delete**. The transcript stays
readable from the team Node.

Internal use only. Workers in this phase are not hardened, and teardown discards plugin detail
beyond core and agent history. Phases 6 and 7 fix both.

## Starting point

- Team Nodes behind the relay from [phase 4](./04-relay.md).
- The design in [projects and tasks](../projects-and-tasks.md) and [clients](../clients.md).
- The task model in [workspaces and tasks](../../../workspaces-and-tasks.md).
- The agents plugin's durable per-session event sequence.

## In scope

- Team project IDs, the local-to-team mapping, and execution location on a task.
- The attempt record, its state machine up to `running`, and manual stop.
- Worker mode in the Node: the attempt token, seed pull, and enrollment v2 as a worker.
- Git revision and snapshot inputs, and the regional bucket.
- Client adoption of workers and task-scoped routing.
- History transfer to the team Node.
- Results: branch, pull request, and patch.
- Built-in plugins only.
- Guard limits: a fixed concurrent-worker cap and maximum runtime per team.

## Out of scope

Automatic teardown, archives, and restore, which are [phase 6](./06-archive.md). Task sandboxing,
brokered model keys, and egress, which are [phase 7](./07-isolation.md). Loaded plugins, which are
[phase 8](./08-plugins.md). Budgets and estimates, which are [phase 10](./10-billing.md).

**Named shortcut.** The model key is a team secret injected into the agent process's environment,
option 2 in [plugins and secrets](../plugins-and-secrets.md#model-keys). Acceptable for the building
team's own keys on staging. Phase 7 replaces it where a harness allows.

## Steps and checkpoints

### 1. Spike: task-scoped routing in the client

Before any other step, find out how much of `@acorn/client-core` assumes a pane talks to the active
Node. Build the smallest version of a hidden worker fleet member and route one pane, the agent
transcript, to it. Decide between direct adoption and routing through the team Node. See
[clients](../clients.md#adopting-a-worker). Record the decision and the reason here.

### 2. Protocol types

Add, in `@acorn/protocol`: team project ID, the local mapping, execution location, the attempt record
with its states, and the team Node's cloud task routes. Additive only. Write the routes and
idempotency keys at the top of this file before implementing.

### 3. Publish a project

**Checkpoint 1: publish.** Publish a local project to the team. The dialog names the team, the one
member, and the region. The project shows a team marker. The team Node's projects list holds the
shared project. Local tasks still show under it, and a second local project that was not published
is absent from the team Node.

### 4. The orchestrator and worker mode

On the team Node, build reserve, provision through the provisioner, state tracking, and
reconciliation. In the Node, add worker mode: enroll as a worker, connect to the relay, pull the
seed with the attempt token, create the task, report state.

**Checkpoint 2: a worker from a Git revision, locally.** In the local stack, choose **Cloud** and a
branch of a public repository. The task appears in the rail at `reserved`, moves through
`provisioning` and `setting-up`, and reaches `ready`. A worker container is running.

**Checkpoint 3: no double worker.** Kill the team Node while an attempt is `provisioning`. Restart it.
The attempt should resume with the same worker, and only one worker container should exist.

### 5. Git access

Give workers a Git credential through a cloud connection on the team Node: a GitHub App installation
token or a person's OAuth token, per the decision below.

**Checkpoint 4: private repository.** Run a cloud task from a private repository. The worker checks
it out.

### 6. Snapshots

Build the snapshot preview in the client, the upload to the team Node, storage in the regional bucket,
and the worker's fetch. Use MinIO in the local stack.

**Checkpoint 5: uncommitted work goes up.** In a local checkout, edit a tracked file and create an
untracked one. Start a cloud task from a snapshot. The preview lists both, with sizes, and marks a
`.env` file as unselected with a warning. After launch, the worker's checkout contains both changes.

**Checkpoint 6: interrupted upload.** Drop the network halfway through a large snapshot upload. No
worker should start. When the network returns, the upload resumes or restarts, then the worker starts.

### 7. Use the task

Wire panes to the worker through task-scoped routing: agent, terminal, editor, changes, notes, and
the preview tunnel.

**Checkpoint 7: real work in the cloud.** Run a Claude agent on the cloud task. Open a terminal and
run the tests. Read the diff. Open a dev server preview through the tunnel.

**Checkpoint 8: switch clients mid-turn.** Start a long agent turn from the desktop. Close the laptop.
On another machine, open the TUI, sign in, and open the same task. The turn should be in progress or
finished, with no gap. If the agent asks a question, answer it from the TUI.

### 8. History transfer

The worker pushes core and agent events and artifacts to the team Node with sequence numbers. The
team Node acknowledges, and the agents plugin on the team Node renders the imported sessions.

**Checkpoint 9: the transcript outlives the worker.** Kill the worker container without warning. The
task shows `failed` with a **Recover** action. The transcript is readable from the team Node, up to
the last acknowledged event.

**Checkpoint 10: no duplicates after reconnects.** Restart the relay three times during an agent turn.
The team Node's copy of the transcript should match the worker's event for event.

### 9. Results and stop

Add **Push branch**, **Open pull request**, and **Download patch**. Add **Stop and delete**, with a
confirmation that says plugin detail beyond the transcript is discarded.

**Checkpoint 11: a pull request from the cloud.** From a cloud task, open a pull request. It appears
on GitHub from the team's credential. Download the patch and apply it to a local checkout.

**Checkpoint 12: stop and delete.** Stop the task. The worker is destroyed, the provider shows no
machine, and the transcript is still readable.

### 10. Staging

Deploy with the real provider and a regional bucket.

**Checkpoint 13: staging, from both clients.** Repeat checkpoints 5, 7, 8, and 11 on staging.

## Acceptance

- Restart the client, team Node, relay, and worker at different points without a duplicate worker or
  lost acknowledged history.
- Repeat with a failed built-in plugin, an interrupted upload, and a worker killed mid-turn.
- A local Node with no cloud plugin behaves exactly as before.
- Guard limits refuse a third concurrent worker, or whatever the cap is, with a clear message.

## Docs to update when it ships

- [workspaces and tasks](../../../workspaces-and-tasks.md): shared projects and execution location.
- [state ownership](../../../state-ownership.md): what the team Node owns for a cloud task.
- [API reference](../../../api-reference.md): cloud task routes.
- The agents plugin's documentation: imported sessions.

## Open questions

1. Direct worker adoption, or routing through the team Node? The spike decides.
2. GitHub App or personal OAuth token for worker Git access first?
3. Snapshot format: a Git bundle plus patch, or a tarball of changed files over a base commit?
4. Snapshot limits: total size, file count, and single file size.
5. What machine size does a worker use, and can a project choose a larger one?
6. Which built-in plugins work on a worker? Docker has no daemon there, and the browser plugin needs
   a display. Each needs an explicit unavailable state.
7. Where does a shared project's setup script come from, and who acknowledges its trust on the team
   Node?
8. How does a project provide secrets like a `.env` file to a worker? As team secrets written into
   the worktree, or as environment variables?
9. Which records count as core history: task metadata, notes, memory, findings, workflow runs? Each
   plugin that is not transferred loses its data at **Stop and delete** until phase 6.
10. What do the guard limits start at?
11. How does a deep link to a cloud task look, given the logical task ID lives on the team Node and
    the live data on a worker?
12. What happens to a local task if someone publishes its project later? Does it stay local, or can
    it move to the cloud?

## Evidence

Record the routing spike's result, setup times, and any failures here, with dates.

## Verify before building

Check how panes get their Node today, how the agents plugin stores and renders events, and whether
`CoreServices.tasks.createChild()` reservation can serve as the model for attempt reservation.
