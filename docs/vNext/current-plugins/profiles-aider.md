# Aider executable-profile migration

Status: **Normative**<br>
Coordinate: `acorn/profile-aider`<br>
Requirement prefix: `CUR-AIDER`

## 1. Current behavior and authoritative state

V1 contributes one immutable agent-profile descriptor: ID `aider`, label `Aider`, command `aider`,
kind `agent`, transport `pty` and preferred backend `tmux`. Core probes `PATH`, lists it only as
available when resolvable, launches it in the Task worktree and warns when missing tmux causes
non-durable `node-pty` fallback. The profile does not install Aider and owns no headless mode,
resume adapter, managed agent driver, route, database, settings or event.

- **CUR-AIDER-001:** The user-installed Aider executable and its own files/configuration are
  external authority. Acorn owns only the profile declaration, execution request and
  Terminal-owned session record.
- **CUR-AIDER-002:** Installing this plugin MUST NOT download, install, update or invoke a package
  manager for Aider.

## 2. Current UI, routes, events, contributions, and dependencies

The descriptor appears in Terminal’s new-session profile menu. Terminal owns launch, xterm
rendering, detach/reattach, backend selection, resize, input, exit state and Task archive guard.
There is no Aider-specific pane, route, keybinding, setup modal or durable event. Application
composition imports and registers the descriptor into core’s profile registry.

V1 availability uses `which` on every listing/launch and shares Terminal’s missing-executable and
tmux-warning presentation.

## 3. Target V2 classification and trust/runtime tier

- **CUR-AIDER-003:** Aider is an **Acorn Verified executable-profile example**, included in the
  default installation profile. The plugin artifact is declarative-only; it references but does not
  contain the external executable.
- **CUR-AIDER-004:** Execution occurs through the Terminal system plugin and Node execution policy.
  It is intentional user-approved terminal code execution, not permission for the profile package
  to run native code during install or lifecycle hooks.

## 4. Node, Electron, native-host, and renderer split

Node core owns executable resolution, working-directory confinement, environment construction and
process-tree policy. Terminal owns PTY/tmux session lifecycle and stream. The profile supplies
validated executable/argument grammar and capability metadata. Electron uses Terminal’s profile
picker, warning/status and terminal renderer. No Aider-specific native host or renderer exists.

- **CUR-AIDER-005:** The descriptor names executable `aider`; commands are argv arrays assembled by
  core and never caller-provided shell strings. Working directory class is `task-worktree`.
- **CUR-AIDER-006:** Path lookup returns executable identity/version evidence, not an arbitrary
  command line. A changed executable path/inode invalidates cached approval before launch.

## 5. Manifest, required capabilities, permissions, dependencies, and optional integrations

The manifest contributes an `agent-executable-profile` with interactive mode, PTY transport,
`tmux` preference, availability/version probe, approved argument grammar and controlled environment
names. It requires `acorn.terminal.profile-contribute/1`, task-worktree resolution and process
launch/PTY grants. It requests no plugin storage, credential, HTTP, arbitrary file, MCP,
headless-generation or bespoke UI grant.

It requires the Terminal system plugin. Agents and Workflows MUST NOT infer managed/headless
support from the `kind: agent` label.

- **CUR-AIDER-007:** Any future headless, resume, MCP, network or credential behavior requires a
  new manifest capability and permission review; it cannot arrive as unconstrained extra args.

## 6. Queries, commands, exported capabilities, events, and streams

`dev.acorn.profile-aider.descriptor.get.v1` returns safe profile metadata and
`availability.get.v1` returns available/unavailable, compatible version evidence and tmux status.
`dev.acorn.profile-aider.session.launch.v1` validates the caller/Task/profile and delegates to
Terminal’s launch command. It exports `dev.acorn.agent-profile.interactive.v1`.

- **CUR-AIDER-008:** Durable lifecycle facts remain Terminal events, including
  `session.requested|started|exited|failed`. Aider emits only
  `dev.acorn.profile-aider.availability.changed.v1`; it MUST NOT duplicate terminal output in
  events.
- **CUR-AIDER-009:** Interactive bytes use Terminal’s authenticated, backpressured stream. The
  profile has no direct stream endpoint and cannot observe/inject bytes outside the delegated
  session.

## 7. UI contributions and renderer requirements

The profile contributes one picker row with label Aider, availability status and tmux durability
warning. Launch uses the standard Task-scoped terminal creation form and `acorn.terminal`
renderer. Missing binary disables launch with installation guidance that does not execute a
command. Missing tmux keeps launch available with the same reduced-persistence warning as V1.

- **CUR-AIDER-010:** Mobile and clients without `acorn.terminal` show the profile/session as
  unsupported and may display status only; they never emulate a PTY or hide the session.

## 8. Storage, migrations, backup, uninstall, and reinstall behavior

The profile owns no database. Core stores installation/grants; Terminal stores sessions and
transcript policy. Availability/version cache is ephemeral and excluded from backup. User Aider
configuration and credentials are neither owned nor backed up by this plugin.

- **CUR-AIDER-011:** V2 imports no V1 profile/session/preference state. Repository configuration may
  be present under the clean-start importer but is not interpreted or executed by this plugin.
- **CUR-AIDER-012:** Disable/uninstall removes future profile choices and leaves active/recorded
  Terminal sessions under Terminal policy. Reinstall performs a fresh executable probe.

## 9. Setup, settings, health, update, and failure behavior

There is no setup wizard or secret. An optional settings page shows resolved executable/version,
backend status and refresh. Health distinguishes missing executable, incompatible version,
worktree unavailable, execution denied, tmux absent and Terminal unavailable. An artifact update is
declarative and cannot change executable name, argument ceiling or environment allowlist without
owner-visible permission review.

- **CUR-AIDER-013:** Launch failure before commit creates no session; failure after Terminal commits
  a session produces an exited/failed session with bounded diagnostic and retry action.
- **CUR-AIDER-014:** Node restart reconciliation follows Terminal semantics: tmux sessions may
  reattach; node-pty sessions become interrupted and are never falsely reported running.

## 10. Security and credential treatment

- **CUR-AIDER-015:** The child receives only Terminal’s documented environment allowlist plus
  owner-approved task context. Acorn service tokens, plugin secrets and unrelated provider
  credentials are removed.
- **CUR-AIDER-016:** Aider may intentionally execute code/read files according to the terminal
  policy and user approval. The UI MUST state this honestly; the profile manifest itself gains no
  ambient authority from the child.
- **CUR-AIDER-017:** Executable resolution, cwd and argv resist path substitution, traversal,
  option injection and symlink races. Audit records executable evidence, Task, owner command and
  result, never terminal contents or environment values.

## 11. Existing coupling that must be removed

Remove application imports/registration of `aiderProfile` and core knowledge of the profile ID.
Replace with manifest discovery and the versioned profile-contribution capability. Keep generic
executable, process, worktree and terminal primitives in Node core/Terminal; no primitive moves
into this plugin.

## 12. Exact fresh-install visual and behavioral parity scenarios

- **CUR-AIDER-018:** With `aider` and tmux installed, the same Aider picker row launches an
  interactive session in the exact Task worktree using durable tmux and standard terminal UI.
- **CUR-AIDER-019:** Missing Aider disables the row with guidance; missing tmux permits node-pty and
  displays the V1-equivalent restart-survival warning.
- **CUR-AIDER-020:** Remote Electron attaches to the Node-owned terminal stream; a client without a
  terminal renderer shows explicit unsupported state while the session remains intact.
