# Threat model: what an agent reaches today

Part of [docs/future/sandbox/](./README.md). This file separates the two kinds of authority an agent
holds, because a sandbox fixes one and not the other, and confusing them leads to building the wall
before closing the door next to it.

## Two kinds of authority

**Ambient authority** is what the shell inherits because it runs as the user. **Deliberate
authority** is what acorn hands the agent on purpose so it can do its job. A microVM erases ambient
authority. It cannot erase deliberate authority, because deliberate authority travels over the
loopback API using a token that has to be inside the box.

Keep the two apart when reading the rest of this folder. [sandbox.md](./sandbox.md) is the ambient
story. [api-gates.md](./api-gates.md) is the deliberate one.

## Ambient authority: already careful, still wide

The child environment hygiene is better than most. `childEnv`
(`packages/node-core/src/server/taskEnv.ts:10`) is a nine-name allowlist, no parent spread, no
`SESSION_ENC_KEY`, no provider credentials. The process broker
(`packages/node-core/src/server/core/proc.ts`) refuses a bare `*` passthrough rather than trust
that no caller writes it. That is the part most systems get wrong, and acorn got it right.

But `HOME` is on the allowlist, and it has to be, because agent CLIs read their configuration from
it. So a task terminal is a real shell with the full user account behind it:

- `~/.ssh`, `~/.aws`, browser profiles, every credential file the user can read.
- Every other repository on the machine.
- acorn's own data root, including `core.sqlite` (workspaces, projects, tasks, audit, device rows)
  and every plugin's SQLite file.

The filesystem confinement policy (`packages/node-core/src/server/core/fs.ts`)
does not help here. It confines acorn's own file service, symlink-aware, against the data root and
worktree. It has no reach over a shell acorn spawned. A shell reads whatever the user can read.

This is exactly the shape a microVM with a bind-mounted worktree erases in one move. It is the
strongest single argument for the sandbox, and it is a real win.

## Deliberate authority: the loopback API

Every agent child receives `ACORN_API_URL` and `ACORN_API_TOKEN` in its environment
(`packages/node-core/src/mcp/api.ts:7`, and the same pair flows into terminal and workflow children).
It must: that is how MCP and agent tools reach the node. So the loopback API is reachable from inside
any sandbox, by design. A microVM does not change this.

The token is `task`-scoped. The mount table (`packages/node-core/src/server/index.ts`) is careful
about what a task token may reach. `pair`, `devices`, `plugins`, `audit`, `security`, `schedules`,
and `backup` each carry a `requireDevice` gate with a comment explaining why an agent must not reach
it. `integrations` carries `requireProviderAccess`. Task-addressed routes carry `requireTaskScope`,
which confines an internal token to the one task it was minted for (`mayActOnTask`,
`packages/node-core/src/server/middleware/requireUser.ts`).

The gaps are the core routes that are neither device-gated nor task-addressed, so a task token
reaches them with the machine owner's full identity. [api-gates.md](./api-gates.md) names them.

## What neither layer fixes

An agent working legitimately in a task can still read and transmit the repository it is working in,
and can still write subtly wrong code that a human then merges. Sandboxes buy host safety. They do
not buy data safety. Egress policy ([sandbox.md](./sandbox.md) § Egress) is most of the answer to the
first; review discipline is the only answer to the second. Say so plainly to anyone who asks whether
the sandbox "stops exfiltration." It stops the host-ranging kind, not the working-set kind.

## Assets, ranked

Borrowed from `docs/security.md` § Threat model, narrowed to the agent case:

1. **The project row.** Alongside identity it holds the per-project shell commands acorn executes
   (`setup_script`, `dev_script`, `teardown_script`, `db_url_script`) and every mapped codebase's
   local path. Writing it is host code execution. This is the highest-value target reachable over the
   API today.
2. **The tool ceiling.** The `agentTools.perms` slice is the control that removes sharp tools from an
   unattended agent. If the agent can rewrite it, the control is decorative.
3. **The data root on disk.** `core.sqlite` and plugin databases. Reachable by the shell (ambient),
   closed by the sandbox.
4. **Provider secrets.** Encrypted at rest, decrypted only in node memory through `SecretService.use`
   (`packages/node-core/src/server/core/secrets.ts`). Not in the child environment. The strongest asset
   already, and the model to copy, not fix.

Items 1 and 2 are API-reachable and are the subject of [api-gates.md](./api-gates.md). Item 3 is the
sandbox's job. Item 4 is already handled.
