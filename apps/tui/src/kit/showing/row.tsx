/** @jsxImportSource @acorn/tui/jsx */
import { Show, type JSX } from 'solid-js'
import type { Renderable } from '../../tree/compat'
import type { ItemProps } from '../../keys/collection'
import { hasNode, Line, slot } from '../cells'

/** The fewest cells a row's own words are worth. Below it the row stops giving and runs off the right
 *  edge instead, where the frame cuts it — so in a twenty-eight cell rail a pull request reads as its
 *  number and its title, and the timestamp and the row actions are simply not there. The alternative
 *  is a row where every field is present and none of them is legible, which is what this host drew
 *  while its parts still shrank. */
const TITLE_CELLS = 16

/** The order a row gives up cells in when it is wider than the panel it is drawn in: the trailing
 *  controls first, then the meta, then the title, and never the caret or the leading glyphs. Yoga
 *  shrinks a child in proportion to `flexShrink` times its width, so these are ranks rather than
 *  ratios — a row action gives up its last cell before the title gives up its first. */
const SHRINK = { title: 1, meta: 20, trailing: 100 }

/** One of a row's fixed parts, in a box that holds its own width.
 *
 *  A component rather than a function returning JSX, and the difference matters on a retained
 *  renderer: a function called from inside the row's JSX runs again whenever the row's props are read
 *  again, and each run tries to put the caller's *same* renderables inside a *new* box — reparenting
 *  the whole part on every read, which used to surface as "already destroyed, skipping add" and now
 *  is merely churn the retained tree never needed. The `Show` builds the box once and only the
 *  contents move. */
function Part(props: { shrink: number; children: JSX.Element }) {
  return (
    <Show when={props.children}>
      <box flexDirection="row" gap={1} flexShrink={props.shrink} overflow="hidden">{slot(props.children)}</box>
    </Show>
  )
}

/** One line: the caret for where the keys are, the leading slot, the title, the meta at the far end.
 *
 *  `reveal` hides the trailing controls until hover on the DOM. There is no hover, so they always
 *  show — noted in the node's row in the 80×24 table.
 *
 *  `collapsed` is the other prop this host answers by ignoring. It is the row at the width of the
 *  DOM shell's icon rails, and it is legible there only because the name it drops comes back as a
 *  tooltip on hover. There is no hover here and no `tip` in this host's facade (./ui.ts), so a rail
 *  row in cells would be a column of marks with no way left to read them. The terminal narrows by
 *  showing one region at a time instead (../layouts/ListDetail.tsx), which loses no names. */
export function Row(props: {
  item?: ItemProps
  metaFields?: number
  selected?: boolean
  nested?: boolean
  depth?: number
  reveal?: boolean
  density?: 'compact' | 'default' | 'roomy'
  onPress?: () => void
  /** Accepted for kit parity. A terminal has no double-click activation gesture. */
  onDoublePress?: () => void
  href?: string
  offset?: number
  height?: number
  label?: string
  onHover?: (entered: boolean) => void
  variant?: 'default' | 'stacked' | 'tree'
  leading?: JSX.Element
  trailing?: JSX.Element
  /** Keep a host-owned disclosure visible, allowing the title to give up its normal cell floor. */
  keepTrailing?: boolean
  meta?: JSX.Element
  collapsed?: JSX.Element
  title?: string
  /** Accepted for kit parity, like Text's. A terminal has no hover to open a tooltip on. */
  tip?: string
  tipAt?: number
  children: JSX.Element
}) {
  // The active row is the collection's, the selected row is the pane's, and in a terminal they are
  // drawn by the same two cells: a caret for where the keys are, the `match` role for what is chosen.
  const isActive = () => !!props.item?.active()
  // A row inside a collection hands its press over, so `activate` can reach it: on the DOM a `Row` is
  // a button and Enter on it raises a click by itself, and there is no element here to do that
  // (../../keys/collection.ts).
  if (props.item) props.item.press(() => props.onPress?.())
  // The parts of a row that keep their cells when the row is wider than the panel it is in. A `text`
  // is a box to yoga, so a row of them at a width they do not fit is a row of boxes each shrunk and
  // each clipping its own content — the failure ../cells.tsx § Run already names, one level up:
  // `[ST]` drew as `[ST`, the gaps closed, and the one-cell caret column shrank to nothing, so a
  // focused list looked exactly like an unfocused one. Only the title gives; everything else holds
  // its width and the row clips at the frame.
  return (
    <box
      flexDirection="row"
      gap={1}
      flexShrink={0}
      overflow="hidden"
      paddingLeft={props.depth ? props.depth * 2 : 0}
      ref={(element: Renderable) => {
        // A collection row can hold focus and become a region's first stop. `NODE_FOCUS` marks a
        // standalone `Row` as an item, so it has no stop until a collection supplies `item`.
        if (!props.item) return
        element.focusable = true
        props.item.ref(element)
      }}
    >
      <box flexShrink={0}><Line tone="accent">{isActive() ? '›' : ' '}</Line></box>
      <Part shrink={0}>{props.leading}</Part>
      {/* Words get the row's own role; a tree brought its own, and the row only decides how the parts
          sit. `stacked` is a title over a subtitle, which is what it is on the DOM — drawing both on
          one line ran the agents session titles into their model names with no space between
          (docs/tui.md). */}
      <box
        flexShrink={SHRINK.title}
        minWidth={props.keepTrailing ? 1 : TITLE_CELLS}
        overflow="hidden"
        flexDirection={props.variant === 'stacked' ? 'column' : 'row'}
        gap={props.variant === 'stacked' ? 0 : 1}
      >
        <Show
          when={hasNode(props.children)}
          fallback={<Line role={props.selected ? 'match' : 'body'}>{props.children}</Line>}
        >
          {/* A title written as several texts, such as a pull's number and then its title, holds
              its natural width in a box that does not shrink, and the box above clips it. Shrunk
              texts each clip their own content, and the gap between them closed: "#100Older pull". */}
          <Show when={props.variant !== 'stacked'} fallback={slot(props.children)}>
            <box flexDirection="row" gap={1} flexShrink={0}>{slot(props.children)}</box>
          </Show>
        </Show>
      </box>
      <box flexGrow={1} />
      <Part shrink={SHRINK.meta}>{props.meta}</Part>
      <Part shrink={props.keepTrailing ? 0 : SHRINK.trailing}>{props.trailing}</Part>
    </box>
  )
}

/** `Row` indented by `depth` with `▸` or `▾`. A wrapper, as on the DOM, so `Row`'s API stays flat. */
export function TreeRow(props: {
  item?: ItemProps
  /** Pixel placement belongs to the DOM host; cells use their collection viewport. */
  offset?: number
  height?: number
  expandable?: boolean
  expanded?: boolean
  onToggle?: () => void
  depth?: number
  selected?: boolean
  onPress?: () => void
  /** Accepted for kit parity. A terminal has no double-click activation gesture. */
  onDoublePress?: () => void
  leading?: JSX.Element
  trailing?: JSX.Element
  keepTrailing?: boolean
  meta?: JSX.Element
  reveal?: boolean
  collapsed?: JSX.Element
  title?: string
  children: JSX.Element
}) {
  return (
    <Row
      item={props.item}
      selected={props.selected}
      depth={props.depth}
      density="compact"
      variant="tree"
      meta={props.meta}
      trailing={props.trailing}
      keepTrailing={props.keepTrailing}
      onPress={props.onPress}
      leading={<box flexDirection="row" gap={1}><Line>{props.expandable ? (props.expanded ? '▾' : '▸') : ' '}</Line>{slot(props.leading)}</box>}
    >
      {props.children}
    </Row>
  )
}

/** The row's actions at the right end, always drawn, never on hover.
 *
 *  Its children are a render prop taking the menu's own context, because a `Menu.Item` needs it to
 *  close the list — and drawing them directly handed that function to Solid, which called it with
 *  nothing and left every item with `context: undefined`. Found by the pane sweep, on the agents
 *  session list (docs/tui.md).
 *
 *  The DOM's is an ellipsis button opening a menu. Here the items are labeled controls. There is no
 *  pointer to open a hover menu with, so the context they are handed
 *  closes nothing, because there is no list to close.
 */
export function RowActions(props: { ariaLabel: string; children: (menu: { close: () => void }) => JSX.Element }) {
  return <box flexDirection="row" gap={1}>{props.children({ close: () => {} })}</box>
}

