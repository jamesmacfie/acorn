# Two-column panes

This page covers the `ListDetail` kit node: when to use it, its column widths and scrolling, and
collapsing a list to a rail. Read it before you put a list beside a detail. It's part of
[UI design](../ui-design.md).

## Two-column panes

`ListDetail` is a kit node, and it isn't the `list-detail` layout. A pane's regions are its outer
arrangement, and the host draws them ([pane layouts](../panes/layout.md#layout-model)). A split inside
one region is the pane's own, and this node draws it. The PR pane is both: a `single` layout whose one
region holds a `ListDetail`, because its two columns are one view over one model.

A pane or region that puts a list beside a detail uses this node, not its own grid. It owns the
split, the drag handle, the three column widths, the `--chrome-divider` between them, and each
column's flex and overflow. The widths are `narrow` for an identifier switcher, the default for a
browse list, and `wide` for a column that holds a document. GitHub, Workflows, and Memory reach it
through `SourceSurface`. Linear, Database, Rollbar, Docker, Editor, and the workflow editor use it
directly. HTTP and the compiled task panes whose list and detail are separate host regions use the
`list-detail` layout. Both paths resize the same way, so a plugin never supplies its own grid or
pointer handlers.

A list column is flush and scrolls its own rows. A column holding a document says so with `scroll`.
Then it scrolls as one region and takes the pane's inline padding, as `single` and
`header-body-footer` bodies do, and its rows, headers, and bars take the padding back. GitHub's browse
middle column, a pull request, is the example. A detail column holding a form or document can pass
`measure="page"`, which stops its content at `--page-measure`, 720px, from the column's start. A bar,
tab strip, or section header that's a direct child of the column still spans it, so put a header bar
there, not inside the capped form. A bar heading a scrolling detail column sits on its top edge, and
the content starts a section gap below.

The list column is flat, with no tint: one view divided by a rule. There's no opt-out prop.

A list column that can be removed passes `list={undefined}`, so `ListDetail` draws one track instead
of a zero-width first one. Notes' library toggle works this way.

### Collapsing to a rail

A sidebar that narrows to a rail says so with `collapseKey`. The column goes to `--tabrail-w`, the
icon rails' width, and the drag handle goes away. The control sits on the divider, because in the
`split` form the header belongs to a `ListColumn` the caller built, and a collapsed column has no
header left. When the contents have no rail form, `collapseContent="empty"` hides them while
collapsed but keeps them mounted, so inputs, search results, and scroll positions survive. The editor
uses this for its file tree and search panel.

The divider and its control are one node, `CollapseEdge`, drawn by both the kit's `ListDetail` and the
host's `list-detail` layout. A split that doesn't collapse gets the bare `SplitHandle`.

A column 48px wide has room for one mark, so every row in it takes a `collapsed` slot: the run state
for an agent, an avatar over a number for a pull request, or a state icon over a key for a ticket. The
slot's presence collapses the row, and the caller passes it from the same signal the column reads
(`kit/lib/layout/collapseState.ts`). Leading, body, meta, trailing, depth, nesting, and revealed
controls give way to it. The name comes back as the tooltip, from the row's `title`. A row's own
`tip` and `tipAt` stay as the tooltip, with `tipAt` as the name's second line in a rail. A row with a
`tip` drops the browser's `title` tooltip, so the two never open together.

The slot has the row's height and no more. A virtualized list takes its row height from
`--row-h-virt` on the document root (`kit/lib/layout/metrics.ts`), so a taller collapsed row would
break the scroll range.

Both tiers opt in. The kit node takes `collapseKey`, because it also draws splits of one document,
such as a pull request's section navigation, which has no rail form. A pane takes `collapsible`,
because a pane that collapses without giving its rows a rail form gets rows clipped mid-word. A pane
drawn from a remote tree can't read a host signal from its worker, so it resizes but doesn't collapse.

A section label and a pane's list header are both `.section-header`, and the stylesheet drops them in
a collapsed column. The `<section>` keeps its `aria-label`. A header holding a control reads the
collapse signal and draws the control itself, as the descriptor source panel does with its refresh
button.

The terminal ignores all of this. A rail of marks works only because hover brings the names back, and
the terminal has no hover. It shows one region at a time instead.

### One view or two

`ListDetail` isn't for two separate views. If the two columns are one view split by a divider, use
`ListDetail`. If they're two views side by side, use `.panes` and `.pane` from `styles/shell.css`:
inset views with a gap. Every browse source is the first case, including descriptor sources, which
`ChromeSourcePanel` hands to `SourceSurface` as two halves. `.panes` is for Home, Fleet, the task
view, and the empty state.

A pane that needs to span the shell grid uses `grid-column: 2 / -1`, never its own
`grid-template-columns` for `.panes`, which would only resemble the shell's widths and fight every
style pack's override.

`ListDetail` sets no narrow-width behavior. Stacking would need a container query, and
`container-type` makes the element a containing block for `position: fixed` descendants, which
mispositions any `Modal` inside. Narrowing is the layout's job: the `list-detail` layout carries the
narrow projection.
