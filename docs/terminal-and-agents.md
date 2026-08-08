# Terminal and agents

The terminal plugin provides the desktop terminal drawer, task sessions, run targets, provider
profiles, and raw-agent handoff. The Node process broker is the only child-process seam.

Worktree creation is a core-owned choke point. When a fresh worktree is created, core resolves the
`core.taskWorktreeCreated` capability supplied by the terminal plugin and the plugin runs the repository
setup action. The capability is per Node runtime and is disposed with the terminal engine; no module-global
callback is shared between boots.

## Sessions

Terminal metadata is stored in `plugins/terminal.sqlite`; PTY output and screen state are runtime
data. Sessions can be ephemeral PTYs or durable tmux-backed sessions. The Node reconciles tmux at
startup, keeps a bounded replay tail, and exposes attach/detach/input/resize/kill over the authenticated
`/v2/events` socket and terminal routes.

Reattach order is reset/framebuffer, buffered output produced during serialization, then live output.
Raw output is not replayed as screen history. A lost stream does not imply the process died.

## Process broker

Terminal, agents, workflows, Docker, database helpers, and command variables use CoreServices' process
broker. It enforces task worktree confinement, allowlisted environment variables, process-group
termination, bounded capture, and operation deadlines. Direct `spawn`/`execFile` use is limited to
the reviewed `CHILD_PROCESS_OK` allowlist in `tools/arch/boundaries.test.ts:221`.

Run targets are resolved from trusted `.acorn/config.toml`, repo settings, and task configuration. A
run target is a terminal session; acorn does not allocate or proxy arbitrary ports. Preview uses the
declared target/port configuration and the authenticated tunnel when necessary.

## Profiles

Claude, Codex, and Aider launch specifications are registered by literal in
`plugins/agents/src/node/index.ts`; the former profile packages were folded into the agents plugin.
Claude and Codex support interactive and headless modes where the provider supports them; Aider is
interactive. Argument grammars prevent callers from appending uncontrolled flags. Codex output
schemas are created and deleted by core on every execution path.

Profiles are separate from the managed-agent drivers. A raw terminal can work without a managed
session, and a managed session can use a provider driver without owning a terminal tab.

## Handoff

The agents plugin owns the managed session. Terminal publishes a narrow session-roster/handoff
capability. Handoff transfers an exclusive controller lease; the managed composer is disabled while a
raw TUI owns input, and resume returns control only after the provider reference is verified.

## Client

The terminal drawer is a bottom task surface with tabs, task-local last-active selection, profile
launchers, status badges, and xterm rendering. It is available when the desktop terminal capability
is present. The Agent pane shows managed sessions; the drawer remains the home for shells and raw
provider TUIs.
