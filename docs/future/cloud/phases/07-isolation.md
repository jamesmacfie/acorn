# Phase 7: worker isolation and team policy

Status: proposed, 2026-09-29.

## Goal

Keep an agent inside a worker away from that worker's own secrets, keep model keys out of agent
processes where possible, enforce egress on every path out, and let a team set policy that a worker
cannot widen. This phase is the gate for the first person outside the building team.

Read [isolation](../isolation.md) before starting. It explains why the provider's VM is not enough.

## What you can deploy at the end

A hardened worker image on staging, passing the adversarial test suite, with team policy set by a
team admin. The closed alpha opens: single-person teams, using their own model keys.

## Starting point

- Working cloud tasks with archive and restore from [phase 6](./06-archive.md).
- The execution boundary and team policy in [isolation](../isolation.md). Neither is built.
- The three execution chokepoints: `packages/node-core/src/server/core/proc.ts`,
  `plugins/terminal/src/server/terminal.ts`, and `plugins/agents/src/server/drivers/jsonRpcProcess.ts`.
- The child environment allowlist in `packages/node-core/src/server/taskEnv.ts`.

## In scope

- The worker execution target seam and its Linux backend.
- Data root permissions and credential placement in the worker.
- The model key proxy, and the per-harness fallback.
- A Git credential helper backed by the Node.
- Egress enforcement for every process in the worker.
- Team policy as the managed layer, with a resolved-policy view.
- Functional acceptance for Git, Acorn tools, attachments, terminals, previews, and offered services.
- The adversarial test suite, run in CI against the image.

## Out of scope

Local task sandboxing. Audit export to a customer's telemetry sink, unless a closed-alpha team
needs it.

## Steps and checkpoints

### 1. Define the worker execution seam

Specify the execution seam from [isolation](../isolation.md#worker-execution-boundary), including
streaming, PTYs, cancellation, and cleanup. Confirm the checkout's Git metadata is available to
task processes while Node secrets are not. Specify task API and MCP connectivity, selected attachment
delivery, and preview port routing before implementing the backend.

### 2. Separate the task user

Build the execution target on the task and the resolver, honored by the three chokepoints. The Linux
backend runs task children as a separate Unix user in their own mount namespace, with the worktree,
a private `/tmp`, and read-only tools. Add Landlock where the kernel supports it. Lock the data root
to the Node user.

**Checkpoint 1: the agent cannot read the Node.** In a local worker container, ask an agent to read
`/data/core.sqlite`, `internal-token`, and `session.key`, and to list `/proc/<node-pid>/environ`.
Each fails. The editor, diff, and search still work. Inside the task terminal, Git status, diff,
branch, and commit succeed. Acorn tools and attachments remain available to a managed agent.

**Checkpoint 2: a local Node is unchanged.** On an ordinary local Node, behavior is
exactly as before, and the policy resolver does not run.

### 3. Credentials in memory only

Hold the attempt token, relay credential, and service credential in the Node process only. Never
write them to a path a child can read.

### 4. Model keys

Build the loopback credential proxy for harnesses that accept a base URL. For each harness acorn
ships, record which option it uses: proxy, or the task-scoped environment fallback with its trust
cost written down.

**Checkpoint 3: the key is not in the agent.** With a harness on the proxy, ask the agent to print
its environment and read any config file it can find. The real key does not appear. The agent still
completes a turn.

### 5. Git credentials

Replace any stored Git token with a credential helper that asks the Node for a short-lived token for
the task's repository only.

**Checkpoint 4: one repository only.** From a cloud task, the agent can push to its repository and
cannot clone a different private repository in the same organization.

### 6. Egress

Choose and build the enforcement option from [isolation](../isolation.md#egress). Cover agents,
terminals, setup scripts, plugin node halves, and the Node itself.

**Checkpoint 5: denied is denied.** With the default egress list, `curl` to an unlisted host fails
from a terminal, from a setup script, and from a test plugin's node half. Git, the package registry,
and the model provider still work.

### 7. Team policy

Build the managed layer resolver and the fixed vocabulary from [team policy](../isolation.md#team-policy). The team Node
delivers the team and project policy in the seed. The worker merges most-restrictive-wins. Add a
resolved-policy view per task: what is allowed, and who decided.

**Checkpoint 6: a project cannot widen the team.** Set the team's tool ceiling to deny the execute
tier. Try to allow it at the project level and at the task level. The resolved view shows the team's
ceiling winning, and an agent cannot call an execute tool.

### 8. The adversarial suite

Write a hostile agent script and a hostile loaded plugin that try everything in
[the adversarial test](../isolation.md#the-adversarial-test). Run them in CI against every image
build.

**Checkpoint 7: an outside review.** Before the alpha opens, someone who did not build this phase
tries to break a staging worker for a day, with the source available. Record what they found and
what changed.

## Acceptance

- The adversarial suite passes in CI, and the outside review's findings are fixed or accepted in
  writing.
- Every harness acorn ships has a recorded model-key option.
- A local Node with no policy runs exactly as before.
- The functional acceptance paths in [isolation](../isolation.md#the-adversarial-test) pass alongside
  the denial tests. A required isolation backend that cannot start refuses execution.

## Docs to update when it ships

- [Isolation](../isolation.md): mark what shipped and move behavior to owning documents.
- [security](../../../security.md): worker isolation, credential placement, and egress.
- [Cloud refusals](../refused.md): record the adopted egress boundary and alternatives rejected.

## Open questions

1. Which egress option: provider controls, `nftables` at boot, or a filtering proxy?
2. For each harness, proxy or environment fallback?
3. Does the provider's kernel support Landlock and unprivileged user namespaces?
4. Is a separate Unix user enough, or does the task need a nested container?
5. Where does a team admin edit team policy: the web app, or desktop and TUI Settings on the team
   Node? See [phase 8](./08-plugins.md#open-questions) for the same question about plugins.
6. Does the closed alpha need audit export, or is the team Node's own audit trail enough?
7. Who runs the outside review, and is a paid penetration test needed before the alpha or only before
   general availability?

## Evidence

Record the adversarial suite's results and the review's findings here, with dates.

## Verify before building

Check the provider's VM privileges, checkout and Git metadata layout, task API connectivity, and
which harnesses accept a base URL override.
