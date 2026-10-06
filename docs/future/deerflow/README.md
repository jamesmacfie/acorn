# What acorn takes from DeerFlow

Status: proposed, October 6, 2026. Nothing in this folder is built or scheduled. Where a file here
disagrees with a shipped contract, the owning reference doc wins.

This folder holds five product requirement documents for ideas taken from DeerFlow. Each one stands
alone, so a developer can pick up any of them without reading the others. Read this page first for
the reasoning that decided what to take.

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
contributed ACP harness. The [oh-my-pi review](../pi/README.md) reached the same conclusion. So the
five ideas taken here all work from outside the loop. Each one reads acorn's own durable record of a
session, or queues a turn through acorn's own turn queue, or checks something on disk.

## The five designs

The numbers are the suggested build order, smallest and most self-contained first:

| File | What it adds | Rough size |
| --- | --- | --- |
| [01-session-references.md](./01-session-references.md) | Attach another agent session's conversation to your next message from the composer's context picker. | About a day. It reuses the fork snapshot and the context contribution kind. |
| [02-session-goals.md](./02-session-goals.md) | Give a session a completion condition. After each turn, a cheap model call judges the transcript, and acorn sends another turn only when useful work remains. | About a week, including the goal strip, storage, and restart recovery. |
| [03-history-search.md](./03-history-search.md) | Two read-tier agent tools that search and page an agent's own transcript, including what the harness compacted away. | Two to three days. The full-text index exists. |
| [04-delegation-checks.md](./04-delegation-checks.md) | Host-run checks on delegated work, such as "this file exists" or "the child committed", reported beside the child's own account. | Three to four days. |
| [05-unattended-policy.md](./05-unattended-policy.md) | One resolved answer to "is anyone watching this turn", used by the prompt, the request handling, and the goal judge. | About a week, most of it in request handling and tests. |

Two links between them are worth knowing. Session references can later page a referenced transcript
through the history tools in 03. The goal judge in 02 reads the unattended policy in 05 when both
exist, and ships without it.

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

## Verify before building

Each design ends with its own list. Paths in these files are hints from October 6, 2026. Confirm them
against the checkout before you build.
