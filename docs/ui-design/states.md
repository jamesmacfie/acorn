# States and accessibility

This page covers interaction states, the data states every Node-backed view shows, empty states, and
the shared accessibility and density rules. It's part of [UI design](../ui-design.md).

## States

A node's interaction states belong to the host and live outside the node: `focused` and `pressed` for
every stop, `active`, `selected`, and `offset` for every collection, and `hovered` on the desktop
only. `keys/collectionState.ts` keys them by the item's own key, so a list keeps its place and
selection across a refetch.

### Connection and staleness vocabulary

Every Node-backed view can show live, refreshing, stale, offline, disabled, or error. Stale data keeps
its last value and names the Node. Offline, reads come from the cache with a badge, and writes fail
fast with a clear "Node offline" error and keep what you typed. An empty state says whether a feature
is unconfigured, waiting on a provider, disabled, or has no data.

The states rank like this:

1. `disabled`, the plugin is off, wins over everything, because it isn't a data state.
2. An unreachable Node outranks `refreshing`, because a fetch against an offline Node will fail, and
   calling it refreshing would be a spinner that never ends.
3. `degraded`, where the WebSocket is down but HTTP answers, counts as `stale`, because reads work but
   live events don't update the screen.

No view shows a spinner without a deadline. Past the deadline it resolves to `stale`, `offline`, or
`error`. `error` means there's no data and retrying is the useful next step. A row served from the
cache uses `stale` or `offline`, because it has data. The age beside `stale` or `offline` reads
"never" when the Node hasn't answered once this session.

### Empty states

An empty page, pane, or detail column, such as a detail with nothing selected, draws the centered
`EmptyState` with a title that says what's missing. A list's "no rows" line stands in for the rows,
so it uses `align="start" size="sm"`. A start-aligned empty state in a detail column with no header
would land on the header line beside the collapse control and look like a header without its bar.

## Accessibility and density

Focus rings, keyboard traversal, text labels, tooltip delays, and reduced-motion tokens come from
client-core's kit. Dense layouts keep a readable line height and a visible focus target. Style packs
can compress spacing but mustn't hide status or action controls.

Keyboard traversal comes from the tree, not from each pane. Each kit node's focus role is fixed in
`kit/tokens/focusRoles.ts`, a plugin sets none of it, and the ARIA follows from the role: a `Rows`
renders `listbox` or `tree` with `aria-activedescendant`, a tab strip renders `tablist`, and a dialog
renders `dialog` with `aria-modal` and hands focus back to its opener. Hover is never required:
anything a pointer reaches, focus reaches, so a `RowActions` that shows on hover shows on focus too.

Desktop tab lists stay on one row and scroll sideways when their labels don't fit. The selected tab
scrolls into view, and controls beside the list stay visible. GitHub, Docker, HTTP, Rollbar, Linear,
and host `tabs` layouts use the kit's `Tabs`. Editor and terminal document tabs keep their close and
status controls, and Home dashboard tabs keep rename and per-tab actions. All three follow the same
scroll rule. The rail and pane switcher are navigation controls with their own layout rules.

A long list sets `virtual` on its `Rows` and changes nothing else. The scroller, row placement, and
density become the kit's, and the collection stays keyed over the whole list, so the arrows still walk
past the last row on screen.
