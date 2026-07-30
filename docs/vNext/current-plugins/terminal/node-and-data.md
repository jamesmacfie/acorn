# Terminal Node and data model

**Status:** Normative current-plugin migration<br>
**Requirement prefix:** `CUR-TERM`

## Session resource

An `acorn.terminal.session` resource contains:

| Field | Meaning |
| --- | --- |
| identity | session URI, Node, task URI, creation/revision times |
| profile | coordinate/version/profile ID, title, `shell|agent` kind |
| backend | `pty|tmux`, durability, tmux availability/degradation |
| process | `running|exited`, safe command label, exit code/signal, started/exited times |
| display | bounded rows/columns, attachment generation |
| task projection | repository/pull labels and `isTaskRoot`; derived, non-authoritative |
| agent projection | heuristic state, idle, `terminal-screen` authority |
| lineage | optional managed Agents session URI/controller handoff |

`CUR-TERM-020` The resource MUST NOT expose the raw command, argv, full environment, absolute
working directory unless separately authorized for display, PTY handle, process ID, tmux socket/
server details, internal session name, secret broker handle, or raw output.

`CUR-TERM-021` Rows and columns are integers 1–1,000; creation defaults to 120×40 for protocol
clients and the fitted Electron dimensions for an interactive launch. Resize is rate-limited and
clamped by Node policy.

`CUR-TERM-022` Repository, pull, task-root and managed-session projections are derived from
canonical resource relations on every snapshot/reconciliation. They are never independently
persisted as authority.

## Core PTY contract

`CUR-TERM-023` Terminal requests a PTY through core with a fixed profile coordinate, validated argv,
task-root descriptor, controlled environment, dimensions, resource ceilings, sandbox policy,
durability backend, and cancellation context.

`CUR-TERM-024` Core resolves `$SHELL`/fixed executables and PATH availability, constructs the base
environment, enforces repository config trust, creates the task root where permitted, starts/
signals/terminates the process tree, and returns an opaque PTY handle. Terminal cannot replace the
executable or widen arguments after approval.

`CUR-TERM-025` The controlled environment may include HOME, PATH, SHELL, LANG, locale, USER,
LOGNAME, TMPDIR, TERM, and non-secret Acorn task/session metadata required by the profile. It MUST
exclude Node/client master keys, session keys, marketplace credentials, GitHub/provider secrets,
unrelated integration credentials, and ambient service variables.

`CUR-TERM-026` Task-aware tool access uses audience/task/session/operation-bound broker handles or
an approved MCP registration. V1-style long-lived `ACORN_API_TOKEN` inheritance is prohibited.

## Backends and reconciliation

`CUR-TERM-027` An ephemeral PTY session lives in memory and exits with the Node service. Its
database may retain an exited metadata row only under the declared session-history policy; it
cannot claim to survive restart.

`CUR-TERM-028` A durable tmux session uses an Acorn-namespaced opaque tmux session identity, has its
status bar disabled, and is accessed through a separate attach PTY. Killing an attach detaches;
terminating the Terminal session kills the owned tmux session.

`CUR-TERM-029` Startup reconciliation enumerates only Acorn-owned tmux sessions, intersects them
with persisted rows, reattaches survivors, rebuilds display models, derives task-root state, marks
missing tmux sessions exited/removes stale live rows, and never trusts a stored PID.

`CUR-TERM-030` Archive/delete orchestration waits for Terminal reconciliation before evaluating
running-session guards. Core queries/commands Terminal through its public capability and owns the
final task/worktree mutation.

## Isolated storage

The plugin database contains:

| Table | Purpose |
| --- | --- |
| `p_sessions` | durable/recent session metadata, task/profile/backend/status/dimensions/lineage/times |
| `p_operations` | command IDs, canonical input hashes and terminal outcomes |
| `p_profile_health` | non-secret availability and compatibility cache |
| `p_session_relations` | canonical optional Agents handoff relation |

`CUR-TERM-031` `p_sessions` stores no raw output/input, display snapshot, ring tail, PID, credential,
full environment, arbitrary command, or non-authoritative repository/branch/PR duplication.

`CUR-TERM-032` Running tmux rows are durable plugin data included in encrypted backup metadata only
to explain that live processes cannot be restored from backup. Restoring a backup MUST mark them
stopped/unavailable; it MUST NOT attach to coincidentally named host tmux sessions.

`CUR-TERM-033` Exited session metadata is retained until explicit tab removal or the configured
30-day maximum, whichever comes first. Removing a row is idempotent and releases display/PTY/tmux
resources before database deletion.

## Display and output pipeline

`CUR-TERM-034` PTY output appends to the 256 KiB byte-bounded tail, updates the 1,000-line headless
terminal, drives heuristic state, and is coalesced for live transport over an approximately 16 ms
window without changing byte order.

`CUR-TERM-035` Attach ordering is `ready metadata → terminal reset and serialized canonical
framebuffer when present → buffered concurrent live bytes → live stream`. Serialization is an
ordering barrier. Detach during serialization cancels that attachment without killing the session.

`CUR-TERM-036` The canonical framebuffer preserves cursor addressing, alternate screen, styles and
the current screen; a raw byte tail MUST NOT be replayed as screen history.

`CUR-TERM-037` Display parsing disables OSC clipboard, file transfer, notifications, arbitrary
hyperlinks/window control and other host effects. Link-looking content is inert unless Electron
creates a validated host navigation intent.

## Raw-agent state and send semantics

`CUR-TERM-038` Shell profiles always report heuristic agent state `unknown`. Agent profiles become
`working` on output, `idle` after the configured silence edge, `blocked` only when the bounded
tail matches an approved prompt pattern, and `done` on exit.

`CUR-TERM-039` The blocked heuristic strips ANSI/spinners, inspects at most the last 12 non-empty
lines, recognizes the bounded prompt catalog, and has no security meaning. A false positive affects
only presentation/attention.

`CUR-TERM-040` Restricted cross-plugin send accepts at most 1 MiB text and mode `draft`, `now`, or
`after-ready`. Embedded bracketed-paste markers are stripped, trailing whitespace normalized, and
the payload is wrapped as one bracketed-paste block.

`CUR-TERM-041` `draft` writes without submission; `now` writes plus carriage-return submission;
`after-ready` sends immediately if heuristically idle or queues until the next busy-to-idle edge.
Queued sends are memory-only, bounded per session, visible as pending, and discarded on exit,
revocation, disconnect policy, or session removal.

`CUR-TERM-042` Cross-plugin send and controller handoff use separate capabilities. A caller allowed
to draft text is not allowed to send raw input, signal, terminate, attach arbitrary output, or
claim the controller.

## Profile discovery and settings

`CUR-TERM-043` Profile list returns stable ID/coordinate/version, label, `shell|agent`, availability,
backend preference, durability, missing-tmux warning, and declared features. It exposes no host
executable path or raw launch command.

`CUR-TERM-044` The built-in shell is always declared; Claude Code, Codex, and Aider come from their
separate verified profile packages. Missing/disabled/incompatible profile packages do not stop
Terminal.

`CUR-TERM-045` Client-device settings are drawer height, font size and per-task last-active tab.
Node/owner settings are default launch profile, context-injection policy, profile enablement,
durability fallback and session retention.

`CUR-TERM-046` Terminal consumes the core task-context snapshot capability at launch only when
enabled, within size/sensitivity/tool ceilings. It does not import Notes, Memory, Context, GitHub,
or Agents implementations.

`CUR-TERM-047` V2 starts with empty Terminal storage. V1 terminal rows, tmux names, live sessions,
output tails, drawer preferences, repo paths/config, commands, and broker tokens MUST NOT be
imported or attached.

`CUR-TERM-048` Terminal release migrations are reversible with the system-plugin generation.
Because output is non-durable, migration backup covers metadata only and must not create fake
screen history.

`CUR-TERM-049` Health separately reports PTY broker, tmux, profile availability, database/outbox,
and stream service. A missing profile or tmux is degraded capability, not plugin failure.
