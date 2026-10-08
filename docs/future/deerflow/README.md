# What acorn takes from DeerFlow

Status: all five phases shipped, October 8, 2026. The completed phase plans and their completion
notes are retained in Git history. This folder keeps the review's reasoning and deferred ideas.
Where it disagrees with a shipped contract, the owning reference doc wins.

## What DeerFlow is

[DeerFlow](https://github.com/bytedance/deer-flow) is ByteDance's open-source agent harness, version
2. It's a Python backend on LangGraph with a Next.js web client, a terminal client, sandboxes,
long-term memory, skills, subagents, scheduled tasks, and chat-app channels. The checkout reviewed
was commit `5872d07e`, cloned to `references/deer-flow/`, which Git ignores.

## Why most of it doesn't transfer

DeerFlow owns its agent loop: the cycle that builds a prompt, calls the model, runs the tools the
model asks for, and feeds the results back. Most of its features are middleware inside that loop,
such as context compaction, tool-call repair, loop detection, and progressive skill loading.

Acorn drives loops other people wrote: Claude Code over ACP, Codex over its app-server, and any
contributed ACP harness. The [oh-my-pi review](https://github.com/jamesmacfie/acorn/blob/e67db6f50/docs/future/pi/README.md) reached the same conclusion. So the
five ideas taken here all work from outside the loop. Each one reads acorn's own durable record of a
session, or queues a turn through acorn's own turn queue, or checks something on disk.

## Shipped features

| Feature | Owning reference |
| --- | --- |
| Capture another same-task session's conversation for the next message. | [Composer](../../managed-agents/composer.md) |
| Persist a completion condition, check bounded ledger evidence, and queue limited continuations. | [Session goals](../../managed-agents/operations.md#session-goals) |
| Search and page a managed agent's own durable transcript through read-tier tools. | [Transcript search](../../managed-agents/transcript-search.md) |
| Persist host checks on delegated work and show their verdicts beside the child's report. | [Delegation](../../managed-agents/delegation.md) |
| Resolve host attendance for accepted turns and settle autonomous requests without human input. | [Turn operations](../../managed-agents/operations.md) and [workflow execution](../../workflows/execution.md) |

## Smaller ideas not written up

These came up in the review and are recorded here so a later session doesn't rediscover them:

- **A doctor command.** DeerFlow's `make doctor` checks the setup and prints a fix for each failure.
  `make support-bundle` writes a redacted summary, a `triage.json` file for automated triage, and a
  draft issue that an AI assistant can file. Acorn has **Settings > Telemetry**, and the CLI has no
  equivalent.
- **Loop alerts.** Acorn sees every tool call as it streams, so the same call repeated several times
  in one turn could raise a notice through the [notification gate](../../notifications/gate.md).
- **Edit and rerun the last message.** This needs each harness to support rewinding its own history,
  so it depends on the harness.

## What acorn doesn't take

[refused.md](./refused.md) lists the DeerFlow features this review decided against, with the reason
for each.

## Before taking up a deferred idea

Read its owning runtime's reference and trace the current contribution and capability seams. This
review describes the checkout from October 6, 2026; it is a decision record rather than a code map.
