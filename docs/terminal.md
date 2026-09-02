# The terminal plugin

The terminal plugin provides the desktop terminal drawer, task sessions, run targets, provider
profiles, and raw-agent handoff. The Node process broker is the only child-process seam.

Three docs have "terminal" in the name and they are about different things. This one is the
terminal drawer inside the desktop app: a shell, or a provider's own CLI, running raw in a PTY, with
nothing between you and it. [managed-agents.md](./managed-agents.md) is the other way to run the same
providers: acorn drives the session over a protocol, keeps a ledger of every turn, and can replay it.
[tui.md](./tui.md) is neither; it is acorn itself running in a terminal, as a second host beside the
desktop window.

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
(`packages/protocol/src/terminal.ts`): `starting`, `working`, `waiting`, `idle`, and `blocked`. Every
agent surface reuses it verbatim, so no other module redeclares it. A transport reports only the
subset it can detect. A plain PTY session emits `working`, `idle`, `blocked`, or `unknown`, since a
shell has no notion of `starting` or `waiting`. A managed or headless agent driver controls the
process lifecycle, so it reports the full set.

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

Two frames come out of these edges, and the split is about how often each fires.
`terminal:sessions-changed` goes out on every edge, including the working one, which a build's output
crosses repeatedly. Only the session roster hears it. `worktree:status-changed` goes out on the human
edges alone: a session's command going quiet, a session exiting, a setup script finishing. Those are
the moments a `git commit` typed into a shell is done, so that is when the dirty markers are worth
re-reading, and the node drops its coalesced `git status` for the session's directory on the same
edge. A session going from idle to working changes nothing about the files, so it says nothing about
them.

## Backpressure

The node's hub holds one WebSocket per client and stamps a per-connection `seq` on every frame. A gap
in that sequence means loss, and the broker's only remedy is to close the socket and reconnect, which
re-attaches every live terminal and makes the node serialise a framebuffer per session while the
client refetches its active queries.

So the hub does not create gaps. When a socket has buffered more than 4 MiB, the hub asks the engine
to pause the pseudo-terminal behind the frame it is about to send, sends the frame anyway, and resumes
the producer once the buffer falls below half the mark. `pause()` stops node-pty reading the
pseudo-terminal, the kernel's pipe fills, and the program writing into it blocks. That is what "slow
down" means to a build, and it costs nothing: no bytes are dropped, so no screen is corrupted. A
session attached to two clients is paused while either of them is behind, and a socket that dies while
holding a pause releases it, so a session cannot be left paused for ever.

An invalidation ping has no producer to slow down. Those are still shed, and the hub replaces the
first one in a congested window with a `ws:shed` marker that takes the sequence number the shed frame
would have had. Later sheds in the same window consume no sequence number, because one "you are
behind" is the whole message. The broker forwards the marker instead of resetting the socket, and the
renderer answers it the way it answers a reconnect: mark what is on screen stale and let it refetch.

## Process broker

Terminal, agents, workflows, Docker, database helpers, and command variables use CoreServices' process
broker. It enforces task worktree confinement, allowlisted environment variables, process-group
termination, bounded capture, and operation deadlines. Direct `spawn`/`execFile` use is limited to
the reviewed `CHILD_PROCESS_OK` allowlist in `tools/arch/boundaries.test.ts:221`.

Run targets are resolved from trusted `.acorn/config.toml`, repo settings, and task configuration. A
run target is a terminal session; acorn does not allocate or proxy arbitrary ports. Preview uses the
declared target/port configuration and the authenticated tunnel when necessary.

Another plugin gets a turn before a process starts in a task's worktree. `terminal:before-run-target`
runs in `RuntimeService.start`, after the repo-config trust gate and before the session is spawned
(`plugins/terminal/src/server/runtime.ts`); a veto stops the start and the reason reaches the caller with
the vetoing plugin's id in front of it. Observe and veto only, and no transform: the design sketched
one over the target's environment, and a hook payload is scalars and arrays of scalars, so an
environment map is not expressible in the declared vocabulary (`docs/plugins.md` § Hooks).

## Profiles

Claude, Codex, and Aider launch specifications are registered by literal in
`plugins/agents/src/node/index.ts`. Claude and Codex support interactive and headless modes where the
provider supports them. Aider is interactive. Argument grammars prevent callers from appending uncontrolled flags. Codex output
schemas are created and deleted by core on every execution path.

Profiles are separate from the managed-agent drivers. A raw terminal can work without a managed
session, and a managed session can use a provider driver without owning a terminal tab.

## Handoff

The agents plugin owns the managed session. Terminal publishes a narrow session-roster and handoff
capability. Handoff transfers an exclusive controller lease. The managed composer is disabled while a
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
is present. The Agent pane shows managed sessions; the drawer is the home for shells and raw
provider TUIs.

Inside the drawer, everything is a kit node. `DocumentTabs` draws the session strip and carries the
profile `Menu`, the "+" and the close control in its actions slot. `SplitHandle` is the resize grip.
The session itself is a `Rectangle kind="pty"`: the kit owns the box and the keyboard contract, so a
reader who tabs into a terminal can press Escape to get back out, and xterm owns the pixels.

**A `pty` rectangle in a terminal is native**, and it is the one thing the terminal client does better
than the desktop app. Instead of a terminal emulator written in JavaScript running in a browser
running in an app, `apps/tui/src/kit/rectangle.tsx` draws OpenTUI's own emulator in cells and the
PTY's bytes go straight into it. The PTY does not move: it stays on the Node, reached over the same
`term` WebSocket channel, and the terminal client is a second emulator for it.

What the rectangle hands its caller differs, because there is no element to hand over. The DOM hands an
`HTMLElement` and the terminal hands the three operations a terminal is: bytes in, keystrokes out, and
the size of the box in cells. The keyboard contract is the same on both, with one rule the terminal
adds about its own limits. While a rectangle is entered every key is the PTY's, `Ctrl+C` included,
Escape alone leaves, and pressing Escape twice goes back in and sends one through. A desktop reader can
click outside; a terminal reader cannot.

**Neither of those shapes is a plugin's business, and `attachPty` is why.** A `Rectangle` promises the
host draws what is inside the box, and for `pty` the DOM used to keep half of that promise: it handed
back an element and three plugins each built their own xterm on it, with their own theme, their own fit
and their own resize observer. The caller now describes the channel instead, in the four members of
`PtyIo` (`client-core/kit/lib/pty.ts`): open at a size, bytes in, bytes out, and a word to print when
the far end exits. `attachPty(handle, io)` on `@acorn/plugin-api/ui` is the host's end of it, an xterm
on the DOM and OpenTUI's emulator in cells, and the caller's source is the same file either way.

That is what let two of the three callers cross. Docker's exec panel and the editor's `$EDITOR` window
are both throwaway PTYs, both about fifteen lines now, and both work on a host with no browser in it.
The terminal plugin's own drawer surface keeps its own xterm, because it is not throwaway: it carries
the app's theme, the font-size preference, the WebGL renderer and the Shift+Enter rule, and none of
those has a meaning in cells. The drawer has no home on the terminal client anyway, which is the other
half of why it stayed ([tui.md](./tui.md) § Chrome).

**The `$EDITOR` handoff needed nothing built.** The editor pane already has a terminal mode: one device
preference swaps the CodeMirror rectangle for a throwaway PTY running the reader's own editor on the
worktree, and the pane refetches the file when the editor exits ([editor.md](./editor.md) § Editing in
your own editor). On the terminal client that PTY draws in cells, so the reader gets vim inside the
terminal they were already in, and the design's suspend-the-renderer plan was never needed. What the
terminal client draws when the preference is off is the box and a line saying the file opens there;
the read-only text view inside it is not built.

The drawer is a `drawer` slot rather than a pane, so no pane layout owns its outer box. The `Drawer`
host component does. It draws the dock between the two icon rails and above the task footer, and it
takes a height and a maximized flag from the plugin, which owns the resize grip that produced them.
That geometry was the plugin's own stylesheet until phase 9 of the layout programme. Where the rails
are and how tall the top bar is are the shell's facts, and a plugin that writes them down is one
shell change away from being wrong.
