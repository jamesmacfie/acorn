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

The Node batches PTY output before it goes over the wire: buffered bytes flush as one `output` frame
roughly every 16 milliseconds (about one frame at 60 frames per second) instead of one frame per PTY
chunk, so a busy TUI does not send a frame for every keystroke echo.

Every session, terminal or managed, reports its state from one shared vocabulary, `AgentState`
(`packages/protocol/src/terminal.ts`): `starting`, `working`, `waiting`, `idle`, and `blocked`. It is
defined once and reused verbatim by every agent surface, so no other module redeclares it. A
transport reports only the subset it can actually detect: a plain PTY session emits
`working`/`idle`/`blocked`/`unknown`, since a shell has no notion of `starting` or `waiting`, while a
managed or headless agent driver, which controls the process's own lifecycle, reports the full set.

## Activity and status

The engine derives status from PTY output rather than by talking to the process. A running agent
counts as idle after `idleMs` (10 seconds by default) with no output. Detection is backend-agnostic:
it watches for silence rather than scraping the transcript. Shells never count as idle, since "waiting
for input" is only a meaningful status for an agent.

A fresh agent session uses a shorter first-idle window, 3 seconds instead of the usual 10. Launch
context (notes, PR, memory; see `docs/notes-and-memory.md` § Context integration) is queued
`after-ready` and delivered on that session's first idle edge, so the usual 10-second "done working"
heuristic would only delay the first prompt. A booting CLI reaches its input prompt in roughly 1 to 2
seconds, so 3 seconds of silence is a safe "boot settled" signal without waiting out the longer
mid-session window.

A separate "blocked" status looks for a prompt the agent is waiting on. It scans the last 12 lines of
recent output, with ANSI codes and spinner frames stripped, for known confirmation patterns (`(y/n)`,
`[y/n]`, "do you want to proceed", "press enter") or a trailing `?` on the last line only, so a
question that has already scrolled past does not count.

`resolveBackend` degrades a profile's `tmux` preference to `node-pty` whenever tmux is not installed,
so durable mode is simply unavailable rather than a launch failure.

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

## Sending text to an agent

`sendToAgent` is the one delivery primitive for pushing text into an agent's pseudo-terminal. Review
notes, "add file/line to agent", and the context assembler (`docs/notes-and-memory.md` § Context
integration) all go through it rather than writing to a PTY directly.

Text is wrapped as one bracketed-paste block, so a multi-line prompt reaches the agent TUI as a single
paste rather than as lines submitted one at a time.

Three submit modes control what happens after the paste:

- `now`: submit (`\r`) after a short settle delay, regardless of session state.
- `after-ready`: submit immediately if the session is idle, otherwise queue the block and submit it on
  the next busy-to-idle edge.
- `draft`: paste only. The human reviews the text and presses enter themselves.

Other plugins reach it through the `terminal.sendToAgent` capability (`docs/plugins.md` § Collaboration
rules), never by importing the engine.

## Client

The terminal drawer is a bottom task surface with tabs, task-local last-active selection, profile
launchers, status badges, and xterm rendering. It is available when the desktop terminal capability
is present. The Agent pane shows managed sessions; the drawer remains the home for shells and raw
provider TUIs.
