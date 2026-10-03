# Editor details

This page covers the rules that make the workflow editor safe to type in, the graph view, the JSON
tab, saving, and where card positions are stored. The editor is in
`plugins/workflows/src/client/editor/`.

## The draft rules

These are why the editor is safe to type in:

- A new node takes one edge from the selected node, or none when nothing is selected. It is never
  inserted between two nodes, so adding a step changes nothing about what an existing step waits on.
- Deleting a node removes every edge that touched it and never bridges its predecessor to its
  successor. A chain that loses its middle becomes two roots, which is visible.
- Renaming changes only the display name. `${steps.<id>.output}`, every `after` entry, branch target,
  binding, and graph position continue to use the stable ID. The field accepts 1–200 characters.
- The picker offers a step as a predecessor only when the edge would be accepted, so a self edge, a
  duplicate and anything that closes a cycle are never on the list.
- Undo and redo cover the whole draft, with typing folded into one step inside a 600 ms window, 60
  deep.
- Save is grey only while the draft is unchanged or a write is in flight. A draft that does not
  validate still saves, because that is every workflow partway through being built: the footer says
  what is wrong, and **Run** is what refuses. A new definition has no steps, so the node list says so
  under its rows and the footer reports it.

## The graph view

**Graph** in the tab strip draws the same nodes as a picture: cards on a grid, the edges as curves,
the selected card the one the list has selected. The list column stays beside it on a wide layout and
collapses under it on a narrow one, which is the `list-detail` layout's own rule.

Drag from a card's bottom port onto another card to make it wait on the first. The `×` on a wire
removes that edge. Delete or Backspace removes the card the keys are on. Drag a card to put it where
you want it; it lands on a 22 px grid and stays there. Every one of those is the same draft operation
the inspector's own controls call, so the rules are the same: no self edge, no duplicate, nothing that
closes a cycle, and a delete never bridges what it stood between.

A card with no position of its own is placed from the edges: one rank below the deepest step it waits
on, sharing that rank with its siblings. So a new node appears at its rank without anybody placing it,
and moving a card is an override rather than a commitment to place the rest.

The canvas is the kit's `Graph` node, not this plugin's drawing
([ui-design.md](../ui-design/closed-kit.md) § The closed kit). That is what gives the terminal client this view
too: there it is the indented list, with a picker under it to draw an edge out of the selected card.

## The JSON tab

The escape hatch: the definition as the runner's own JSON, formatted. **Apply** is atomic. A document
that parses and is a definition replaces the draft; one that does not leaves the draft exactly as it
was, keeps the text for correction, and says what is wrong. **Format** reprints what is in the box
and **Revert** puts the draft's own projection back. Node positions are not in this document.

The box is a real editor, with highlighting, line numbers, and bracket matching, through
`mountEmbeddedEditor` on `@acorn/plugin-api/ui/editor`
([editor.md](../editor/document-surface.md) § A code box that is not a document), so this plugin holds no CodeMirror of
its own. The terminal client draws the same rectangle as a plain textarea, since it has no library to
draw one with.

## Saving

The header carries the editor's actions: AI authoring, Undo, Redo, Save, **Publish…** and **Run…**.
The rarer ones are in its overflow menu: **Schedule…**, **Export to repository…** and **Delete**,
which asks for a second press. A badge beside the name says **Not published** or which revision is
published, because Run and Schedule use the published revision, not the draft. The tab strip under
the header only picks the view.

**Save** flushes the draft at the revision it was read at. Autosave uses the same operation.
A stale revision answers 409 and opens conflict choices without discarding the local draft.
The editor keeps pending edits on their originating Node through navigation and cleanup. A held save
acknowledges only its submitted content. For ownership and recovery rules, see
[draft recovery and publication](./definitions.md#draft-recovery-and-publication).
**Publish…** opens a review dialog that names the dependency set. **Publish** makes the set
executable only after all writes complete. **Resume publishing** continues an interrupted operation.
For a repository or user file, Save persists the visual draft on the Node; **Publish…** checks
external edits and file dependencies, and **Write files** atomically replaces that file while leaving
the working tree uncommitted. A database definition uses **Export to repository…** to review and
write its portable published dependency graph. Dismissing a review dialog keeps the prepared review
on the Node; a strip under the header offers it again until it is published or discarded. The old direct Save to repo operation is
refused because it cannot provide that review or preserve every workspace original.

**Run…** opens the start dialog, one box per declared input with a task picker when no task is
in scope, and starts the run when the required ones are filled. A definition that declares no inputs
and already has a task starts without a dialog.

A committed or user file opens in the same visual editor with a recoverable Node draft and its file
destination visible in publication review. Parse failures preserve the file and direct the user to
repair its raw TOML; they never open an empty visual definition. An address that names no layer at
all says that instead, because unreadable and an empty draft are different states.

## Where positions live

Node positions for the graph view are device preferences under
`plugin:workflows:layout:<defId>`, never in the definition, so a definition stays portable and a
committed file has no x and y in its diff. A rename carries a node's position with it and deleting a
definition drops its layout. A drag writes 400 ms after it stops, and a draft with no row yet keeps
its positions in memory for the session.
