# Architecture for cloud tasks

Status: proposed, 2026-09-29. This is the intended design and its feasibility gates, not a
description of shipped behavior. [The work plan](./work-plan.md) orders implementation. The
[refusals](./refused.md) record alternatives.

## Current system and the change it needs

The client connects to independent Nodes. A Node owns its projects, tasks, plugin databases,
worktrees, agent ledger, and device tokens. The desktop helper holds paired-Node credentials and
certificate pins; TUI has its own custody. Client query keys and cache entries include the Node ID.
The Node serves one authenticated HTTP API and WebSocket, with no web assets. See
[architecture overview](../../architecture-overview.md), [state ownership](../../state-ownership.md),
and [API reference](../../api-reference.md).

The preparation work is real. A loaded plugin can contribute a Node provider through
`ctx.providers.nodes`; `GET /v1/core/nodes` lists its Nodes, and the host adopts one only after
checking the provider's fingerprint. A provisioned Node can enroll at first boot. Neither seam
supplies a relay, a team identity, or a project shared across Nodes. The current project ID belongs
to one Node, and each paired device has full owner authority. See [Node providers](../../plugins/node-side-extension-points.md#node-providers),
[Node enrollment](../../node-enrollment.md), [workspaces and tasks](../../workspaces-and-tasks.md),
and [authentication](../../authentication.md).

The design must preserve local, account-free Acorn. Cloud membership adds a new authority path to
hosted Nodes; it does not silently change the authority of a local Node or the meaning of an old
device token.

## Runtimes and trust boundaries

| Runtime | Owns | Does not own |
| --- | --- | --- |
| Desktop or TUI | Presentation, local drafts and caches, Node pins, and client credentials. | The authoritative copy of a cloud task. |
| Account and control plane | Users, team membership, Node inventory and placement, enrollment records, region choice, billing, and usage totals. | Code, prompts, transcripts, plugin databases, and task history. |
| Relay | Short-lived connection routing and traffic metering. | Decrypted Node requests or task data. |
| Durable team Node | Shared project IDs, task index, immediate core and agent history, plugin policy, archive manifests, and task authorization. | A running task worktree after its worker is removed. |
| Full task Node | A task checkout, selected plugin runtime and storage, terminals, agent processes, and live task APIs. | Team membership or the canonical shared-project ID. |
| Regional archive store | Encrypted worker-root archives, local-upload snapshots during task life, and durable artifacts under the team Node's authority. | Account sessions or a queryable task database. |

The control plane and relay may share deployment infrastructure, but they remain separate services
and permissions. Node-to-client application frames stay encrypted and authenticated end to end;
the relay sees routing identifiers, connection duration, and byte counts. The team Node can read
task content because it owns the team's work. The control plane cannot acquire that access merely
by listing a Node.

Each team starts with one durable Node in its chosen region. A shared project has an opaque team
project ID minted there. A local Node keeps its own project ID and an explicit mapping to the team
ID after publication. Repository URLs and Git provider IDs are facets, not the shared identity:
several checkouts or forks may map to one project, and a local snapshot need not be a clean Git
commit. Local-only projects remain absent from the team Node.

A cloud task has one stable logical task ID on the team Node and one or more worker attempts. Each
attempt records a worker Node ID, its own task ID, region, plugin-lock digest, source snapshot or Git
revision, archive ID, and lifecycle state. This mapping is server-owned. The client shows one task
under the shared project, with its cloud location and worker state. While active, task routes and
streams go to the pinned worker. After teardown, core and agent reads go to the team Node. A later
run gets a new worker attempt under the same logical task; it never reuses a deleted Node ID.

The team Node's task index is a deliberately new read model. It must not pretend that copying a row
from one Node's `tasks` table makes every plugin's private data available there. Cross-Node identity
and route selection need additive, versioned protocol types in `@acorn/protocol`; old local Nodes
remain usable through the existing routes.

## Relationship to per-task sandboxing

The [sandbox programme](../sandbox/README.md) isolates child processes for tasks on a persistent
local Node; the host Node continues to own files, plugin databases, and the task UI. This proposal
puts each ephemeral cloud task in a full Node so the existing Node API and plugin runtime can move
with it. A provider VM isolates that worker from other workers and the durable team Node. It does
not, by itself, keep an agent process inside the worker from reading the worker Node's own files,
environment, or credentials. Before production, prove the worker's agent-to-Node boundary and add
process isolation if the provider VM alone leaves secrets or administrative authority in reach.

Both paths need the same task-scoped API gates, plugin permission checks, tool ceilings, and policy
vocabulary. The sandbox programme's managed policy describes what a task may execute and reach;
the cloud account service owns membership, placement, and billing. Resolve execution and egress
policy on the Node that runs the task, using team and project restrictions for hosted tasks. Keep
the absent-policy fast path for personal local Nodes. Enforce cloud egress at the worker network
boundary, including plugin and Node-originated traffic that an agent sandbox might not cover.

## Task lifecycle and data flow

1. A member explicitly publishes a local project to a team or selects an existing shared project.
   Acorn shows the team name, the people who can read the work, and the selected region. The client
   stores the local-to-team project mapping only after the team Node acknowledges it.
2. The member creates a task and selects local or cloud execution, with a project default. For a
   local checkout, the client previews the tracked changes and selected untracked files to upload.
   It sends one immutable snapshot, with size and file limits, to the team Node's regional storage.
   A Git-only task instead records its repository and revision. The snapshot remains until the task
   result is secured, then a cleanup job removes it after a documented grace period.
3. The team Node reserves a logical task ID, worker-attempt ID, region, budget, and exact plugin
   lock before calling the provisioner. The control plane records only a placement handle and
   provisioning state. Retry uses the same reservation, so an ambiguous create cannot bill for two
   workers. The task Node boots from a prebuilt image, enrolls, receives the task seed, and loads
   the approved plugin packages. It may finish repository or dependency setup after its UI becomes
   available; the task shows that work explicitly and blocks an agent that needs missing files.
4. Desktop and TUI adopt the worker through the existing pinned-Node custody path, extended for
   relay endpoints. A team-scoped authorization grant identifies the person and role. The worker
   owns live files, terminal sessions, agent processes, plugin routes, and its WebSocket. The team
   Node records the task's durable core and agent events in order and copies non-refetchable
   artifacts into regional storage before acknowledging their references. Event sequence and
   idempotency keys let it recover after either Node or the relay disconnects.
5. An agent continues when the client disconnects. A known role revocation closes that person's
   live sockets. A worker failure leaves a failed attempt under the logical task, with the last
   acknowledged history and a visible recovery action. Acorn never labels an unacknowledged
   archive as complete.
6. A worker with no running agent, pending live process, or interactive use has a five-minute idle
   window, whether or not the logical task is finished. A run waiting for a human response remains
   active until the runtime can checkpoint and resume it safely. The team Node blocks new work,
   drains live processes, waits for its history checkpoint,
   captures a consistent whole-root archive, verifies its manifest and object hashes, and only
   then destroys compute. A failure at any step keeps the attempt visible and retryable. Hard
   budget limits stop new work, request a graceful agent stop, and run the same preservation path.
7. Core task and agent history remain readable from the team Node. For other plugin details, the
   client requests on-demand restoration of the encrypted worker root into a new, isolated Node.
   Continuing work likewise creates a new attempt from the saved Git branch or input snapshot and
   links its run to the same logical task. A restored Node must rotate its Node identity, device
   credentials, and session keys before accepting a client.

The existing backup route is a precedent for consistent SQLite snapshots, not the cloud archive
format. It omits blobs and worktrees and removes credential material. A whole-root archive needs
the plugin databases, plugin packages, task files, non-refetchable blobs, a format version, a
content manifest, encryption, and a restore procedure that does not revive old credentials. Plugin
database files stay opaque to the team Node. The team Node stores only the core and agent
projections it has an explicit contract to read. See [backup and import](../../data-layer.md#backup-and-import).

## Plugins and project policy

Plugins install and activate for a Node today. Project policy is an additional selection rule,
not a separate physical install or a hidden change to that Node-wide lifecycle. A team admin
approves a pinned package hash, its Node grants, and the projects where it can run. A team baseline
applies to every shared project; a project may add or disable approved packages and pin a different
approved version. The effective lock is frozen per worker attempt and shown before launch.

The first sync accepts built-ins and hash-pinned GitHub, npm, or tarball installs from local Acorn.
A folder symlink or development grant has no immutable package to verify and must be packaged first.
The worker installs the frozen set and runs the same manifest validation and permission-scoped
plugin loader as a local Node. The client's existing exact-hash trust decision still governs its
client bundle; team approval does not silently trust JavaScript on every person's device. A
missing or incompatible plugin blocks launch with its ID and reason instead of silently running a
different tool set. A later web catalog can offer approved packages using this policy. Acorn does
not need a platform-wide allowlist for the first release.

Syncing a package does not sync a local Node's integration credentials, plugin database, or private
preferences. The team Node must hold cloud-specific connections and settings for every plugin the
project selects. An eligible plugin either works with those settings or declares a provisioning
step that the owner can review. The launch check names missing configuration before spending on a
worker. Do not copy a local plugin database into a worker as an implicit configuration mechanism.

The task Node owns plugin databases while running. Its whole-root archive retains plugin data even
when no plugin-specific export exists. The team Node does not merge those databases into its own.
This preserves the plugin storage boundary, but it also means detailed views from a removed worker
have a restore delay. Surface that state in desktop and TUI.

## Identity, authority, and secrets

The account service should use an account ID unrelated to an OAuth provider's user ID. Better Auth
is the leading library for its Hono integration, Drizzle adapter, organization membership, explicit
account linking, and session management. Configure `disableImplicitLinking: true`: matching verified
email alone must not merge accounts. GitHub sign in is the launch method. The schema and UI must
leave room for another OAuth provider, email/password, recovery, and Acorn-managed two-factor
authentication. Better Auth's two-factor plugin does not gate OAuth sign in by default, so a later
Acorn-wide second factor requires a separate enforced step before issuing a Node grant.
[Better Auth Hono integration](https://better-auth.com/docs/integrations/hono),
[account linking](https://better-auth.com/docs/concepts/users-accounts),
[two-factor behavior](https://better-auth.com/docs/plugins/2fa).

The administration web app uses an HTTP-only account session and never holds a worker's full-owner
device token. The account service verifies membership and issues a short-lived, audience-bound
grant for a named team Node or task Node. The Node validates the grant, resolves the member's role,
and enforces it on HTTP routes, WebSocket subscriptions, plugin bridges, and tool actions. Admins
manage members, plugin grants, secrets, and billing; members create and edit tasks, spend the team
budget, and answer agent requests; viewers read code, transcripts, and artifacts but cannot mutate,
approve, or run work. The client cannot widen its role by choosing a different worker endpoint.

The current device-only gate treats every paired device as an owner, and plugin routes do not all
declare whether a call reads or mutates. Cloud role enforcement therefore needs a server-side
permission classification for core and plugin routes and actions. Deny an unclassified plugin
action to a viewer by default. Audit first-party plugin routes before claiming the viewer role is
read only; hiding a button in the client is insufficient.

The Node must accept a pushed revocation and close affected sockets immediately when the account
service is reachable. During an outage, an already authorized session may continue for at most five
minutes from its last verified membership state. New sign in, provisioning, or a session past that
window fails closed. A revocation made during the outage cannot reach the Node until connectivity
returns; the UI and audit trail must state this limit. Local Nodes keep the present device-token
model. The enrollment-v1 contract remains readable, but a hosted team Node needs an additive,
versioned enrollment and grant path that does not hand the control plane an unrestricted owner token.

Teams supply model keys. The team Node stores them as secrets and injects only the selected task's
needed values into its worker environment for compatibility with CLI harnesses. A worker process
can read an injected value; the design must name that trust cost. Limit each grant's scope where the
provider permits it, omit unrelated secrets, and keep injected values out of files where possible.
A worker environment is not automatically a child-process environment: the existing sandbox
[child-env policy](../sandbox/threat-model.md) deliberately withholds provider credentials from
task children. A cloud CLI harness that needs a model key requires an explicit, task-scoped
credential path and a threat-model review; do not broaden all child environments by default.
A whole-root archive can still contain a secret written by an agent or plugin, so encrypt and
restrict it as sensitive task data. Revoke or rotate a compromised secret. The task Node's
restricted egress policy allows required Git, package, model, and approved integration endpoints;
a team admin can widen it per project.

## Reachability and the future browser client

A private Node opens an outbound connection to the relay. Desktop and TUI authenticate and open
their own outbound connection. The broker still pins the Node's certificate and holds its token or
scoped grant; the relay cannot substitute another Node or read an application frame. Pairing and
relay enrollment need replay protection, bounded connection lifetimes, and a visible detach action.
The first release supports a person's remote access to their own local Node. It does not grant team
members access to that Node.

The web app manages the account and infrastructure only. It does not fetch transcripts or proxy
Node APIs. A future browser workspace can add a browser custody implementation and Node web
sessions while retaining the same project and task identities. It will need browser-valid TLS,
session and CSRF protection, and a deliberate plugin UI sandbox, as
[remote access](../remote.md#web-client-what-changes-and-what-doesnt) explains. None of those are a
reason to move task content into the control plane.

## Hosting, cost, scale, and speed

The first release uses one worker provider behind a small provision, inspect, meter, and destroy
interface. The provider experiment in [the work plan](./work-plan.md#phase-0-prove-the-hard-boundaries)
must prove placement and lifecycle behavior before a production selection. Fly Machines is the
leading candidate: it supports explicit regional placement and deployable images. Fly Sprites offer
fast sleep and persistent filesystems, but Fly support reported on September 11, 2026, that a caller
cannot choose or move a Sprite's region. That fails the requirement to place both a worker and its
archive in the team's selected region. Railway lists regional services, but its VM primitive is
beta. Vercel Sandbox has a 24-hour continuous-session limit on paid plans and needs a restore path
for longer work. These are dated provider facts, not a permanent ranking.
[Fly Machines](https://www.fly.io/docs/mcp/deploy-on/fly-machine/),
[Fly Sprites regional answer](https://community.fly.io/t/wheres-my-sprite-in-the-world/28621),
[Railway VM pricing and status](https://docs.railway.com/pricing/plans),
[Vercel Sandbox duration](https://vercel.com/kb/guide/vercel-sandbox-duration-and-persistence).

The team chooses one supported US, EU, or APAC region. The team Node, worker, temporary upload,
artifact, and worker archive remain there. A region move is a separate migration; the UI must not
claim that changing a preference moves existing data. Start with one team Node per team, limits on
concurrent workers and worker runtime, and provider capacity alarms. The control plane and relay can
scale independently because neither stores the authoritative task ledger. Measure the first design
against tens of teams and hundreds of simultaneous workers before adding sharding.

The warm path target is 15 seconds from **Run in cloud** to an authenticated task Node with its
project and selected plugin roster visible. Repository checkout, dependency install, and setup can
continue with visible progress; an agent waits for files it requires. Cold setup in a new region or
with a newly approved package may exceed the target and must show what it is doing. Prebuilt Node
images, a bounded warm pool per region, an exact-hash package cache, and a team-scoped repository
cache are candidates to measure. Never share private repository bytes across teams merely to hit
the target. Idle workers are archived after five minutes; a terminal or agent that is actively
working is not idle.

The monthly base plan pays for the team Node and account service. Meter worker CPU and memory,
archive and artifact storage, temporary snapshots, and relay transfer separately; model use is
paid through team-supplied provider keys. Before launch, publish an estimate for a proposed run,
current usage, and a team hard budget. The admission controller reserves estimated spend and a
concurrency slot before provisioning, reconciles actual usage after the provider reports it, and
refuses work that would cross the cap. An active run reaching its cap takes the graceful stop and
archive path. An admin can change future limits; no client may bypass a stopped team budget.
Recheck provider rates from [Fly pricing](https://fly.io/pricing/) and
[Railway pricing](https://docs.railway.com/pricing) when the experiment produces a workload trace.

## Failure and operations contract

The task state machine must distinguish reserved, provisioning, setting up, ready, running,
stopping, archiving, archived, restoring, and failed attempts. Each external operation has a stable
idempotency key and a reconciliation loop. Archive confirmation is a prerequisite for destroy;
destroy is never inferred from a timed-out API call. The client shows partial history and the last
known worker state during an outage, without claiming a mutation succeeded from cached data.

Back up the durable team Node and test restore in its region. Encrypt archives with keys scoped to
the team, audit access and deletion, and track bytes held until an authorized team member deletes
the task or archive. Keep account billing rows out of the Node backup and task bytes out of control
plane logs. Record provisioning duration, failure class, worker activity, archive lag, restore time,
relay connection health, regional placement, and provider charges without logging code or prompts.
Capacity, storage, and spend limits must fail admission visibly before starting an unfinishable
task.

## Verify before building

Check whether the provider can provision an isolated, region-pinned machine from the chosen Node
image inside the warm-path target. Check whether a complete encrypted root archive can restore
plugin databases, blobs, and files while replacing Node credentials. Check the current protocol's
host, TLS, WebSocket, and plugin bridge assumptions against a relayed endpoint. Check each client
surface promised in [the work plan](./work-plan.md) against a real remote Node. Measure provider
usage and archive size from a representative project before setting plan prices or quotas.
