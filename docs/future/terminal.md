# Terminal client: rendering acorn in a TUI

Design notes from the third-party-plugins session (2026-08-10), rewritten 2026-08-28 after the
layout programme changed the answer. Nothing here is scheduled. Companion to
[remote.md](./remote.md), which covers web and mobile; a terminal client is the third non-desktop
surface, and it is the strictest of the three, which is why it sets the vocabulary for the other two.

## The question, and how the answer changed

Could a plugin's UI render in a terminal? The 2026-08-10 analysis said: descriptors render anywhere
for free; a terminal frame is an optional, opt-in ANSI rectangle a plugin draws itself; and a
host-owned widget vocabulary (the Textual model) was rejected as "grow descriptors into a UI
framework."

[docs/future/layout/](./layout/README.md) reverses the third point, and the reversal is argued in
[layout/01-why.md](./layout/01-why.md) § A static schema versus a component tree. The thing rejected
was a static JSON schema. What the layout programme builds is a **remote component tree**: plugin
code runs in a sandbox and emits a tree of kit node names; the host mounts its own component per
node. The vocabulary is the kit that already exists, and the logic stays in the plugin, so the schema
never grows an `if`. That object was not on the table in August's analysis, and it is exactly the
one a terminal renderer needs: a tree of intents with no pixels in it.

So the terminal client stops being "descriptors plus an optional TUI frame per plugin" and becomes
**a second host for the same tree**. A plugin writes its UI once against the kit; the desktop draws
it with Solid and the terminal draws it with cells.

## What the layout programme owes this file

Everything a terminal host needs is a stated requirement of the layout programme, held by tests,
even though nothing here is built until after the PWA. From
[layout/09-doors-left-open.md](./layout/09-doors-left-open.md):

- Every kit node has an 80 by 24 monochrome rendering sentence and a row in `NODE_SUPPORT` with a
  `tui` column.
- Every layout has a terminal projection written before it lands.
- Role tokens never expose pixels; each role has a terminal value, including `ignored`.
- Nodes handle intents, never keys; `@opentui/keymap`'s terminal adapter maps `j`, `k`, `Enter`,
  `Escape`, and a leader key onto the same intent set.
- Collection state (`active`, `selected`, `offset`) is host-owned and keyed by identity.
- The tree protocol names nothing about the DOM.
- Rectangles are the only DOM-only thing, and `Rectangle kind="pty"` is native in a terminal.

## What a terminal client gets, and does not

From the survey in [layout/02-survey.md](./layout/02-survey.md): sessions, transcript, tool cards,
composer, and approvals for agents; the PR list, checks, conversation, and diff for github; stage,
diff, notes, commit, and push for changes; the file tree and a read-only text view for the editor;
containers, logs, stats, and exec for docker; all of context, memory, notes, http, linear, rollbar;
SQL as a text region and results as a table for database.

Not: Monaco (editing hands off to `$EDITOR`), the preview page, image attachments as images, charts
beyond block and braille characters, hover. The PTY, the one rectangle that defines an agent
workspace, is the thing a terminal does best.

## Isolation is still the hard problem

This part of the original analysis stands unchanged. A terminal has no iframe, so plugin code cannot
run in the TUI host's own process without creating a third tier that wears the frame tier's
enforced-permission claims with the node half's disclosed-only weakness. The layout programme's
desktop sandbox is a Web Worker; the terminal's is a Node worker thread or child process under real
permission flags, speaking the same bridge protocol over a pipe, with the broker and `scopes.ts`
staying host-side. Same allowlist, different transport; the realm moves, the choke point does not.

Two inversions to record when this becomes real. First, a terminal client pairing with a node and
receiving a bundle needs the same bytes-hash trust store the desktop has, but there is no desktop
helper to do the hashing and hold custody; the TUI process is shell and broker at once, which puts it
between desktop and web on the trust ladder, and `docs/security.md`'s trust model needs a third
column. Second, this work is a down payment on node-half containment
(`docs/security.md § The containment ladder`, rung 2): plugin code out of process, the context
becoming authorised calls rather than an object. Design the two together.

## What comparable systems do

Kept from the original survey because each still informs one decision:

- **Zellij**: sandboxed WASM plugins given a cell rectangle. The model for the isolation boundary,
  not for the rendering.
- **OpenTUI**: a TypeScript TUI with a Zig render core and a Solid reconciler; its `@opentui/keymap`
  package is the keymap engine the layout programme adopts, with the terminal adapter already
  written. (<https://github.com/anomalyco/opentui>)
- **Textual**: widgets declare bindings, the focus chain is derived from the tree, active bindings
  render as a footer. The model for the keyboard story.
- **ratatui**: immediate mode, selection state owned outside the widget. The lesson the host-owned
  collection store takes.
- **VS Code**: never solved "webview in a terminal"; descriptors carry its remote surfaces. The tree
  is what lets acorn do better.

## Decisions to carry forward

1. **One tree, two hosts.** No plugin writes terminal-specific UI. A plugin that needs pixels has a
   rectangle and is absent in the terminal, except the PTY.
2. **The terminal is the strict host and sets the kit's vocabulary**, even before it exists. A node
   that cannot be drawn at 80 by 24 is a rectangle, not a node.
3. **Same bridge, new carrier.** The SDK verbs stay the single contract; the terminal adds a
   transport and a cell renderer, nothing else.
4. **Isolation before rendering.** The out-of-process sandbox is designed with rung 2, not as a
   terminal-only invention.
5. **Sequence: layout programme, then the PWA, then a toy terminal host on `list-detail` and
   `header-body-footer` pointed at http and linear, then the rest.** The toy host is the cheapest
   test that the kit is intent and not layout, and the layout programme's phase 4 suggests building
   it before the agents pane moves.
