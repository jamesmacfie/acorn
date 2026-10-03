# Pane regions

This page covers what the host does inside a pane's regions: the inset, the reading width, the layout
state it keeps, hidden regions, splits a plugin draws inside a region, and the wizard. It's part of
[panes](../panes.md). [Pane layouts](./layout.md) owns the region names.

## The host owns a region's inset

A region's contents are a plugin's tree, and the kit takes no `class`. So a chip row or a composer
sitting flush against the pane's border is something a plugin can't fix from inside. Every region
that holds content takes the pane's inline padding:

- The scrolling bodies of `single`, `header-body-footer`, and `tabs`.
- Both pinned strips of `header-body-footer`.
- The detail column and footer of `list-detail`.
- A `ListDetail` node's own detail column when it sets `scroll`.

Chrome in a list footer stays full-bleed, and its fields and action rows keep the inset.

Two kinds of child drop the region's padding, because the whole region is theirs. A `ListDetail`
node's divider is its columns' shared edge and its columns pad themselves. A diff is a canvas.

Everything else that runs edge to edge pulls the padding back out with a negative margin, at
whatever depth it sits: a `Toolbar`, a `Tabs` strip, a pane-level `SectionHeader`, and a `Row`. Each
carries the pane's padding itself and has a background that has to reach the pane's edge, such as a
bar's tint and rule or a row's selection and accent marker. Depth matters, because a plugin's tree is
one `Stack` at its root with its bars below that.

Two things stop the pull-back. A `Card` owns its own inset, so a bar or a row inside one lines up
with the card's edge. An `actions` `Toolbar` is a footer with no background and no padding, so it has
nothing to pull back.

A scroller in between passes the padding on instead of clipping it. `overflow` clips at the padding
box, so a bar pulled left of a `TabPanel`'s content box would land outside it, where a browser won't
scroll. So `TabPanel`, `Rows`, `Timeline`, and the grid scroller each take over the region's padding,
out by one pane padding and back in by one. A bar inside sits exactly on the clip edge. This nests: a
`Rows` scroller inside a `TabPanel` does the same against the panel.

The `list-detail` detail column also takes a small pad below its last child and a gap between its
children, because its bottom child is usually a composer or a row of actions. A `ListDetail` node or
a diff drops both, along with the inline padding. Two bars in a row get no gap, so a subagent bar
under the agents pane header shares an edge with it.

### The reading width

The reading column stops at `--pane-measure`, 1200px in `tokens-style.css`, and centers in whatever
width the pane has. Without it, an agent transcript on a 3700px display ran to about 480 characters
a line. Two children are exempt:

- Chrome, because a bar's background has to reach the pane's edge. A `Toolbar` and a `Tabs` strip
  stay full-bleed.
- A scroller. The cap goes on the list inside it, because a narrowed scroller leaves a dead gutter
  on each side where the wheel does nothing.

## Layout state

The host keeps the state a layout needs under the pane ID: which tab a `tabs` pane shows, and where a
`list-detail` or `stack-split` handle sits. It's session-only, because it's a reading position, not a
preference.

A pane whose panels point at each other can pick a tab through `selectPaneTab` on
`@acorn/plugin-api/ui/host`. That's the only way to change the selection, so a pane never keeps a
second copy of it.

A pane can also hide a region, which drops it and gives its space to the rest. Notes uses this for
its library column, and the narrow projections need the same mechanism.

A region is a component, not an element, so a layout that draws one region at a time mounts only
that one. Regions of one pane mount independently, so anything two of them share has to outlive both.
[Pane models](./models.md) owns that.

## A split inside a region is the plugin's

A pane's regions are its outer arrangement. A `ListDetail` drawn inside one region is a different
object with a different owner. That's why `ListDetail` and `DocumentTabs` are kit nodes as well as
layout names. The PR pane is a `single` layout whose one region is a kit `Sections` node: the pull
request's parts beside its diff, the same node the GitHub browse view draws. The parts are one view
over one model, not regions the host mounts apart.

`Sections` exists because a browse source's detail region isn't a pane and can't name a layout, yet
it wants a different arrangement on each host. So the shape is a kit node, and both pane and source
can use it. The desktop draws a header over a column of folds beside the main region. The terminal
draws a strip of tabs over one panel ([the closed kit](../ui-design/closed-kit.md)). When there's a
main region, the desktop's shared `ListDetail` control closes the section column to its edge and
keeps the content mounted.

The node takes its two columns in two ways. A caller with an element to spare passes the left one as
`list`. A caller that can't, such as a remote tree whose props are JSON on a message port, passes a
`ListColumn` and a `DetailColumn` as children and sets `split`. Below 80 columns, the first form draws
the detail alone and the second stacks its two children. The node has no keys of its own to switch
with, and two 38-cell columns are too narrow to read.

## The wizard

A wizard is the one arrangement a surface that isn't a pane can use. Onboarding is a component in
the `overlay` slot, so it imports `Wizard` from `@acorn/plugin-api/ui/host` and fills its `step`
region. Every other surface names a layout on its contribution and never imports one.

The step body holds content only. The footer holds every action, in this order:

1. Skip, at the start (`skipLabel`, `onSkip`, `skipTip`).
2. **Back**.
3. The primary action. It's **Next** with the step's own `nextLabel`, such as "Continue" or "Add a
   project to continue" while `canAdvance` is false. On the last step it's the finish action
   (`finishLabel`, `onFinish`).

A busy step passes `canAdvance={false}`, so the primary can't be pressed twice.

The strip numbers its steps, and a finished step shows a check instead of its number. The step body
scrolls between the strip and the footer and has padding on every side, so a long step scrolls
instead of pushing content under the footer. In a dialog, the wizard keeps one height on every step,
so the footer doesn't move under the pointer.
