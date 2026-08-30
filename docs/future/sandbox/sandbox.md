# Per-task OS isolation

Part of [docs/future/sandbox/](./README.md). This is the design for running a task's execution inside
an OS sandbox — one sandbox per task — so an agent cannot reach the host beyond its worktree. It fixes
the ambient authority described in [threat-model.md](./threat-model.md); it does not fix the loopback
API, which [api-gates.md](./api-gates.md) handles and which must land first.

## The shape

One sandbox per task. The node stays on the host. Only execution crosses the boundary. The worktree
is bind-mounted into the sandbox at the same absolute path, so the files are shared and the agent
genuinely works on the real code, while everything else inside the sandbox is its own.

The alternative — running a whole acorn node inside each sandbox — is architecturally tidier, because
the node already owns PTYs and exec. Reject it. A node's unit is a machine, not a task: you would get
one SQLite database, one plugin reconciliation, and one pairing dance per task, a fleet list full of
fake machines, and a microVM boot on the path of an action that today costs a `git worktree add`. The
per-task-execution shape keeps the node where it is and moves only the children.

## The three chokepoints

There are exactly three places a task's code runs, and they are few on purpose. The
`node:child_process` importers are enumerated and asserted in `tools/arch/boundaries.test.ts:217`;
that list is the migration checklist, already written and already test-enforced. The three that
matter for task execution:

1. The process broker — `packages/node-core/src/server/core/proc.ts`. Every bounded task command.
2. The PTY spawn — `plugins/terminal/src/main/terminal.ts:411`. Shells and agent profiles.
3. The managed-agent driver — `plugins/agents/src/main/drivers/jsonRpcProcess.ts:64`. One process
   per agent session.

Everything else that touches a task — the editor, the diff, find-in-files, git, dashboards, notes —
reads the worktree through the filesystem. With direct mount at the same absolute path, none of it
changes. That is the property that makes this worth doing in acorn specifically: a harness that ships
the repo into a container loses the editor, the diff, and the search. acorn does not, because only the
running process moves.

## Execution target on the task

Today "where does this run" is implicit and the answer is always "here." It becomes a resolved value
on the task: `host`, or a sandbox id. Both the broker and the PTY spawn already take an absolute
worktree cwd, so the change is a command wrapper both honour: `host` runs the command as now; a
sandbox target runs it through the sandbox's exec (for Docker Sandboxes, `sbx exec`) against the same
cwd.

This is the one place in the folder that earns an abstraction up front, because there are genuinely
two backends from day one, not one imagined one:

- **Docker Sandboxes (`sbx`)** on macOS and Windows. microVM per task, own kernel, own daemon, own
  network. See [research.md](./research.md) § Docker Sandboxes for the command surface.
- **A Linux backend** — Landlock plus namespaces, or a plain container — for standalone nodes on
  Linux, where `sbx` does not run.

Keep the seam narrow: a resolver that maps an execution target to a `(command, cwd, env)` transform,
and nothing more. No provider registry until a third backend exists.

## What breaks, and the fix

- **Clone mode is out.** `sbx --clone` cannot be used from a git worktree other than the main one
  (see [research.md](./research.md)). Every acorn task is a worktree, so direct mount is the only
  option. That is fine: direct mount is what keeps the editor and diff working. It does mean the agent
  can still write the checkout, which is the intent.
- **Preview and dev servers.** A server inside the sandbox needs a published port (`sbx --publish`),
  so acorn must allocate and track a host port per task instead of assuming `pnpm dev` on a known
  port. This touches the preview capture and the run-target surface.
- **The Docker plugin goes blind.** Each sandbox has its own daemon. The task pane matches containers
  by compose project and worktree against the host daemon (`plugins/docker/src/main/dockerService.ts`)
  and would find nothing inside a sandbox. The broker's `DOCKER_HOST` passthrough is the hook; the
  plugin has to become sandbox-aware. See `docs/docker.md` for the current matcher.
- **The HTTP client pane.** It sends requests from the node today (`plugins/http/src/server/send.ts`).
  Under a locked-down task that is an egress bypass, the exact class of hole OpenAI documents in its
  own proxy (see [research.md](./research.md)). Move the send inside the sandbox when the task has a
  non-host execution target.
- **Platform.** macOS and Windows for `sbx`; Linux needs the second backend. This is a capability the
  task advertises, not an assumption. A node with no sandbox backend available reports the task's
  execution target as `host` and says so, the way `docs/docker.md` describes the unavailable state.

## What survives untouched

The editor, the diff renderer, find-in-files, git operations, dashboards, notes, the task rail, and
every read of the worktree. This is the list to protect in review: a change to the sandbox design that
starts requiring any of these to route through the sandbox has lost the plot. Only processes cross the
boundary; files are shared through the mount.

## Egress

Once each task runs in its own sandbox, default-deny egress becomes nearly free, and it is the single
most useful rule for the data-safety gap [threat-model.md](./threat-model.md) names. `sbx` ships three
network policies (open, balanced, locked-down) and per-host rules. The task-scoped framing pays off
here: "this task may reach `registry.npmjs.org` and `github.com`" is a policy acorn can express
because a task knows its project and its purpose. Wire the task's allowed egress into the sandbox's
network policy at creation; do not build an egress proxy of acorn's own. Route to what the sandbox
already enforces.

## Cost and lifecycle

Twenty open tasks must not mean twenty microVMs at rest. Create the sandbox lazily on the task's first
execution, not at task creation, and tear it down on archive. `sbx` sandboxes persist and reconnect by
name, so key the sandbox on the task id and reattach rather than recreate. The archive-time teardown
prompt the Docker plugin already has (`docs/docker.md` § Surfaces) is the model.

## The spike to do first

Before any host change, prove the ergonomics with an agent profile. An `AgentProfileContribution`
(`packages/node-core/src/server/agentProfiles/types.ts`) whose `command` is `sbx` and whose `launchArgs`
are `["run", "claude"]` gets a sandboxed agent in a task with zero host changes. Live with it for a
week. If the round-trip and the port story hold up, build the execution-target seam. If they do not,
the folder learned something cheaply.
