# Claude steering spike, October 13, 2026

This page records whether Claude Code, driven through `@agentclientprotocol/claude-agent-acp`, takes
a second `session/prompt` into the turn it's running. The result decided that Claude steers through
the same driver as Codex. The figures are dated evidence. Don't edit them. The behavior itself is in
[the turn queue](../managed-agents/operations.md#the-turn-queue).

## Setup

- Checkout: `827f5451b`.
- Versions: `@agentclientprotocol/claude-agent-acp` 0.54.1, `@agentclientprotocol/sdk` 1.3.0, and
  Claude Code 2.1.296, on macOS 27.0 with Node 24.11.0.
- A throwaway script spoke ACP to the adapter directly, with no Node service. It auto-allowed every
  permission and logged each session update and each prompt response with a clock.
- The first prompt asked for two Bash commands in a row: `sleep 20 && echo first-done`, then
  `sleep 5 && echo second-step`, then a one-line reply.
- Eight seconds in, while the first command slept, the script sent a second `session/prompt`: "do
  not run the second command, reply with only the word BANANA".

## Result

| Time | What arrived |
| --- | --- |
| 3.7s | The first Bash call, `sleep 20 && echo first-done`, started. |
| 8.8s | The script sent the second prompt. The adapter logged its command as `queued`. |
| 26.0s | The first Bash call completed. |
| 26.0s | The first prompt resolved with `end_turn` and zero usage. |
| 26.0s | The second prompt's command moved to `started`. |
| 27.6s | The agent replied `BANANA`. It never ran the second command. |
| 27.6s | The second prompt resolved with `end_turn` and the whole turn's usage. |
| 27.6s | The first prompt's command moved to `completed`, after the second prompt's. |

Claude Code folded the message into the running turn at the next step boundary, after the tool call
it was running. The agent followed it.

## What the driver reads

Two prompt responses come back, in order:

1. The first prompt resolves when the adapter sees Claude's echo of the second prompt's message. That
   is the moment the agent took it. The adapter settles the first prompt with `end_turn` and moves
   to the second.
2. The second prompt resolves when the turn ends. It carries the turn's stop reason and usage.

So a prompt that resolves while a later one is still pending marks that later one as taken. Only the
last pending prompt's resolution ends the turn. If the second prompt crosses the first turn's end on
the wire, the adapter runs it as the next Claude turn. The driver still reads it the same way, so
the message is taken once.

## Limits

- One run, on one machine. The adapter's echo handling is in `prompt` and `runConsumer` in its
  `dist/acp-agent.js`.
- A cancel settles a prompt the adapter hasn't promoted with `cancelled`. Claude Code still has the
  message in its input and runs it with its output hidden. A steer that a cancel overtakes can
  therefore reach the agent twice if it's sent again.
