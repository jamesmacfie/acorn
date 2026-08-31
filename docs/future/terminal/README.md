# Terminal: `acorn` in a terminal, drawing the same tree the desktop draws

Status: proposal, 2026-08-30. Nothing here has started. This folder replaces the single file
`docs/future/terminal.md` (deleted the same day; `git log --follow` is the record), which argued that a
terminal client is possible and stopped. This folder is the plan to build one.

The end state is one command, `acorn`, that runs in a terminal against any node and draws the
workspace: the rail, the tasks, every pane that does not need pixels, and the PTY natively. It draws
from the same eight layouts and the same closed kit the desktop uses, so a plugin writes its UI once and
never learns there is a terminal. It ships twice: inside the desktop app beside Tauri and the node, and
as a headless artifact with the node and nothing else.

The layout programme (shipped 2026-08-30) made this cheap without building any of it. Every kit node
carries a `tui` level nothing reads (`packages/client-core/src/kit/tokens/support.ts`), every role token
has a terminal value nothing reads (`packages/client-core/src/kit/tokens/roles.ts`), every layout has a
written terminal projection (`docs/panes.md § Layout model`), the tree protocol names no DOM
(`packages/protocol/src/tree/`), and `@opentui/keymap` ships the terminal adapter we do not use
(`packages/client-core/src/host/keys/install.ts`). What is missing is a host. The terminal host is the strict
one, and building it is the test that the kit is intent and not layout.

Where this folder and an owning doc under `docs/` disagree after a phase ships, the owning doc wins.

## Decisions taken

Decided with the owner on 2026-08-30. A phase file may not reopen them.

| Decision | Why | What it forecloses |
| --- | --- | --- |
| **One tree, two hosts.** No plugin writes terminal-specific UI. A plugin that needs pixels has a rectangle and is absent in the terminal, except the PTY. | The kit is closed so the same source renders twice. A `tui` surface kind would be a third render path and a second thing for every plugin to maintain. | No per-plugin ANSI frame, no `tui` entry in a manifest, no terminal-only node. |
| **The render path mirrors the desktop.** Kit nodes are Solid components on OpenTUI's Solid reconciler. First-party panes run in-process as Solid JSX, as they do on the desktop; loaded plugins run in a Node worker and emit the tree. | The desktop already proves two paths render one kit identically (`packages/client-core/src/host/frames/twoPaths.test.tsx`). Keeping the same two paths keeps that test meaningful and keeps first-party panes out of a build step they do not have today. | A tree-only host. Every first-party plugin would otherwise need the universal transform and lose in-process access to the host. Recorded in [refused.md](./refused.md). |
| **The terminal is the strict host and sets the kit's vocabulary.** A node that cannot be drawn at 80 by 24 in monochrome is a rectangle, not a node. | This was the admission rule while nothing read it. The host that reads it is how the rule stops being a promise. | A ninth layout, a below-80-column story, or a node whose 80×24 sentence is "absent" without a `<Fallback>`. |
| **Same bridge, new carrier.** The SDK verbs and the tree protocol stay the single contract; the terminal adds a transport, a sandbox realm, and a cell renderer. | `frames/verbs.ts` and `protocol/src/tree/` are the lists both ends compile against. A second list is a second thing that drifts. | Any terminal-only message on either port. |
| **`acorn` attaches to a running node for its data root, else starts and supervises one.** | One command covers a laptop with the desktop app running, a laptop without it, and a server reached over ssh. The desktop helper already owns the supervise-a-child code and has no shell binding. | A pure client that needs `acorn-node` started first; one node per terminal fighting over the data-root lock. |
| **One runtime.** The TUI runs under the same Node the node runs under. OpenTUI has a `node` export condition and a prebuilt native core per platform. | Two runtimes in one tarball is two things to pin, sign, and prebuild. | Bun as the TUI runtime. |
| **…and that Node is 26.4 or later, started with `--experimental-ffi`.** Found in phase 0, 2026-08-31. OpenTUI reaches its Zig core over `node:ffi`, which does not exist before then. | The decision above still holds — the node needs Node 24 for `node:sqlite` and 26 satisfies that — but the floor moves onto a Current release and an experimental flag. | Running `acorn` on the machine's own Node unless it is 26.4+. The bundled runtime becomes a precondition of the headless artifact rather than a later nicety ([08-deployables.md](./08-deployables.md)). |
| **Isolation before rendering.** The out-of-process sandbox for loaded plugins is designed as rung 2 of `docs/security.md § The containment ladder`, not as a terminal-only invention. | A terminal has no iframe. Its sandbox is a Node worker thread or child process, and that is the same object node-half containment needs. | A third trust tier that wears the frame tier's enforced-permission claims with the node half's disclosed-only weakness. |
| **The toy host goes first, before the PWA.** | `terminal.md` sequenced the PWA first. The toy host is the cheapest test that the kit is intent and not layout, and it is worth having before more panes are written. The PWA does not need it and it does not need the PWA. | Nothing in `remote.md` changes. |

## The files

Supporting documents, readable in any order:

| File | What it holds |
| --- | --- |
| [01-why.md](./01-why.md) | The argument, and what a terminal client gets plugin by plugin. Read this first if you were not in the room. |
| [02-survey.md](./02-survey.md) | Zellij, OpenTUI, Textual, ratatui, VS Code, cmux: one decision taken from each. |
| [03-process-model.md](./03-process-model.md) | The `acorn` command: attach or start, the handshake line, remote pairing, and the TUI as shell and broker in one process. |
| [04-rendering.md](./04-rendering.md) | The kit on OpenTUI: `HOST`, a second `KIT_COMPONENTS`, roles as cells, layouts as projections, rectangles, appearance. |
| [05-keys-and-focus.md](./05-keys-and-focus.md) | The keymap's terminal adapter, focus regions without a DOM, collections, traps, and the Rectangle contract. |
| [06-isolation.md](./06-isolation.md) | Loaded plugins in a worker thread, bundle custody over files, the trust prompt as a tree, and the third column in the trust model. |
| [07-chrome.md](./07-chrome.md) | What the TUI draws itself: rail, topbar, pane row, palette, overlays, footer. |
| [08-deployables.md](./08-deployables.md) | The two artifacts, what is in each, and what `bundle.md` owes them. |
| [findings.md](./findings.md) | What phase 0 found: which decisions move, what each later phase owes, and the screenshot. |
| [refused.md](./refused.md) | What was considered and refused, with the argument. |
| [docs-migration.md](./docs-migration.md) | Every document under `docs/` that changes, which phase changes it, and how. |

## The phases

| Phase | File | What it delivers | What it unblocks | Waits on |
| --- | --- | --- | --- | --- |
| 0 | [phase-0-host-switch-and-toy.md](./phase-0-host-switch-and-toy.md) | **Shipped 2026-08-31.** `HOST` per host package; `apps/tui/` boots client-core under Node; fifteen kit nodes and both layouts on OpenTUI; the Notes pane drawn against a running `dev:node`, unchanged. Findings in [findings.md](./findings.md) | Proof the kit is intent, not layout. Everything after | Nothing |
| 1 | [phase-1-kit-complete.md](./phase-1-kit-complete.md) | **Shipped 2026-08-31.** All 74 nodes at their decided level; `roleCell()`; the theme as sixteen slots; one cell-buffer test per node; the presence tests became behaviour tests | Any pane | 0 |
| 2 | [phase-2-layouts-keys-focus.md](./phase-2-layouts-keys-focus.md) | **Shipped 2026-08-31.** The seven layout components and a host-supplied layout table; the keymap's terminal adapter with all four tiers; focus regions and collections without a DOM; traps as layers; the PTY natively | Every compiled pane | 1 |
| 3 | [phase-3-process-and-auth.md](./phase-3-process-and-auth.md) | **Shipped 2026-08-31.** The `acorn` command: attach or start, supervise, `--node` with probe, words, and pair; device token custody in a config directory; revoked on the footer; a boot test with a real node | Running against any node | 0 |
| 4 | [phase-4-chrome.md](./phase-4-chrome.md) | Rail, topbar, pane row, palette, overlays, footer; task and workspace switching | A usable workspace | 2, 3 |
| 5 | [phase-5-loaded-plugins.md](./phase-5-loaded-plugins.md) | The worker-thread sandbox, file custody, the trust prompt as a tree, the third column in `docs/security.md` | Third-party plugins in the TUI; rung 2 groundwork | 2 |
| 6 | [phase-6-panes-sweep.md](./phase-6-panes-sweep.md) | Every first-party pane checked at 80 by 24; `$EDITOR` handoff; docker exec; the agents transcript, composer, and approvals | Parity with the plugin table in 01-why.md | 4 |
| 7 | [phase-7-deployables.md](./phase-7-deployables.md) | `bin/acorn` in the node tarball and in the app bundle; the pack script grows the TUI entry; the native prebuild matrix gains OpenTUI's core; a bundled runtime | Shipping | 4, and `bundle.md` steps 2 to 4 |
| 8 | [phase-8-cleanup-and-docs.md](./phase-8-cleanup-and-docs.md) | Behaviour rehomed into owning docs, a new `docs/tui.md`, this folder deleted | Done | 7 |

## The order of work

Phase 0 stood alone and went first. It shipped on 2026-08-31 and bought the one fact every later
phase rests on: a first-party pane, written against the kit with no knowledge of a terminal, draws
legibly in one with no change to the pane. Nothing in the kit had to move.

What it drew was Notes, not http and linear: both of those ship only a tree bundle, so drawing either
means the phase 5 sandbox. [findings.md](./findings.md) has that and the rest, including three things a
later phase has to fix rather than work around — the pane registry names the DOM layout table, a
pending `lazy()` region is an empty string a cell host refuses, and OpenTUI needs Node 26.4 with
`--experimental-ffi`. **Read it before starting any phase below.**

Phase 1 shipped the same day. Every node draws from its sentence, and the two things it deliberately
left half-done — the clipboard button and the PTY rectangle — were both waiting on focus, which was
phase 2. Its own file says what else moved.

Phase 2 shipped the same day too. Every compiled pane now has a layout to mount into, a keyboard that
answers, and a rectangle that owns its keys; a `pty` rectangle draws a real emulator in cells and hands
its caller bytes in, keys out and a size. Two things it scoped are deliberately not done and are named
in its own file: the terminal and docker panes still write to an element rather than to that handle,
because nothing on this host mounts either until there is chrome. That is phase 6, after phase 4.

Phase 3 shipped the same day, and it was the one that could have run alongside anything: the process
model touches nothing the rendering work touches. `acorn` now opens the node for this machine's data
root — attaching to one that is running, starting and supervising one that is not — or a node
elsewhere, pairing with it over six words and a code. Two things it found are worth reading before
phase 4: the helper's supervisor could not be reused, and `nodeAdopt` and the tunnels are the two
seam verbs it left uninstalled because nothing draws them yet. Its own file says what else moved.

Phase 4 waits on 2 and 3, because chrome is layouts plus a live node. Phases 5 and 6 can run in parallel
after it: the sandbox is protocol and custody work, the pane sweep is reading each pane at 80 by 24 and
fixing what is unreadable. Phase 7 ships it. Phase 8 deletes this folder.

## How to work a phase

Each phase file has the same sections as the layout and client-plugins programmes: goal, why now,
scope, design detail, code touched, tests, docs owed, doors left open, done when, verify before
building. Two rules:

- **Verify before building.** File and line references were checked against the tree on 2026-08-30.
  Paths rot. Run the verify list at the end of each phase file before writing code.
- **Update the owning doc in the same change.** [docs-migration.md](./docs-migration.md) says which
  document owns each behaviour afterwards. A phase is not done until that document says the new true
  thing.

## What this folder is not

- It is not a web client. `docs/future/remote.md` owns the browser, the PWA, TLS, and the relay. The
  terminal shares its analysis of auth and custody and none of its browser constraints.
- It is not the cloud control plane. A hosted UI is a later host of the same tree and the same node
  API; when it is designed it will lean on this folder's process model and `remote.md`'s auth, and it
  is named here only so nobody reads "two deployables" as "two forever".
- It is not a place plugins write terminal UI. The plugin-by-plugin table in
  [01-why.md](./01-why.md) is what the kit gives them for free.
- It does not redesign the kit, the layouts, the tree protocol, or the keymap. Where the terminal
  finds one of them dishonest, the fix goes to the owning doc and the kit changes for every host.
- It does not schedule anything.
