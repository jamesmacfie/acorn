# Terminal system plugin

**Status:** Normative current-plugin migration<br>
**Coordinate:** `acorn/terminal`<br>
**Distribution:** System; release-signed, version-locked, installed by the default profile<br>
**Runtime:** In-process system service on the Node plus bundled Electron terminal renderer/contributions<br>
**Requirement prefix:** `CUR-TERM`

Terminal owns task-scoped interactive terminal sessions, terminal profiles, durable tmux attachment
semantics, bounded display restoration, raw-agent status heuristics, and the terminal drawer. It
does not own generic process execution, worktrees, repository mappings/configuration, file or Git
access, task archive, setup/teardown policy, run targets, preview scripts, or MCP configuration.

This specification is divided into:

- [Node and data](./node-and-data.md)
- [Client and UI](./client-and-ui.md)
- [Contracts, events, and security](./contracts-events-and-security.md)
- [Migration and parity](./migration-and-parity.md)

The mandatory twelve-section template is distributed without omission: sections 1–3 and 9 are in
this overview; sections 4 and 8 are in Node/data plus Client/UI; sections 5–6 and 10 are in
Contracts/events/security; section 7 is in Client/UI; and sections 11–12 are in Migration/parity.

## Current behavior

V1 runs shell and raw agent profiles in a task worktree through `node-pty` or tmux. Shell defaults
to ephemeral `node-pty`; Claude Code, Codex, and Aider prefer durable tmux and degrade when tmux is
missing. The service keeps an in-memory session map, persists tmux metadata, reconciles tmux on
restart, tracks a bounded raw tail and headless terminal framebuffer, coalesces output, derives
heuristic raw-agent state, and exposes request control plus WebSocket streams.

The Client provides a task-scoped bottom drawer, tabs, profile menu, repository-path setup prompt,
xterm surface, resizing, font and default-profile settings, task/session restoration, status
badges, Ctrl-C, send-to-agent, shortcuts, topbar toggle, maximization, and terminal focus intents.
V1 Terminal routes also expose generic repository, worktree, run, process, task lifecycle, preview,
and MCP functions that do not belong to Terminal.

`CUR-TERM-001` Every Terminal session MUST belong to exactly one Node task and execute in the
task-root handle resolved by core. A renderer-supplied path, repository name, route, or current
working directory MUST NOT establish session scope.

`CUR-TERM-002` Terminal output is an ephemeral stream and bounded live display aid, not durable
product history. The plugin MUST NOT persist raw PTY bytes, terminal input, scrollback, or
framebuffer snapshots to its database, event log, Client cache, diagnostics, or backup.

`CUR-TERM-003` Detaching Electron, changing tabs, reloading the window, or losing the network
connection does not kill a session. Explicit terminate/remove, process exit, Node shutdown policy,
task archive orchestration, or tmux loss controls its lifetime.

`CUR-TERM-004` Raw agent status is heuristic and reports its authority as `terminal-screen`.
Terminal MUST NOT create managed-agent permission requests, transcript facts, or authoritative
working/waiting state from screen parsing.

## Target ownership

| Concern | V2 owner |
| --- | --- |
| Terminal session/profile semantics and tmux reconciliation | Terminal Node service |
| PTY creation, signal, resize, process tree, limits and environment | Node core process broker |
| Task/workspace/repository identity and task root | Node core |
| Checkout mapping, worktree create/adopt/remove and config trust | Node core |
| Task archive/setup/teardown orchestration | Node core with declared plugin concerns |
| Captured noninteractive commands and run targets | Node core execution service |
| Preview URL/script | Preview plugin using core execution |
| MCP inspect/starter | core Agent Tools/MCP service |
| xterm implementation, focus, theme, selection and drawer layout | Electron |
| Managed session state and approvals | Agents plugin |

`CUR-TERM-005` Terminal relinquishes all generic process, file, Git/worktree, repository config,
archive, run-target, preview, and MCP operations listed above. Parity is preserved by their new
owners, not by hidden Terminal forwarding methods.

`CUR-TERM-006` The Terminal runtime receives only task-scoped PTY handles and safe display metadata.
It does not receive raw database handles, absolute roots as authority, Electron objects, arbitrary
spawn, Node environment, or secret values.

`CUR-TERM-007` Terminal MUST operate on bundled and remote Nodes. xterm runs in Electron; PTY/tmux,
display serialization, status, and input authorization run on the owning Node.

## System manifest

The release manifest declares:

- a Node `system` runtime and bundled `acorn.terminal/2` Electron renderer integration;
- a task topbar toggle/shell slot, bottom-drawer task slot, settings page, commands, keybindings,
  status badges, context section, navigation intents, and subscriptions;
- exported session snapshot, focus, controller handoff, and restricted send capabilities;
- required dependencies on core task/process/PTY/event/storage/settings contracts;
- optional profile-package registrations and optional Agents attention/handoff contracts;
- an isolated terminal database and release-coupled migration/health policy.

`CUR-TERM-008` Baseline grants are task read, fixed profile/process operations, PTY
create/read-output/resize, own storage, events, and declared UI. Terminal input, signal/terminate,
shell profile, raw command profile, durable tmux, context injection, and cross-plugin send are
separate operation/policy grants.

`CUR-TERM-009` A profile manifest declares a fixed executable/argv grammar, backend preference,
display label/kind, controlled environment keys, task-root working directory, MCP registration
descriptor, resume/structured capabilities, and availability probe. Terminal MUST NOT infer these
from profile ID.

## Lifecycle

`CUR-TERM-010` Activation opens/migrates isolated storage, detects PTY/tmux fixed capabilities,
loads compatible profiles, reconciles persisted tmux sessions, rebuilds live display models, marks
missing sessions exited/removed according to retention policy, then reports ready.

`CUR-TERM-011` A missing tmux binary degrades affected durable profiles to ephemeral PTY only when
the profile permits it. The profile descriptor and launch UI MUST state that the session will not
survive Node restart before launch.

`CUR-TERM-012` Terminal startup failure leaves Fleet, workspaces, tasks, GitHub review, Editor,
Changes, Notes and managed Agents readable. The toggle/drawer/settings remain as unavailable
placeholders with diagnostics and recovery.

`CUR-TERM-013` Graceful shutdown stops accepting input/creates, detaches/terminates ephemeral PTYs
under core policy, leaves owned tmux sessions intentionally detached, flushes metadata/outbox, and
disposes display buffers. It never persists output to fake restart survival.

## Compatibility invariants

`CUR-TERM-014` Backends are `pty` and `tmux`; the V1 wire name `node-pty` is not a public library
promise. Shell defaults ephemeral and agent profiles may prefer durable tmux.

`CUR-TERM-015` Session state distinguishes process status `running|exited`, heuristic agent state
`starting|working|waiting|idle|blocked|permission|done|unknown`, backend, idle flag, and authority.
Unsupported evidence remains `unknown`.

`CUR-TERM-016` Idle transitions use ten seconds of output silence after first activity; the first
idle may use three seconds. A small prompt heuristic may change idle to blocked. These values are
descriptor/policy-visible and MUST NOT affect authorization.

`CUR-TERM-017` A live display keeps at most a 256 KiB raw tail for heuristic/context use and a
1,000-line canonical headless framebuffer for attach restoration. Tail and framebuffer are
destroyed when the live session is removed.

`CUR-TERM-018` One active input attachment per Client view is not required; multiple authorized
views may read output. Input is serialized by the Node and every writer is independently
authorized. Agents controller handoff adds stricter exclusive-controller semantics.

`CUR-TERM-019` Fresh-install parity and acceptance in
[Migration and parity](./migration-and-parity.md) are release requirements.
