# Background commands

A managed agent can start a shell command that keeps running after its turn ends. This page covers
how Acorn shows one, what each harness reports, and what the card says when the report never comes.
Read it before you change how a command card settles or add background commands to another harness.

## What the reader sees

A background command is the command's own tool card, marked with `background` on `AgentToolCall`
(`plugins/agents/src/contract/wire.ts`). The card stays where the command started. It reads
**running in background** until the harness reports the exit, then shows the outcome and
`exit code N`. While it runs, new output lands on the card. The card shows the last 12 lines, and
**Show all output** opens everything the card holds (`toolRendererRegistry.tsx`).

The pane header carries a chip, such as **2 commands running in background**, while any are still
running. Its tooltip lists the commands (`client/sessions/backgroundCommands.ts`). The chip reads
the transcript the pane has loaded, so a command whose card is older than the loaded pages is left
out.

A background command doesn't make its session busy. The session reads `ready` when its turn ends,
the same as with a background subagent. The idle sweep doesn't stop a session while one of its
background commands runs, because stopping the harness ends the command.

## What each harness reports

| | Claude Code | Codex |
| --- | --- | --- |
| How it starts | A Bash call with `run_in_background: true` | A command still in progress when its turn completes |
| Where output goes | A file in Claude's temporary folder | `item/commandExecution/outputDelta`, after the turn too |
| How it ends | A `task_notification` SDK message | `item/completed` with `exitCode` |
| Exit code | Parsed from the notification's summary | A field on the item |

Both are tested against live captures in `plugins/agents/src/server/drivers/__fixtures__/`
(`claudeBackgroundCommandWire.json` and `codexBackgroundCommandWire.json`, both taken on
October 12, 2026).

### Claude Code

The Bash call returns as soon as the command starts. Its result is a receipt: `Command running in
background with ID: <id>. Output is being written to: <path>.` The normalizer reads that receipt as
`running` rather than `completed` and clears its text from the card (`claudeBashLaunch` in
`acpNormalizer.ts`).

The exit arrives only as the SDK's `task_notification` message, which the ACP adapter drops unless
the session asks for it. `claudeHarness.ts` asks with `_meta.claudeCode.emitRawSDKMessages`, and the
adapter forwards the message as the `_claude/sdkMessage` extension notification. The notification
names the Bash call by `tool_use_id`, so the driver settles that card. Claude also starts a turn of
its own to tell the model, which streams into the transcript as ordinary assistant text outside any
Acorn turn.

`ClaudeBackgroundCommands` in `claudeBackgroundCommands.ts` reads the output file once a second and
appends what's new to the card, attributed to the turn the command started in. It reads a file only
when its real path is inside `claude-<uid>` under `CLAUDE_CODE_TMPDIR` or `/tmp`, opens it read-only
without following a final link, and never writes, moves, or deletes it. A receipt that names any
other path gets no output and a warning in the Node's log. The card still settles when the
notification arrives.

The card keeps at most 64 KiB of output, the materializer's inline limit. Past that, the driver
replaces the card's output with its newest 48 KiB and a line that says earlier output was cut. The
newest part is where a build or a test run reports its result. Reading stops when the command
settles or the harness process stops.

### Codex

Codex needs no file. Its command item stays `inProgress` past `turn/completed`, output keeps arriving
with the original turn ID, and `item/completed` carries `exitCode`. The driver already pins a late
command event to the turn that started it. At `turn/completed` it also marks each command that's
still open as `background`, before the turn's end is recorded (`codexStart.ts`).

## When the exit never comes

`commandStatus` in `server/sessions/commandLifecycle.ts` keeps a background command `running` while
its session's harness is alive. When the session stops, fails, is archived, or starts reconnecting,
no exit can arrive. The runtime then records the card as `unknown`, which the card reads as **lost**.
At startup the runtime does the same for every background command still marked running, because no
harness survives a Node restart. Output recorded before then stays on the card.

That startup pass reads only events written since the previous start's pass began, less a
ten-minute margin for a clock set back. The previous pass settled everything older, and the
`agent_command_settle` table remembers when it began. The same read settles the sessions that startup
stops and the children it idles, so those records skip their usual settle, which reads the session's
whole history. On one long-used database's largest session, 31,157 events, that read took 230 ms with the file cached and 1.8 s
without on October 19, 2026. Reading every event would block the Node for
tens of seconds on a long-used database, because its SQLite calls are synchronous. The time is saved
only after the pass finishes, so a start that dies partway rereads the same events next time. In a check on
October 12, 2026, a Claude command that was running when the app restarted didn't survive the restart
either.

## Limits

- Acorn has no control to stop a background command. The harness owns the process. Claude stops one
  through its own tool, and the card then reads `cancelled`.
- A provider process that the runtime replaces without recording a stopped or reconnecting state
  leaves its commands reading `running`. None of the restart paths do that today.
- Output past 64 KiB keeps only its newest part. The file stays in Claude's temporary folder until
  Claude removes it, and Acorn doesn't copy it anywhere.
- A backgrounded Claude subagent sends the same `task_notification`, which would settle its roster
  row (see [Subagents](./subagents.md)). The driver ignores those, because it only settles calls it
  saw launch as background commands.
- A harness other than these two gets plain command cards. Its driver adds detection when it has
  background commands to report.

## Why

The tool card already folds a call's updates, keeps its output in the ledger, attributes late
updates to the turn that opened it, and draws on both the desktop and the terminal client. A separate
roster would have repeated each of those. Keeping the command on its own card also means a restart
restores its output from the ledger with no extra state.
