# Terminal focus

This page covers how the terminal client's region store owns focus: the five levels, where entering a
region lands, parent stops, how arrows move between stops, and how focus recovers. Read it before you
change `apps/tui/src/keys/regions.ts`. It's part of [the terminal client](../tui.md).

## Focus regions

`apps/tui/src/keys/regions.ts` owns focus, scopes, and navigation. `parentStops.ts` records strips
and their panels, and `collectionRegistry.ts` records collection rows and their identities. Every
focus move goes through `regions.ts`, which describes five levels:

```text
Screen
└─ Column           0 the rail, 1 the pane, 2 a second frame        right/left cross, no wrap
   └─ Region        Menu, Browse, Tasks, the pane strip, a layout's own regions   Tab cycles them
      └─ Parent stop   a strip that owns panels                    Down enters, Escape returns
         └─ Stop    a row, a control, a viewport holding no other stop
```

A layout registers each region with its ID and order, from its own knowledge of its regions.

### One focus value

Focus is a value the store holds, and nothing else decides it. One signal says which node has the
keys, and one function writes it, along with which region that is and what the region remembers.
Everything that moves the keys calls `focusRenderable`, which decides and reports whether they moved.
A node's `focus` and `blur` are no-ops kept as a one-way mirror in `paintCaret`.
`apps/tui/src/invariants.test.ts` counts the calls, and no source file outside a test asks anything
but the store where the keys are. A second owner of focus produces a lit border with dead arrows
whenever the two disagree.

The caret draws from the same value. A field asks the store whether it has the keys and writes the
answer into its props, where paint reads it.

The mouse is a hit test, not a focus event. The renderer finds the node a left click landed on and
bubbles it to the root. The store walks up to the nearest node that can hold the keys and focuses it.
A click with nothing focusable above it moves nothing. `autoFocus` is off wherever a renderer is
built, in `apps/tui/src/main.tsx` and both test harnesses, because otherwise the renderer would focus
an ancestor itself.

### Entering a region

Entering a region lands on, in order: a stop that asked for it, the first parent stop, the first
collection row, the first stop, or the region's own frame, walking depth first. The first is
`markEntry`, and the agents composer is its only caller, because you arrive at a chat to write.
Otherwise the rule is "the thing the bare keys drive", which is why landing in a filter box is
refused: `j` there types a `j`. A landing on the frame is never remembered, so the list that arrives a
moment later is what the next entry finds.

An entry stop that's a list lands on its roving row, not its first row. A region remembers a node, and
a node doesn't survive its list being rebuilt, but the collection's keyed `active` row does. That
matters most where entering also picks: Menu is entered with `pickOnEnter`, so landing on the first
row would choose a source and lose the one you left. A virtual list whose active row is off screen
falls back to the first row.

### Parent stops

`markParent(node, panels, cross)` marks a strip with panels, where `panels()` returns the boxes it
owns and `cross` answers Left and Right. From outside, it's one stop: Left and Right walk its tabs
without wrapping, and an edge bubbles to the column move. Down enters the panel it shows, Up goes to
the previous stop beside the strip, and Escape from inside the panel returns to it. Inside the panel,
Up on the first stop returns to the strip, and a bubbled Left or Right with no pane column that way
goes to the strip's `cross` ([keys](./keys.md#the-five-key-groups)). A strip that owns no panels,
such as GitHub's Open and Closed filter, is an ordinary control. The strip is a sibling of its panels,
so the panels list carries the walk up to it.

A strip's panels are discovered from what's drawn. A `TabPanel` registers its box under its
`idPrefix`, and a `Tabs` reads the set under the same prefix, so a plugin that draws the two halves in
sibling components gets this behavior for free. The DOM kit already requires `idPrefix` on both for
`aria-controls`. The `tabs` layout frames its panel with `Panel` and registers it under its
`stateKey`. `DocumentTabs` isn't a parent stop: the document a tab opens is a layout region, so it's a
horizontal collection where `←` and `→` open documents, Enter reopens the current one, and Delete
closes it.

### Arrows between stops

`down`/`j` and `up`/`k` on a control go to the next stop in reading order and reveal it in every
viewport around it. The neighbors are the stops of the control's panel, or its region where no panel
owns it. An edge is a wall, and an arrow never crosses a region, because Tab does that. `stopsIn` is
the walk, depth first over the tree. A parent stop counts once and its panels are skipped. A
collection counts once, as its caret row. A scroll viewport is transparent while it holds a stop and is
the stop otherwise. Anything else focusable counts once. `moveStop` answers false for whatever the walk
doesn't own, which is how a row hands the arrows to its collection.

The store is indexed. `stopsIn`, `regionOf`, `parentOf`, and `boxAround` look up a `Map` from box to
region, a `Map` from node to parent stop, a `Map` from box to collection, and a `Set` of every panel on
screen, instead of scanning arrays (`apps/tui/src/kit/grouping/panelRegistry.ts` § registerPanel). The
arrays stay for ordering, and `ordered()`, the region cycle, caches its sorted answer until a region
registers or a scope moves.

### Recovering focus

A focus decision that needs a node the current render hasn't produced waits in `ensureFocus`, queued
at most once per turn by `scheduleSettle`. It's a microtask, because Solid commits synchronously and
every node of the current render exists at the end of the task. `apps/tui/src/invariants.test.ts`
holds `keys/` to one `queueMicrotask` and the kit to none.

The pass asks one question: can the node that has the keys still hold them, and is it the real thing,
not a stand-in? Holding them means alive, visible all the way to the root, still `focusable`, and
inside the top scope. The walk up matters, because `visible` is per node, and the shell's main row
behind an overlay and an unshown `TabPanel` hide their descendants without telling them. A stand-in is
a region's frame while the region has an entry stop, or a collection's container while it has a live
active row. If the answer is yes, the pass reveals the stop and stops.

If not, four steps follow. A scope takes the stop it last had, then its first stop, then its own box.
On the screen, a region goes first: the region that still claims the keys, else the one the shell opens
on, else the first drawn. Inside it: its last stop, its entry stop, then its frame. A remembered stop
resolves by collection identity first, because a refresh redraws the same row as a new node.

Hiding a subtree asks for a pass. The shell's main row and the `ScrollViewport` a `TabPanel` uses hide
their contents instead of unmounting, so queries and models survive. Each schedules a landing pass when
it hides, so the keys never stay behind an overlay or on a switched-away rectangle.

A region and a scope each remember their own stops, and one focus move writes one memory. A dialog is
drawn inside the region that held the keys. If the region also remembered the dialog's rows, closing
the dialog would hand the keys to a destroyed row. So the scope remembers its own stops, the region
keeps its last stop, and closing a `Select` inside a `Modal` returns to that `Select`.
