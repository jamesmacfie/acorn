# Isolation inside a worker

Status: proposed, 2026-09-29; made self-contained on 2026-10-03 after retiring the local sandbox
proposal. This file owns cloud worker process isolation, team policy, and egress. Read the shipped
[security model](../../security.md) first.

## The short version

The provider's VM keeps one worker away from other workers and from the team Node. It does nothing
to keep an agent inside a worker away from that worker's own Node. On a worker, the agent, the
terminal, and the Node run on one machine, by default as one user. Without more isolation, an agent
can read the worker's data root, its signing keys, its attempt token, its relay credential, and any
secret in its environment. This is ambient authority inherited from the operating system, separate
from the deliberate authority Acorn grants through task-scoped APIs.

So a worker needs an isolated Linux execution target before anyone outside the building team uses
it. [Phase 7](./phases/07-isolation.md) builds it. This does not add isolation to local tasks.

## What an agent in a worker could reach

| Asset | Where it is | Reachable without isolation? | Fix |
| --- | --- | --- | --- |
| The worker's `core.sqlite` and plugin databases | Data root | Yes, same user | Separate user for task children, data root mode `0700` owned by the Node user. |
| `internal-token` signing key | Data root | Yes | Same. An agent that reads it can mint service-scoped tokens. |
| `session.key` | Data root | Yes | Same. Decrypts every connection the worker holds. |
| Attempt token | Node process environment or file | Yes, through `/proc` if same user | Hold in the Node process only, never in a file a child can read. Separate user. |
| Relay credential and service credential | Same | Yes | Same. |
| Model keys | Depends on [the model key option](./plugins-and-secrets.md#model-keys) | Option 2 or 3: yes | Option 1: the proxy. |
| Git token | Worker seed | Yes if written to a credential helper file | A credential helper that asks the Node, scoped to one repository, short-lived. |
| Other tasks | None | No, one task per worker | Nothing to do. |
| Other teams | Other VMs | No, provider isolation | Verify provider network isolation between teams. |
| The internet | Worker network | Yes | Egress policy, below. |

Deliberate authority is unchanged: agents still get `ACORN_API_URL` and a task-scoped
`ACORN_API_TOKEN`, and the [loopback-API gates](../../security.md#transport-and-auth) apply as they do locally.
An agent must not reach a grant, the attempt token, or any team-level route with that token.

## Worker execution boundary

The worker owns one task's checkout and execution environment:

- **Three chokepoints.** The process broker (`packages/node-core/src/server/core/proc.ts`), the PTY
  spawn (`plugins/terminal/src/server/terminal.ts`), and the managed-agent driver
  (`plugins/agents/src/server/drivers/jsonRpcProcess.ts`). A worker wraps the same three.
- **Execution target on the task.** A worker's single task requires an isolated target. The
  execution seam resolves the command, working directory, and environment and preserves streaming,
  PTY interaction, cancellation, and process cleanup. If isolation cannot start, execution fails
  closed rather than falling back to the Node user.
- **Direct mount.** The worktree is shared between the Node user and the task user. The editor,
  diff, search, and git read it as the Node user, unchanged.
- **The Linux backend.** Task children use a separate Unix user and mount namespace, with Landlock
  where available, or a container if the provider grants the required privileges.
- **Git access.** The task user must be able to read and write its checkout's Git metadata and run
  normal status, diff, branch, and commit commands. A linked worktree whose metadata is hidden in
  the protected Node data root is insufficient. The checkout layout must provide the task's Git
  metadata without exposing Node credentials or another task's repository.
- **Acorn tools and attachments.** Provide the authenticated task API, certificate trust, MCP
  launcher, and selected attachment files to task processes without granting access to the data
  root. Preserve managed-agent protocols and terminal reattachment.

Recommended minimum for a worker: task children run as a separate Unix user with no read access to
the data root, in their own mount namespace with the worktree, a private `/tmp`, and a read-only
view of the tools in the image. Landlock adds a second fence where the kernel supports it. A nested
container is heavier and needs more privileges than a provider VM usually grants.

The cloud execution and policy paths do not run on an ordinary local Node. A worker always has its
policy present, because the team Node delivers it.

## Team policy

The team Node delivers a managed policy in the worker seed. Merge most-restrictive-wins: a project
or task can narrow the team baseline but cannot widen it. Use a fixed struct, not a policy language:

- **Execution.** Require isolated task processes; no fallback to the Node user.
- **Egress.** The approved destinations for worker traffic.
- **Filesystem.** The checkout, its Git metadata, selected attachments, and explicitly approved
  additional paths. Node secrets remain inaccessible.
- **Tool tiers.** A ceiling applied with the owner's preferences and signed session ceiling.
- **Models.** The allowed providers and models.
- **MCP servers.** The approved server set, enforced across every supported harness launch path.
- **Audit destination.** An optional endpoint for audit export.

A resolved-policy view names what a task may do and which team, project, or task value decided it.
The resolver does not run on an ordinary local Node. Loaded-plugin isolation remains mandatory under
the shipped [plugin security contract](../../security/node-plugin-security.md); this policy adds no
weaker plugin mode.

## Egress

A worker needs to reach Git hosts, package registries, the model provider, and approved integration
endpoints. The team policy's egress list names them. A project can narrow that list; adding a
destination requires a team-admin change to the approved baseline.

Enforce egress at the worker's network boundary, not in the agent, and cover every path out: agent
processes, terminals, setup scripts, plugin node halves, and the Node itself. Browser tools, HTTP
requests, database connections, and provider calls must be included in that inventory. A rule on
task children alone does not cover requests made by Node services on their behalf.

Prefer the provider's network controls. If the provider VM cannot enforce the required policy,
evaluate these options:

1. The provider's own egress controls, if they exist per machine.
2. `nftables` rules set at boot, before the Node starts, by a root init step that then drops to the
   Node user. Rules resolve hostnames to addresses, which breaks for CDNs with rotating addresses.
3. A filtering forward proxy in the worker, with task children forced through it by the network
   namespace. This handles hostnames through TLS SNI or `CONNECT`, at the cost of acorn owning a
   proxy.

Which option ships is the largest open question in [phase 7](./phases/07-isolation.md#open-questions).
Record the chosen enforcement boundary and its bypass analysis in phase 7.

## Audit export

The core [audit table](../../security.md#audit) records security decisions but is not tamper-evident
against someone controlling its file. If a team requires external audit, export those rows to its
configured endpoint using OTLP, the OpenTelemetry Protocol. Add task-scoped tool-dispatch records
at the common invocation boundary, with bounded metadata and no credentials, prompts, or tool bodies.
Export failure needs an explicit delivery and retry policy. Customer audit export is outside the
closed alpha unless a team requires it; phase 7 records that decision.

## What isolation does not fix

An agent working legitimately in a task can read and send the repository it is working on, and it
can write subtly wrong code. Isolation protects the worker's secrets and the team's other data. It
does not make the working set confidential from the agent. Approved network destinations may still
provide a route for transmitting that working set, and isolation does not establish code correctness.

## The adversarial test

Phase 7 is not done until a deliberately hostile agent and a deliberately hostile loaded plugin,
running in a worker, fail to:

- Read any file in the data root outside the worktree.
- Read the attempt token, relay credential, service credential, or `session.key`.
- Mint an internal token, or reach a service-scoped or team-level route.
- Read a model key, when the proxy option is in use.
- Reach a host outside the egress list, from an agent, a terminal, a setup script, or a plugin.
- Reach another team's worker or team Node over any network.

Record each attempt and its result in the phase's evidence.

The same image must pass functional acceptance: agent Git status, diff, branch, and commit; Acorn
MCP calls; image and file attachments; terminal interaction and reattachment; development-server
previews; and Docker or database workflows when offered. Passing denial tests while breaking those
task operations does not satisfy phase 7.

## Verify before building

Check what privileges the chosen provider's VM grants: user namespaces, Landlock support in its
kernel, and whether a root init step can run before the Node. Verify the checkout and Git metadata
layout, task API connectivity, and the functional acceptance paths before choosing the execution
backend. [Phase 7](./phases/07-isolation.md) owns the implementation sequence.
