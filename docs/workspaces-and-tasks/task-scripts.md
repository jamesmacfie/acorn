# Task script results

Core records every setup and teardown attempt, so the CLI, MCP tools, desktop, and terminal client
can say what a script did. This page covers the states, the retained output, and how waits work.
The wire types are in `packages/protocol/src/projects/taskScripts.ts`, and the service is in
`packages/node-core/src/server/taskScripts/`.

## Durable task script results

Core owns the attempts, in `task_script_attempts`. The terminal plugin owns the process and reports
evidence through the compiled `CoreServices.taskScripts` facet. Reading status or logs, or waiting,
doesn't resolve a worktree or run a script. A usable task root, or an agent session that started,
doesn't prove that setup finished.

Each run or explicit skip gets a unique `attemptId` and a task `generation`. Creating or restoring a
worktree advances the generation, and a teardown retry gets its own attempt. The current phase reads
the latest attempt in the current generation. Status also returns up to 50 recent attempts and
`attemptsTruncated`. Pass an attempt ID to read an older one. A configuration edit can't rewrite an
attempt's outcome, and late evidence from an older generation can't change the current one.

`taskScriptStateSchema` has these states:

| State | Meaning |
| --- | --- |
| `not_started` | No request in this cycle. No timestamps are invented. |
| `starting` | Core admitted the run, before the spawn. |
| `running` | The process owner reported the spawn. Installation may still be running. |
| `succeeded` | The command exited with code 0. |
| `failed` | `spawn_failed`, `nonzero_exit`, or `timeout`. |
| `skipped` | `user_skipped`, `disabled`, `not_configured`, or `not_applicable`. |
| `interrupted` | `cancelled`, `terminal_removed`, `shutdown`, `restart`, `process_lost`, or `generation_changed`. |
| `unknown` | No trustworthy history, such as an adopted worktree. |

A null exit code doesn't mean success. A lazy setup stays `not_started` until its trigger runs.
Teardown stays unrequested until archive reaches the script, so an archive refused earlier records no
teardown attempt. A teardown can succeed while a later cleanup or the worktree removal fails.
`archiveInProgress` covers the whole archive, not only the script.

The desktop's setup rail marker reads this snapshot. Script sessions stay in the terminal drawer, and
the CLI and the task script tools read retained output. The terminal client's task chrome shows both
phases. Offline and stale snapshots are labeled, and a cached `running` doesn't prove a live
process.

## Retention and recovery

Each attempt keeps a UTF-8 tail of at most 64 KiB (`TASK_SCRIPT_OUTPUT_BYTES`). A log query returns
at most 1,000 lines and 32 KiB, 100 lines by default, with availability, byte counts, and truncation
flags. The Node redacts acorn task and device tokens before it stores output. Script bodies and
inherited credentials stay out of metadata. A script can still print its own secrets, so don't print
them. Missing capture reports as unavailable, not as an empty successful log.

Removing a terminal and archiving a task keep results and tails. Deleting a project deletes its
tasks and their attempts. On boot, the terminal plugin reattaches the durable sessions it can, and
core marks the attempts it can't recover `interrupted` with reason `restart`. A tmux attach-client
exit doesn't prove the script succeeded. Node shutdown interrupts ordinary PTYs, and durable sessions
keep an identity they can recover. Recovery doesn't run scripts again.

## Waits

A wait binds to an attempt and a generation, subscribes before it rereads, and cleans up its
subscription, timer, and abort listener when it settles. One Node call waits at most 30 seconds
(`TASK_SCRIPT_WAIT_MS`). A phase that wasn't requested or is unknown returns at once. A settled skip
includes its reason. A timeout returns `matched: false` and doesn't stop the script. Task
invalidations carry no content and publish after the write commits, and clients reread after a
notice or a reconnect.
