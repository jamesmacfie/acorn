# Lessons from OpenCode

Date: October 16, 2026. Status: proposed. Implementation not started.

This folder holds Acorn work that came out of reading OpenCode. Phases 1 to 4 borrow three ideas
from OpenCode 2. Phase 5 adds OpenCode itself as a harness. Read this page before you pick up a
phase.

## Why this exists

On October 15, 2026, OpenCode 2.0.29 was cloned into `references/opencode` at commit `7b5f1bd9e1`.
Its design notes are in `references/opencode/specs/v2`. Most of that work doesn't carry over.
OpenCode runs the model loop itself, so much of its v2 work covers retries, continuing a cut-off
reply, and compaction. Acorn leaves all of that to Claude Code and Codex.

Acorn already had several of the other v2 headline features before the review:

- Durable queued turns and steering ([operations](../../managed-agents/operations.md),
  [steering](../../managed-agents/steering.md)).
- Recovery after a crash.
- A slow socket that sheds frames instead of stalling other clients.
- Terminal bytes encoded once for all viewers.

Three ideas fill real gaps, and the owner picked all three on October 16, 2026:

- OpenCode caps every tool result in one place. Acorn's MCP server sends whatever the Node returns,
  pretty-printed, with no size limit.
- OpenCode tells a running session when one of its instruction sources changes. Acorn takes one
  memory snapshot when a session starts, so a memory another agent writes mid-session never
  reaches it.
- OpenCode offers agents one tool that runs a short script calling other tools. An Acorn agent pays
  one round trip per call across about 70 tools.

## The phases

| Phase | What changes |
| --- | --- |
| [1](./01-tool-result-cap.md) | The MCP server caps every tool result and saves the full text where the agent can read it. |
| [2](./02-memory-updates.md) | A running session hears about memory added, changed, or removed since its last turn. The memory plugin's settings page turns it on and off. |
| [3](./03-script-tool-spike.md) | A spike picks the interpreter for the script tool and measures what it costs the Node bundle. |
| [4](./04-script-tool.md) | Agents get `run_script`, which runs a short program that calls other Acorn tools in one round trip. |
| [5](./05-opencode-harness.md) | An external package adds OpenCode beside Claude Code and Codex. |

## Order and dependencies

Phases 1, 2, and 5 are independent. Take phase 1 first, because it's the smallest and every agent
call benefits from it.

Phase 4 needs phase 1, because a script can gather far more output than one call, and phase 4
relies on phase 1's cap. Phase 4 also needs phase 3's decision.

Phase 5 was written on October 9, 2026, against OpenCode 1.18.35. Recheck its facts against the
OpenCode version you install, because OpenCode 2 changed its plugin and server contracts.

## Out of scope

- OpenCode's event feed, which encodes each event once for many clients. Acorn sends JSON frames
  with a sequence number per socket, and a Node has few sockets. Revisit it only if a measurement
  shows frame encoding is slow.
- OpenCode's allow and deny policy language. Acorn's tool tiers, per-tool switches, workflow
  ceilings, and `core:before-tool-call` cover the same need.
- Hiding the full tool list behind a search tool. Phase 4 adds a script tool beside the existing
  tools and removes nothing.
