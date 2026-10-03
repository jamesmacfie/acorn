# Phase 5: Product features

Date: October 3, 2026. Status: proposed, not started. Part of the
[documentation overhaul](./README.md). Do [phase 1](./01-guardrails.md) first.

These pages describe what a user does in acorn: tasks, agents, terminals, integrations, workflows,
and the feature panes.

## Docs in this phase

| Doc | Lines | Source citations |
| --- | --- | --- |
| [workspaces-and-tasks.md](../../workspaces-and-tasks.md) | 441 | 78 |
| [managed-agents.md](../../managed-agents.md) | 1,416 | 93 |
| [managed-agents/client-surfaces.md](../../managed-agents/client-surfaces.md) | 666 | 5 |
| [terminal.md](../../terminal.md) | 514 | 23 |
| [agent-tools.md](../../agent-tools.md) | 492 | 58 |
| [dashboards.md](../../dashboards.md) | 108 | 91 |
| [integrations.md](../../integrations.md) | 611 | 82 |
| [data-sources.md](../../data-sources.md) | 245 | 0 |
| [github-integration.md](../../github-integration.md) | 468 | 27 |
| [workflows.md](../../workflows.md) | 881 | 105 |
| [workflows/execution.md](../../workflows/execution.md) | 332 | 3 |
| [workflows/authoring.md](../../workflows/authoring.md) | 375 | 0 |
| [notes-and-memory.md](../../notes-and-memory.md) | 214 | 23 |
| [http-client.md](../../http-client.md) | 229 | 28 |
| [docker.md](../../docker.md) | 155 | 5 |
| [database.md](../../database.md) | 249 | 12 |

## Known problems

### managed-agents.md

At 1,416 lines, this is the longest reference page. "Harnesses" runs 281 lines, "Operations and
failure" runs 235, and "Session model" runs 151. A split into `docs/managed-agents/`:

| New page | Takes |
| --- | --- |
| `sessions.md` | HTTP control authority, standing memory, and the session model |
| `harnesses.md` | Harnesses and provider-native subagents |
| `delegation.md` | Managed delegation and custom agents |
| `activity.md` | Web activity, file changes, context, files, and attachments |
| `defaults.md` | New-session defaults and palette commands |
| `operations.md` | Operations and failure |

The "Source map" section at the end goes stale fastest. Replace it with source paths inside each
topic page. `managed-agents/client-surfaces.md` came out of an earlier split as one 666-line
section. Split it again by surface.

Thirty-three source comments cite a deleted `docs/terminal-and-agents.md`. Phase 1 points
them at this page or at `terminal.md`.

### workflows.md

"What workflows refuses" runs 202 lines, longer than most whole pages. Cut it to the refusals that
stop a reader from reopening a decision. "Gaps" is proposal material. Move it to `docs/future/`.
"Routes and UI" runs 140 lines and belongs in its own page beside `execution.md` and `authoring.md`.

### integrations.md

"Model providers" runs 139 lines. Give it a page in `docs/integrations/`, with one page
each for Linear, Rollbar, and Sentry. Check every provider and capability against the plugin
manifests in `plugins/`.

### workspaces-and-tasks.md

"Worktrees and setup" runs 165 lines. Split it out. Check the task script states against
`packages/protocol` before rewriting them.

### agent-tools.md

Check every tool name against the tool registrations in source. Tools get renamed and removed more
often than prose gets updated.

### data-sources.md

No source comment cites this page. Check whether it still owns the contract, or whether
[integrations.md](../../integrations.md) does. Merge it if the content duplicates.

## Done means

- Each doc in the table follows the [house style](./style.md) and is 200 lines or shorter.
- Every tool, route, and palette command named exists in source.
- No feature doc holds proposals or gap lists. Those live in `docs/future/`.

## Verify before you start

- Read the latest entries in `docs/release-notes.md`. Features shipped since a page was written
  are the likeliest omissions.
- Check `plugins/*/package.json` manifests for the contribution names these pages use.
