# Contracts and CLI precedents

Status: research and proposed design references, 2026-09-27. Recheck external documentation before
copying exact flag syntax; links describe precedents, not dependencies.

## Repository contracts

| Subject | Read before implementation | Why it matters |
| --- | --- | --- |
| Runtime topology | [Architecture overview](../../architecture-overview.md), [API reference](../../api-reference.md), [authentication](../../authentication.md) | The Node owns state and the CLI is a paired device client. |
| Data hierarchy | [Workspaces and tasks](../../workspaces-and-tasks.md), `packages/node-core/src/server/routes/projects/workspaces.ts`, `projects.ts`, `tasks.ts` | Workspace membership, Node-host project paths, task ownership and creation. |
| Custody and distribution | [Node distribution](../../node-distribution.md), [terminal client](../../tui.md), `packages/custody/src/`, `apps/tui/src/node/`, `scripts/pack-node.mjs` | Fleet selection, tokens, pins, process ownership, and what is actually packaged. |
| Agents | [Managed agents](../../managed-agents.md), `plugins/agents/src/server/routes/managed.ts`, `plugins/agents/src/shared/schemas.ts` | Session and turn keys, durable event pages, waits, and provider profiles. |
| Workflows | [Workflows](../../workflows.md), [execution](../../workflows/execution.md), `plugins/workflows/src/server/routes/workflow.ts` | Published definition IDs, typed inputs, trust checks, runs, and steps. |
| Plugin boundaries | [Plugin map](../../plugin-map.md), [package shape](../../plugins/package-shape.md), [security](../../security.md), [command palette](../../command-palette-and-shortcuts.md) | Active plugins and worker permissions; a palette command is not a headless command. |
| Mutation retry | `packages/node-core/src/server/middleware/idempotency.ts`, `packages/node-core/src/server/auth/idempotency.ts` | Device-scoped replay, UUID keys, and the write-before-save gap. |

Paths name the files as of commit `e0445287`. Follow [the documentation index](../../README.md)
and code search if files move. The docs that own shipped behavior win over this future proposal.

## External CLI patterns

| CLI | Useful precedent | Adopt or adapt |
| --- | --- | --- |
| [GitHub CLI formatting](https://cli.github.com/manual/gh_help_formatting) and [reference](https://cli.github.com/manual/gh_help_reference) | Structured `--json` output, field selection, file/stdin inputs, and follow-style commands. | Stable machine fields and typed stdin. Keep a simpler `--output` contract first; add field selection only if a real script needs it. |
| [kubectl output conventions](https://kubernetes.io/docs/reference/kubectl/conventions/) | Consistent nouns, output modes, and readable tables across a large resource set. | One grammar for workspace, project, task, agent, and run. Avoid copying Kubernetes' resource machinery wholesale. |
| [kubectl plugins](https://kubernetes.io/docs/tasks/extend-kubectl/kubectl-plugins/) | External executable discovery demonstrates easy extension and its namespace shape. | Acorn's active Node plugin and worker permission model needs manifest-backed discovery instead of PATH executables. |
| [Terraform output](https://developer.hashicorp.com/terraform/cli/commands/output) | Machine-readable output is distinct from display rendering. | Treat JSON as a supported API with schemas and versioning, not scraped human text. |
| [Docker formatting](https://docs.docker.com/engine/cli/formatting/) | Human table output and script-selected fields can coexist. | Keep default tables compact; add custom templates only if the stable JSON contract is insufficient. |

The Unix pipe is a composition mechanism for finite typed outputs. Long-running and recoverable
orchestration remains a workflow definition. A CLI pipe should carry a resource reference with
`kind`, `nodeId`, and `id`; a workflow graph should carry its own declared inputs and execution
policy. That division avoids making a shell pipeline responsible for approval, retry, and crash
recovery.

## Verify before building

- Revisit linked CLI documentation for current flags and output guarantees before citing them in
  shipped user documentation.
- Recheck the repository paths and contract owners above against the implementation checkout.
