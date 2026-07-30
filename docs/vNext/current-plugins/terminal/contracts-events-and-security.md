# Terminal contracts, events, and security

**Status:** Normative current-plugin migration<br>
**Requirement prefix:** `CUR-TERM`

## Terminal query catalog

| Query ID | Target/input | Result | Capability |
| --- | --- | --- | --- |
| `acorn.terminal.profiles.list.v2` | Node | compatible profile descriptors/availability | `core.terminal:list` |
| `acorn.terminal.sessions.list.v2` | Node/task; status/kind/cursor, ≤100 | redacted session page | `core.terminal:list` |
| `acorn.terminal.session.snapshot.v2` | session | metadata, status, display-generation/stream descriptor | `core.terminal:read-output` |
| `acorn.terminal.task-status.v2` | task | running/attention session summaries | `core.terminal:list` |

`CUR-TERM-080` Session queries return a safe command label and task-root display projection, never
raw command/argv/environment, process/tmux internals, unredacted host paths, input/output, or broker
handles.

## Terminal command catalog

| Command ID | Effect | Idempotency/commit/deadline | Grant/confirmation |
| --- | --- | --- | --- |
| `acorn.terminal.session.create.v2` | launch one declared profile in target task | keyed saga; session intent before PTY start; 120 s | `core.terminal:create`, profile process grants; unrestricted-code for shell |
| `acorn.terminal.session.interrupt.v2` | send configured interrupt signal | keyed; signal intent/outcome; 10 s | `core.process:signal` |
| `acorn.terminal.session.terminate.v2` | terminate process/tmux tree | keyed; stopping transition; 30 s | `core.terminal:terminate`; destructive if active |
| `acorn.terminal.session.remove.v2` | terminate if authorized then remove metadata | naturally idempotent; removal/event; 30 s | terminate plus destructive |
| `acorn.terminal.session.resize.v2` | update PTY/display dimensions | naturally idempotent by generation; 5 s | `core.terminal:resize` |
| `acorn.terminal.session.send.v2` | restricted bracketed-paste draft/now/after-ready | keyed; delivery/queue result; 10 s | `core.terminal:send-input`; external automation high risk |
| `acorn.terminal.session.attach-controller.v2` | accept Agents controller handoff/display relation | keyed saga; lease/session relation; 120 s | exact dependency/delegation |
| `acorn.terminal.session.release-controller.v2` | release cleanly exited handoff | keyed/revision; relation transition; 30 s | exact dependency/delegation |
| `acorn.terminal.profile.setting-update.v2` | Node owner Terminal settings | keyed/revision; setting event; 10 s | `core.settings:write` |

`CUR-TERM-081` Session create accepts profile coordinate/version, title ≤240 characters, dimensions,
and optional authorized lineage. It MUST NOT accept an arbitrary executable, shell string,
environment map, working directory, task ancestry, or raw command from ordinary Terminal callers.

`CUR-TERM-082` A shell profile is deliberate unrestricted task-local code execution as the Node OS
user. The host MUST label it honestly, require policy/owner approval, and explain that sandboxing
the terminal itself would defeat its purpose; it still receives controlled initial environment and
task-root scope.

`CUR-TERM-083` Resize is coalesced and generation-bound. Interrupt/terminate/remove are distinct:
interrupt is best-effort input/signal, terminate ends the process tree, and remove releases the
Terminal resource after process settlement.

`CUR-TERM-084` `after-ready` commit means “accepted into bounded in-memory pending send,” not
durable delivery. Results include `sent`, `queued`, and safe reason. Node restart/disconnect/session
exit may discard it and MUST surface that fact.

## Exported capabilities

| Capability | Purpose |
| --- | --- |
| `acorn-plugin://acorn/terminal/capability/session-snapshot@2` | redacted task/session roster and status |
| `acorn-plugin://acorn/terminal/capability/session-focus@2` | typed Client presentation intent |
| `acorn-plugin://acorn/terminal/capability/session-send@2` | exact session, bounded text and submit mode |
| `acorn-plugin://acorn/terminal/capability/controller-handoff@2` | Agents managed↔terminal exclusive lease |
| `acorn-plugin://acorn/terminal/capability/display-process@2` | core-only attach a preauthorized PTY handle to a visible Terminal session |
| `acorn-plugin://acorn/terminal/capability/context-snapshot@2` | bounded tail-derived snapshot with terminal-screen authority |

`CUR-TERM-085` `display-process@2` accepts an opaque process/PTY handle already authorized and
created by core, plus safe label/task/dimensions. Terminal cannot inspect or change its executable,
arguments, environment, resource policy, or repository trust decision.

`CUR-TERM-086` `session-send@2` preserves original caller and delegated task/session scope. Agents,
Editor, Changes, Context, automation, or another plugin cannot use Terminal's own broader
permissions, pick the “most recent” session on the Node, or write after revocation.

`CUR-TERM-087` `context-snapshot@2` returns an immutable bounded text/screen snapshot with captured
time, source session, freshness, sensitivity and `terminal-screen` provenance. It grants no live
output subscription or input authority.

## Event catalog

| Event | Safe payload |
| --- | --- |
| `acorn.terminal.session.created.v2` | session/task/profile/backend/safe title |
| `acorn.terminal.session.state-changed.v2` | running/exited, exit code class, times |
| `acorn.terminal.session.agent-state-changed.v2` | prior/new heuristic state, `terminal-screen` authority |
| `acorn.terminal.session.controller-changed.v2` | lineage and controller relation, authorized IDs |
| `acorn.terminal.session.removed.v2` | session tombstone/reason |
| `acorn.terminal.profile.health-changed.v2` | profile availability/compatibility/tmux degradation |
| `acorn.terminal.pending-send.discarded.v2` | session, count, safe reason |

`CUR-TERM-088` Terminal output/input, framebuffer, ring tail, command text, environment, screen
title sequences, and host paths MUST NOT be product-event payloads. Consumers query metadata and
attach an authorized ephemeral stream.

`CUR-TERM-089` State events commit with session metadata/outbox. High-frequency output and resize
produce no durable event. Heuristic state events are edge-triggered and rate-limited.

## Stream protocol

Terminal multiplexes these frames over the one authenticated Node WebSocket:

| Frame | Direction | Required fields/behavior |
| --- | --- | --- |
| `terminal.open` | Client → Node | session, view session, desired dimensions, last attachment generation |
| `terminal.ready` | Node → Client | safe session snapshot, replayed-screen boolean, stream sequence/credit |
| `terminal.output` | Node → Client | session, stream sequence, ≤256 KiB bytes/chunk |
| `terminal.input` | Client → Node | session, input sequence, ≤64 KiB bytes/frame |
| `terminal.resize` | Client → Node | session, generation, rows/cols |
| `terminal.credit` | Client → Node | consumed bytes/window |
| `terminal.exit` | Node → Client | exit code/signal class |
| `terminal.error` | Node → Client | stable redacted code/message |
| `terminal.close` | either | reason/final sequence |

`CUR-TERM-090` An open authorizes Node/device/task/session/read-output at that moment and binds the
stream to Client/view/session generations. Input and resize reauthorize separately and are rejected
on stale generation, revoked grant, wrong task, exited session, or lost controller.

`CUR-TERM-091` The Node applies backpressure. A Client exceeding credit, 8 MiB queued output, or 30
seconds paused is disconnected from the stream without killing the terminal. Reattach restores the
current canonical screen, not missing raw history.

`CUR-TERM-092` Terminal input is never retried automatically or buffered by Electron across socket
failure. Duplicate input sequence is rejected/deduplicated only within the live stream generation;
Acorn never claims exactly-once PTY input after ambiguous disconnection.

## Security

`CUR-TERM-093` Terminal is an intentional code-execution surface. Pairing owner authority alone
does not grant a plugin terminal input or process launch. Shell/profile launch, input, signal and
terminate are explicit capabilities with high-risk audit.

`CUR-TERM-094` Process launch uses argv and profile grammar. Shell evaluation is permitted only
inside the explicitly approved shell profile or a core-authorized repository command; it is never
introduced by concatenating plugin/client data.

`CUR-TERM-095` The Node opens the task root descriptor, derives the working directory and verifies
repository trust before PTY creation. Absolute paths, `..`, symlink/junction escape, deleted/reused
task roots, and cross-Node resource IDs fail closed.

`CUR-TERM-096` Environment construction is allowlist-only. Plugin manifests and repository config
cannot request ambient environment inheritance; secret use occurs through purpose-bound broker
operations rather than variables whenever possible.

`CUR-TERM-097` Terminal escape/control parsing disables host-changing OSC and device-control
sequences. xterm/serialization libraries are treated as an attack surface and covered by fuzzing,
dependency review, frame bounds and renderer process isolation.

`CUR-TERM-098` Input/paste validation bounds bytes, strips embedded bracketed-paste end/start
markers for mediated send, distinguishes raw interactive keystrokes from plugin-mediated send, and
requires a host gesture for protected paste.

`CUR-TERM-099` Read-output authority can expose credentials printed by user programs. The UI and
permission prompt MUST state this. Output is never copied into logs, crash reports, analytics,
events, notifications, context, or another plugin without a separate explicit operation.

`CUR-TERM-100` Tmux interaction uses exact Acorn-owned names and argv-only commands; it rejects
server/socket/session names from clients/plugins and never attaches to non-Acorn sessions.

`CUR-TERM-101` Audit records contain actor/caller, session/task/profile, operation, byte count,
process outcome and grant version. They exclude output/input, raw command, arguments, environment,
working path, terminal title and secrets.

`CUR-TERM-102` Security conformance covers command/argument injection, environment leakage,
wrong-task/session access, symlink/root replacement, terminal escape sequences, bracketed-paste
injection, duplicate/ambiguous input, output backpressure, controller race, stale view generation,
tmux namespace collision, revocation, and hostile framebuffer serialization.

## Removed/moved V1 contracts

`CUR-TERM-103` The following V1 Terminal operations move to core: checkout get/set, worktree status/
create/adopt/remove, task created/archive, repository config/run-target updates, captured command
create/get/cancel, and run-target list/get/start/stop/restart.

`CUR-TERM-104` MCP inspect/starter moves to the core Agent Tools/MCP service. Preview URL resolution
moves to Preview. Setup/teardown triggers and task context seeding are core lifecycle orchestration
with declared plugin concerns.

`CUR-TERM-105` V1 `/api/terminal/*`, `/api/tasks/:id/{preview-url,on-created,use-checkout,archive,mcp}`,
`/api/v1/plugins/terminal/*`, and terminal public WebSocket channels are replaced by the V2 owner
contracts. No V1 path/token/payload compatibility remains.
