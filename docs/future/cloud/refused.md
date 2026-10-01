# Alternatives not chosen for the first cloud release

Status: decisions from the cloud-task planning conversation, 2026-09-29. These are scope and
architecture choices, not claims that an alternative can never work. The
[architecture](./architecture.md) states the adopted design.

## No task database in the control plane

The control plane holds account, Node, placement, and billing metadata. A durable team Node owns
task content and history. Putting transcripts or repository bytes in the control plane would make
it a second product database and weaken the replaceable-control-plane boundary in
[architecture overview](../../architecture-overview.md#the-three-parties-and-what-a-control-plane-may-hold).
The relay carries encrypted bytes but cannot interpret them.

## No browser workspace in the first release

The web app administers teams, roles, billing, Node inventory, and plugin policy. Desktop and TUI
do the work. A browser workspace needs its own token custody, browser-valid TLS, and plugin UI
sandbox. [Remote access](../remote.md#web-client-what-changes-and-what-doesnt) records those costs.
The project and Node contracts must leave the future client possible.

## No execution-only worker for the first task Node

A full Node can run today's Node plugins and task APIs. Moving only processes and files to a worker
would require remote implementations of the plugin-facing filesystem, process, and task services.
The full Node creates an archival problem, which the team Node history transfer and encrypted
whole-root archive address. Reconsider a lighter worker after the first provider and archive costs
are measured.

## No Node switch for each cloud task

The task belongs to one logical shared project in desktop and TUI. Showing each worker as a
separate fleet workspace would expose an implementation detail and make project identity change
as workers are destroyed and recreated. The client may show the worker's state and Node details
inside the task.

## No separate physical plugin install per project

Plugins activate for a Node. The cloud design adds team and project selection, pinned versions,
and grants, then freezes a worker's effective lock. Per-project plugin databases and lifecycle
inside one Node would change the loader and every plugin's storage assumptions. Revisit only if
selection cannot isolate projects well enough.

## No mutable local plugin folders in hosted workers

A local folder install is a symlink without a stable package hash. Hosted workers use built-ins and
approved pinned packages; an author can package a folder first. A team admin's approval suffices
for a pinned package in the first release. Acorn may add a reviewed catalog later, but a catalog
listing must not imply that an unreviewed package was audited.

## No continuous local worktree synchronization

Starting a cloud task from local changes uses an explicit, reviewed snapshot. Automatic two-way
sync would need conflict resolution between live local edits, agent edits, and Git branches. A
cloud result returns through a branch, pull request, or patch, with a deliberate local apply step.

## No team roles on an owner's local Node

Local Nodes remain single-owner and account-free. The first relay flow lets the owner reach their
own private Node; it does not turn that Node into a shared team service. Hosted team and task Nodes
use the new role-aware grant path. An owner-controlled opt-in to share a local Node would need a
separate security and data-ownership design.

## No Fly Sprites as the initial region-bound provider

Sprites have an attractive sleep and filesystem model, but Fly support reported on September 11,
2026, that callers cannot choose or move a Sprite's region. The product requires a chosen region
for both worker compute and stored data. Fly Machines is the first provider to test, with Railway
VMs and other hosts kept as comparison candidates. Reconsider Sprites if placement support changes.
[Fly Sprites regional answer](https://community.fly.io/t/wheres-my-sprite-in-the-world/28621).

## No automatic account merge by email

GitHub is the first sign-in provider, but the Acorn user ID is independent of GitHub. A person
links another provider or password while signed in. A matching verified email alone does not
merge accounts. Better Auth must use `disableImplicitLinking: true` if selected for the account
service. [Better Auth account linking](https://better-auth.com/docs/concepts/users-accounts).

## No public address on a hosted Node

Phase 1 gives a self-hosted Node a public address as a stepping stone. From phase 4 on, team Nodes,
workers, and restore Nodes accept connections only through the relay. A public port on each worker
would widen the attack surface, churn addresses every few minutes, and give two reachability paths to
test instead of one. See [relay](./relay.md#why-every-hosted-node-uses-it).

## No enrollment v1 for hosted Nodes

Enrollment v1 hands the control plane a device token, which is full owner authority. The account
service already decides who holds grants, so a standing owner credential adds risk and buys nothing.
Hosted Nodes enroll through v2, which carries no device token. v1 stays unchanged for anyone else's
control plane. See [identity](./identity.md#what-the-enrollment-v2-change-is).

## No model key in the worker's environment

A key in the worker's environment is readable by every agent, terminal, and setup script, and it
undoes the sandbox programme's child environment policy. Workers use a credential-injecting proxy
where the harness allows, or a key scoped to the one agent process with its cost written down. See
[plugins and secrets](./plugins-and-secrets.md#model-keys).

## No relay that terminates TLS

A relay that decrypts could route smarter and cache, but a compromise would expose every team's
traffic, and clients would stop pinning Node certificates. The relay forwards TLS it cannot read.

## No provider token on a hosted Node

The team Node asks the provisioner for a worker. It never holds the compute provider's API token,
because that token can create and destroy machines for every team. See
[services](./services.md#service-to-service-authentication).

## No configuration copied from a laptop to a worker

A local project's scripts, trust acknowledgements, plugin databases, and connections stay local. A
shared project gets its own settings on the team Node, reviewed there. Copying executable
configuration to a hosted machine would bypass the project-row trust snapshot. See
[projects and tasks](./projects-and-tasks.md#shared-projects).

## Verify before building

Check whether the user requirements or shipped contracts have changed. A refusal overturned by
new evidence needs a revised threat model and an owning document update, not a quiet exception in
one implementation.
