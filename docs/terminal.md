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
`/v1/events` socket and terminal routes.

Reattach order is reset/framebuffer, buffered output produced during serialization, then live output.
Raw output is not replayed as screen history. A lost stream does not imply the process died.

A `term:attach` frame can carry the viewer's `cols` and `rows`. The Node resizes the PTY and the
screen before it takes the snapshot, so a surface attaches in one message instead of posting a resize
and waiting for it. The field is optional in both directions. A frame without it attaches at the
session's last size, and a Node that predates it ignores it. The drawer surface covers the second case
by comparing the size in `ready` with its own and posting a resize when they differ.

The Node batches PTY output before it goes over the wire: buffered bytes flush as one `output` frame
roughly every 16 milliseconds (about one frame at 60 frames per second) instead of one frame per PTY
chunk, so a busy TUI does not send a frame for every keystroke echo.

An agent PTY exit emits `plugin:terminal:completed` with task and session IDs, exit code, and time.
Output stays behind `terminal.reviewInput.v1`: at most 256 snapshots of 16 KiB are retained for
60 seconds. A removed, expired, evicted, or pre-restart snapshot reads as unavailable. Task archive
uses a separate awaited hook. Terminal gathers bounded PTY output and Git diff before teardown, then
runs `terminal:archive-review` with task and session identities; Findings formats the observation.

## The screen, and who pays for it

**There is an emulator only while an attach is restoring a screen.** The canonical screen is a real
terminal framebuffer on the node — `@xterm/headless` with a thousand lines of scrollback — because a
pseudo-terminal's output is a sequence of cursor operations rather than a screen that can be replayed
from an arbitrary offset. An attach builds one, replays the session's raw ring into it, and serializes
it; once no attach is waiting for a snapshot, the emulator goes, however many clients stay attached.
An attached client does not need the node's screen, because it has every byte in its own. So a session
costs the node its ring and nothing else, whether anybody is attached or not.

It used to run from the moment the session was spawned, for every session, and the only thing that ever
read it was an attach. So a background build paid continuous ANSI parsing to produce a screen that
might never be asked for: a megabyte of a build's output is 45 to 120 ms of the node's CPU to parse,
spread over about a third of a second, against 1 to 2 ms to keep the ring alone. After that it ran while anybody was attached, which stopped being a bound when
the desktop started keeping every open tab attached (§ Client): every tab a reader had opened would
have kept a parser running on the node, on top of the one in the reader's own xterm.

**The price is scrollback, and it is deliberate.** An attach can only rebuild from what the ring still
holds, so history older than 256 KB is gone and an alternate-screen program whose state depends on
older bytes redraws from its next output. If a class of session turns up where the full history
matters, the answer is a bigger ring for that class, not a parser running for ever.
What an attach pays instead is a rebuild of 15 to 25 ms from a full ring. The desktop pays it once per
tab and again after a reconnect, since its tabs stay attached.

**The ring is a list of chunks, not a string.** 256 KB of recent raw output, kept as the buffers it
arrived in with a running byte count, dropping from the head once the budget is spent. It used to be
one string rebuilt as `ring = trim(ring + chunk)` on every chunk the pseudo-terminal produced, which
copies the whole buffer per chunk to serve readers that want the last four or ten kilobytes of it. A
reader concatenates only the tail it asks for, and `tail` joins the buffers before decoding, so a
character split by a chunk boundary still reads back whole. Two things read it besides the attach
rebuild: the blocked-prompt scan over the last 4,000 bytes and the transcript tail over the last
10,000. Both are heuristics over recent output, and both now count in bytes where they used to count
in UTF-16 code units.

**Output crosses the wire as bytes.** `term:out` is the one channel on the authenticated socket that is
not JSON. A frame is a fixed-width session id and then the pseudo-terminal's bytes verbatim
(`packages/protocol/src/transport/ws.ts` § The one binary frame), built once per broadcast rather than once per
attached socket, and forwarded through the desktop broker without being read. The ids are UUIDs; an id
that does not fit the field falls back to the JSON frame, so a stream owner with a different naming
scheme still works. A binary frame carries no `seq` and consumes none, because sequence numbers belong
to the invalidation channel and output has never been part of it. `ready`, `exit` and `error` carry a
session object rather than bytes and stay JSON.

The client-core socket owns node filtering and WebSocket envelope dispatch. Terminal registers the
`term:out` and binary PTY handlers, validates JSON payloads, and owns attach, detach, and input for
the active Node. Its session store fetches the roster and registers a small summary and action source
with the compiled client host. The host's send picker, task rail, and quit prompt use those summaries;
the drawer keeps the full rows and active tab. `term:status` remains a generic chrome invalidation
handled by client-core.

Every session, terminal or managed, reports its state from one shared vocabulary, `AgentState`
(`packages/protocol/src/agents/sessionActivity.ts`): `starting`, `working`, `waiting`, `idle`, and `blocked`. Every
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

Terminal reads `terminal:launch-context` contributions in their registered order and applies one
16 KiB byte budget across them before queuing text. Memory contributes the task and memory block
through that point.

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

A declared run target has one more lifecycle reduction: `run:changed { taskId, targetId, running }`.
The runtime keeps a reverse session-to-target index, so the authoritative PTY exit removes the live
target instance and publishes `running: false` even when nobody pressed Stop. Explicit stop removes
the index first, which suppresses a duplicate frame from the PTY's later exit callback. This remains
strictly about declared targets; arbitrary processes and ports do not become broadcast events.

The run buttons in a task's pane switcher read the targets through the query cache, keyed
`['run-targets', taskId]` (`packages/client-core/src/infra/queries.ts`). A visit draws the cached
list and asks the node again once the entry is older than the shell's 30-second stale time.
`run:changed` refreshes that task's entry, so a target started from the palette or by an agent, or
one that exits, flips its button without a revisit. `project:changed` refreshes every entry, because
the project row carries the dev script and the run-target list.

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

## Workflow steps

This plugin contributes two step kinds to `workflows:step-kind`
([workflows.md](./workflows.md) § Contributed step kinds), because the process broker's environment
rules, the checkout resolution, and the run-target service all live here.

**`terminal:command`** runs one command as `/bin/sh -c` in the task's checkout, through
`core.proc.runProcess` with the environment `buildSessionEnv` assembles. Its fields are `command`
(required), `timeoutMs` (1,000 to 600,000, default 120,000), `allowFailure`, and `env`, which takes
one `KEY=value` per line. A workflow file is committed, so a secret does not belong in `env`.

The output is `{ exitCode, stdout, stderr, truncated }`, and stdout also becomes the step's handoff
note. Chunks stream out through `emit` as `stdout` and `stderr` events while the command runs, over
the optional `onStdout` and `onStderr` callbacks on `ProcSpec`, so a reader watches a tail without
the step holding a PTY. A non-zero exit fails the step unless `allowFailure` is set, in which case
the exit code is an answer a later `decide` can branch on. A timeout fails the step; an abort cancels
it.

It captures rather than opening a terminal on purpose. Reading clean stdout out of a PTY is lossy,
and a headless node with nobody attached would still have to hold the terminal open.

**`terminal:run-target`** starts one of the project's declared run targets as a step of its own, so a
later step can wait on it. Its fields are `target`, whose choices come from
`GET /v1/p/terminal/tasks/:taskId/run-targets`, and `waitForUrl`, which is on by default and gives
the target 60 seconds to report a URL. The output is `{ targetId, sessionId, url }`. The same
repo-config trust gate applies, because it is `RuntimeService.start` underneath.

Both kinds are written against a local mirror of the workflows contribution type in
`plugins/terminal/src/contract/workflowSteps.ts`, and name the point by its string. Importing
`@acorn/plugin-workflows` here would make the workspace package graph cyclic: workflows already
depends on this package, directly and through the agents plugin. A test in the workflows plugin holds
the mirror against the real type.

## Profiles

Claude, Codex, and Aider launch specifications are registered by literal in
`plugins/agents/src/node/index.ts`. Claude and Codex support interactive and headless modes where the
provider supports them. Aider is interactive. Argument grammars prevent callers from appending uncontrolled flags. Codex output
schemas are created and deleted by core on every execution path.

Profiles are separate from the managed-agent drivers. A raw terminal can work without a managed
session, and a managed session can use a provider driver without owning a terminal tab.

The node lists profiles by running `which` for tmux and each agent CLI, which blocks its event loop
for about 20 ms. The terminal drawer therefore reads the list through the query cache with a
five-minute stale time. Nothing reports a CLI landing on `PATH`, so a newly installed one appears
within five minutes or on reload.

## Handoff

The agents plugin owns the managed session. Terminal publishes a narrow session-roster and handoff
capability. Handoff transfers an exclusive controller lease. The managed composer is disabled while a
raw TUI owns input. Returning to managed mode requires the linked terminal process to exit first;
the Node then restores the managed provider session from its resumable reference.

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

**A terminal tab stays alive until it is closed.** Its xterm and its attachment last from the first
frame the tab is shown until its session leaves the roster: the tab closed, the session removed or
killed from anywhere, its task archived, or the node switched. Output that arrives while the reader is
on another task keeps being parsed into it, so it is current when they come back, and coming back
draws it where it was, with no new xterm, no `term:attach`, and no screen for the node to rebuild. A
roster read that fails keeps every terminal; only a roster the node answered with lets one go.

Terminals are the exception to the rule that a pane's view does not outlive its task
([panes.md](./panes.md) § Layout model), for three reasons. A terminal is a running program the reader
expects to keep running, as it would in any terminal application. Its state is the emulator's own
buffer, not a query the cache can hand back, so there is nothing cheaper to rebuild it from than the
node's ring, and that rebuild loses scrollback. And rebuilding was the expensive part of going back
to a task: a fresh xterm, a WebGL context, an attach, a rebuild on the node and a parse of the whole
screen.

Inside the drawer, every open session gets a surface and all but one is hidden, so switching tabs is a
repaint. Across tasks the drawer itself unmounts, because its open state is per task. So the xterms
do not belong to the drawer. A module-level map, keyed by node and session
(`plugins/terminal/src/client/heldTerminals.ts`), holds each one, and a surface lends it an element
while it is drawn (`liveXterm.ts`). xterm opens once, so a move is its element changing parents, and a
terminal nobody draws is out of the document entirely. It keeps no reference into a view that has gone,
and xterm's renderer pauses while it is out of view.

What that costs is the parse, one xterm per open tab, and a bound on the GPU. The parse runs in the
renderer at the rate the program writes, and a terminal out of the document pays it without the paint:
about 20 ms per megabyte of coloured output in Chromium, against about 25 ms for one on screen, with
WebKit not yet measured. A WebKit page gets 16 live WebGL contexts and
loses the oldest past that, so only the four terminals shown most recently keep a WebGL renderer. The
rest fall back to the DOM renderer while nobody is looking and take a context again when they are
shown. A lost context, from sleep or a GPU reset, falls back the same way and asks again on the next
show.

Two details hold the drawer up. A surface builds its xterm on the first frame it is actually shown on,
not when it mounts: a tab nobody has opened costs nothing, and xterm measures its cell size from a
laid-out box, which a hidden one is not. And the list iterates the session ids rather than the session
rows. The roster is replaced wholesale on every refresh, so `<For>` over the rows would rebuild every
surface, and `<Index>` would key by position and hand a closed tab's box to whichever session moved up
into its place.

Inside the drawer, everything is a kit node. `DocumentTabs` draws the session strip and carries the
profile `Menu`, the "+" and the close control in its actions slot. `SplitHandle` is the resize grip.
The session itself is a `Rectangle kind="pty"`: the kit owns the box and the keyboard contract, so a
reader who tabs into a terminal can press Escape to get back out, and xterm owns the pixels.

**A `pty` rectangle in a terminal is native**, and it is the one thing the terminal client does better
than the desktop app. Instead of a terminal emulator written in JavaScript running in a browser
running in an app, `apps/tui/src/kit/rectangle.tsx` draws `@xterm/headless` in cells and the
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
on the DOM and `@xterm/headless` in cells — the same parser either way — and the caller's source is
the same file either way.

That is what let two of the three callers cross. Docker's exec panel and the editor's `$EDITOR` window
are both throwaway PTYs, both about fifteen lines now, and both work on a host with no browser in it.
The terminal plugin's own desktop drawer surface keeps its own xterm, because it is not throwaway: it carries
the app's theme, the font-size preference, the WebGL renderer and the Shift+Enter rule, and none of
those has a meaning in cells. The terminal client presents the same Node sessions in its own cell
view, described below ([tui.md](./tui.md) § Chrome).

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

### Native terminal client sessions

The terminal client opens a task-scoped Sessions view from the task or palette. Terminal's activated
session store remains the roster, and its existing HTTP verbs and `term` WebSocket channel remain the
transport. The host renders a session picker, available profile choices, and one native `pty`
rectangle. A new session starts in the task worktree as it does in the desktop drawer. Closing the
view detaches the display and leaves the Node session running; reopening restores the task's last
selected session. Resize travels from the rectangle to the Node. Enter gives the PTY the keyboard,
Escape returns to the view, and `Ctrl+C` belongs to the PTY while entered.

An agent handoff uses the same session row, including its managed-session lineage. The view can end
the provider terminal with a second Enter confirmation and then return input control to managed mode.
Return is disabled while the linked PTY is running, matching the Node's controller lease rule. The
host calls the Agents plugin's public handoff client contract to update its session store after the
Node accepts the transition.
`plugins/terminal/src/contract/hostClient.ts` exposes Terminal's transport and roster to this host;
other plugins keep using the narrower `sessionsClient.ts` contract.

## From the command palette

Three searches under a **Run** group, registered by this plugin's client half
(`plugins/terminal/src/client/commands.ts`).
[command-palette-and-shortcuts.md](./command-palette-and-shortcuts.md) covers how the palette runs a
search, and [plugins.md](./plugins.md) § Command kinds holds the vocabulary.

| Row | What it finds | What picking one does |
| --- | --- | --- |
| Run a target | the run targets in the task's repository configuration, matched on the target's id and on the command line it runs | starts the target and opens the drawer, or stops it when it is already running |
| Apply a layout | the layout recipes the same configuration names | replaces the task's pane layout, starts the recipe's target, and points the browser pane at a target's resolved URL when the recipe names one |
| Focus a terminal | the sessions alive in this task, an exited one badged | shows the drawer, makes that tab the task's active one, and asks it for the keyboard |

The group is this plugin's own, `terminal.run`, rather than core's `Terminal` group, which is the
drawer toggle and a plain shell and belongs to the shell (`apps/desktop/src/client/TaskView.tsx`): a
plugin may not hang a command under another owner's group. All three rows are task-scoped and gated on
the terminal plugin, so a palette opened over a browse source, or over a node that runs no terminals,
does not offer them. A parse error in the repository configuration is a badged row at the top of the
list rather than a row that is quietly missing, and Enter on it restates the message and stays.

**One read when the frame opens, filtered on the device after that.** The rows are one read of the
task's configuration plus one signal this window already holds, so there is nothing for a debounce to
wait for. The shared adapter is `client-core/host/registries/commands/localSearch.ts`: no debounce, no
minimum query — an empty query is the whole list — and one fetch that the target frame and the layout
frame both read, because they come out of the same answer. Focusing a terminal fetches nothing at all;
the session roster is a signal the window already keeps in step with the node. The rows are held for as
long as that palette session is open, so an edit to the configuration shows up the next time the
palette is opened, which is what the row source these replaced did too.

**Nothing about launching changed.** Picking a target decides run or stop against this session's own
fetch rather than the label the row was drawn with, so a target started from the drawer since the frame
opened is stopped rather than started a second time. Starting opens the drawer, stopping does not, both
refresh the session roster, and a node that refuses either reports its own reason with the frame still
open. Those are the calls and the error copy the row source had.

**The terminal's own preferences are still a page.** What the terminal button opens into, the terminal
text size, and whether a new agent session is sent the task's startup context are not setting commands.
On the desktop the palette reaches them through the **Settings → Terminal** row core generates from the
settings registry, and that row opens the page rather than editing a value in the frame. Each of the
three has one reader and one writer in `plugins/terminal/src/client/terminalPrefs.ts`, and the page and
the drawer both call them, so the value has a single persistence path and a setting command registered
later cannot become a second one.

**Creating a terminal was already a command before this group existed.** The shell owns
`task.terminal.new-shell` under its own Terminal group, and the agents plugin owns the two harness
profiles, `task.terminal.new-claude` and `task.terminal.new-codex`
(`plugins/agents/src/client/terminalProfileCommands.ts`), because the profile ids are that plugin's.
Registering either of them here would have put two rows carrying the same words in the palette root, so
this group holds neither.

Killing a session and bulk session management stay in the drawer, where the tab strip says what is
running and the close control sits beside it. A palette row has neither of those in front of it.
