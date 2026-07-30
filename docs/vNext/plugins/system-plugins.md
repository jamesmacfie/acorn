# System plugins

Status: Normative<br>
Requirement prefix: `PLUG-SYS`

System plugins are release-signed Acorn features that require core-adjacent authority or performance
and whose absence would make Acorn cease to be Acorn. V2 system plugins are GitHub, Terminal and
Agents. Their product specifications live under [`current-plugins`](../current-plugins/README.md).

## Boundary

- **PLUG-SYS-001:** Only an Acorn release manifest may name runtime `system`; marketplaces and
  Developer Source cannot install or override a system plugin.
- **PLUG-SYS-002:** A system plugin MUST use the same public resource, command, event, settings,
  lifecycle and UI contribution contracts as external plugins wherever those contracts can express
  its behavior.
- **PLUG-SYS-003:** Each privileged internal interface MUST be named, versioned, dependency-injected,
  minimal, testable, and listed in that plugin's specification. Importing arbitrary core internals is
  non-conforming.
- **PLUG-SYS-004:** System status does not waive authorization, schema validation, audit, secret
  redaction, lifecycle health, failure containment or UI sandbox rules.
- **PLUG-SYS-005:** System plugins are upgraded atomically with the Acorn release. They MUST NOT be
  independently downgraded, deleted, replaced, or sourced from a marketplace.

## Core versus system ownership

Core owns transport, identity, pairing, authorization, capability brokerage, plugin lifecycle,
storage isolation, event log, scheduling, audit, workspaces, tasks, resource identity, safe process
primitives, repository/worktree primitives, file primitives, settings host and Electron shell.

| Plugin | Owns | Delegates to core |
| --- | --- | --- |
| GitHub | GitHub provider model, OAuth/device setup, mirror/reconciliation, PR/review/check UI and commands | Acorn identity, tasks/workspaces, secret vault, HTTP broker, Git/worktree primitives |
| Terminal | terminal profiles, sessions, tmux semantics, terminal contribution and contextual snapshots | PTY primitive, process policy, executable resolution, working-directory authorization, resource limits |
| Agents | agent sessions, provider adapters, normalized transcript, tool/approval workflow, Agent Center, usage and pricing | process/PTY primitives, secret broker, task resources, event log, file/Git/terminal capability checks |

- **PLUG-SYS-006:** GitHub identity MUST be an integration identity and MUST NOT authenticate the
  owner to Acorn or identify a paired client.
- **PLUG-SYS-007:** Terminal MUST relinquish generic process spawn, file access, repository config
  trust, Git/worktree ownership and OS sandbox policy to core. It consumes task-scoped primitives.
- **PLUG-SYS-008:** Agents MUST not inherit Terminal, Editor, GitHub, file, Git or provider
  authority. Every tool operation is a delegated capability checked for the owner, agent session,
  plugin and task.
- **PLUG-SYS-009:** A system plugin MAY export public capabilities to other plugins. Calls traverse
  the same broker and preserve caller identity; there is no trusted fast path that widens authority.

## Availability and recovery

- **PLUG-SYS-010:** The default installation profile MUST activate all three system plugins. A
  startup failure puts the affected feature into a recoverable degraded state and does not prevent
  the shell from opening.
- **PLUG-SYS-011:** An owner MAY disable provider connectivity and agent execution, but cannot
  uninstall their system package separately from Acorn. Terminal may be administratively disabled
  while the Node retains safe process primitives for other verified consumers.
- **PLUG-SYS-012:** System plugin storage has the same per-plugin database boundary and backup
  record as external plugins. Core metadata may reference its resource IDs but MUST NOT copy opaque
  plugin rows into core tables.
- **PLUG-SYS-013:** Release rollback MUST restore a compatible system-plugin code set and database
  snapshot. Irreversible system-plugin migrations block automatic rollback and therefore MUST be
  prohibited inside a rollback-supported release window.

## Conformance

- **PLUG-SYS-014:** Boundary tests MUST reject imports from system plugin implementation code into
  core and direct imports between system plugins except through explicitly approved composition
  adapters.
- **PLUG-SYS-015:** Parity tests MUST run with each system plugin fault-injected at startup,
  command execution, event emission and shutdown to prove shell survival and actionable recovery.
