# Isolation inside a worker

Status: proposed, 2026-09-29. This file applies the [sandbox programme](../sandbox/README.md) to
cloud workers. Read the sandbox [threat model](../sandbox/threat-model.md) first. Its split between
ambient and deliberate authority is the frame for everything here.

## The short version

The provider's VM keeps one worker away from other workers and from the team Node. It does nothing
to keep an agent inside a worker away from that worker's own Node. On a worker, the agent, the
terminal, and the Node run on one machine, by default as one user. Without more isolation, an agent
can read the worker's data root, its signing keys, its attempt token, its relay credential, and any
secret in its environment. That is the same ambient-authority problem the sandbox programme solves
on a laptop, on Linux, with higher stakes because the secrets belong to a team.

So a worker needs the sandbox programme's execution target, with a Linux backend, before anyone
outside the building team uses it. [Phase 7](./phases/07-isolation.md) builds it.

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
`ACORN_API_TOKEN`, and the [loopback-API gates](../sandbox/api-gates.md) apply as they do locally.
An agent must not reach a grant, the attempt token, or any team-level route with that token.

## Reusing the sandbox design

The sandbox programme's design fits a worker almost exactly:

- **Three chokepoints.** The process broker (`packages/node-core/src/server/core/proc.ts`), the PTY
  spawn (`plugins/terminal/src/server/terminal.ts`), and the managed-agent driver
  (`plugins/agents/src/server/drivers/jsonRpcProcess.ts`). A worker wraps the same three.
- **Execution target on the task.** A worker's single task always has a sandboxed target. The
  resolver maps it to a `(command, cwd, env)` transform, as [sandbox.md](../sandbox/sandbox.md#execution-target-on-the-task)
  describes.
- **Direct mount.** The worktree is shared between the Node user and the task user. The editor,
  diff, search, and git read it as the Node user, unchanged.
- **The Linux backend.** Docker Sandboxes do not run on Linux, so the sandbox programme already
  plans a second backend with Landlock and namespaces, or a container. In a worker, that is the
  only backend needed.

Recommended minimum for a worker: task children run as a separate Unix user with no read access to
the data root, in their own mount namespace with the worktree, a private `/tmp`, and a read-only
view of the tools in the image. Landlock adds a second fence where the kernel supports it. A nested
container is heavier and needs more privileges than a provider VM usually grants.

The absent-means-off rule still holds: a local Node with no sandbox configured runs exactly as today.
A worker always has its policy present, because the team Node delivers it.

## Team policy is the managed layer

The sandbox programme's [enterprise policy](../sandbox/enterprise-policy.md) defines a managed
configuration layer, merged most-restrictive-wins, with a fixed vocabulary: execution target, egress,
filesystem, tool tiers, model allowlist, MCP servers, and telemetry sink. On a laptop, MDM delivers
it. On a worker, the team Node delivers it in the seed.

Use the same vocabulary and the same resolver. A team admin sets the team policy, a project can
narrow it, and the worker cannot widen either. This makes the cloud product the first real consumer
of the managed layer, which is a reason to build sandbox phase 4 as part of, or just before, cloud
phase 7.

## Egress

A worker needs to reach Git hosts, package registries, the model provider, and approved integration
endpoints. The team policy's egress list names them. A team admin can widen it per project.

Enforce egress at the worker's network boundary, not in the agent, and cover every path out: agent
processes, terminals, setup scripts, plugin node halves, and the Node itself. The sandbox research
has the lesson: a deny rule that one path bypasses is worse than none, because people trust it
([sandbox research](../sandbox/research.md#where-controls-bite)).

The sandbox programme refused an egress proxy of acorn's own because `sbx` already enforces network
policy. A provider VM may not. Options:

1. The provider's own egress controls, if they exist per machine.
2. `nftables` rules set at boot, before the Node starts, by a root init step that then drops to the
   Node user. Rules resolve hostnames to addresses, which breaks for CDNs with rotating addresses.
3. A filtering forward proxy in the worker, with task children forced through it by the network
   namespace. This handles hostnames through TLS SNI or `CONNECT`, at the cost of acorn owning a
   proxy.

Which option ships is the largest open question in [phase 7](./phases/07-isolation.md#open-questions).
If option 3 wins, update the sandbox programme's refusal with the reason.

## What isolation does not fix

An agent working legitimately in a task can read and send the repository it is working on, and it
can write subtly wrong code. Isolation protects the worker's secrets and the team's other data. It
does not make the working set confidential from the agent. Say so to anyone who asks whether cloud
tasks stop exfiltration ([threat model](../sandbox/threat-model.md#what-neither-layer-fixes)).

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

## Verify before building

Check what privileges the chosen provider's VM grants: user namespaces, Landlock support in its
kernel, and whether a root init step can run before the Node. Check the sandbox programme's
[phases](../sandbox/phases.md) for progress on the execution target seam before starting, so the
two programmes build one seam.
