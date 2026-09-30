import { Show, type JSX } from 'solid-js'
import type { ItemProps } from '../../keys/collection'
import { Row } from './Row'

/* TreeRow: a Row with a disclosure twist and a depth, kept a wrapper so Row's API stays flat.

   Tree container semantics come from `Rows tree`, which is the container: it gives each row its
   `treeitem` role and its place in the roving focus, and turns the left and right arrows into the
   `collapse` and `expand` intents. A `TreeRow` outside one is a lone stop with a twist. */
export function TreeRow(props: {
  /** The collection's props for this row, from `Rows tree`. Forwarded to `Row`. */
  item?: ItemProps
  expandable?: boolean
  expanded?: boolean
  onToggle?: () => void
  depth?: number
  selected?: boolean
  onPress?: () => void
  onDoublePress?: () => void
  leading?: JSX.Element
  trailing?: JSX.Element
  /** Trailing metadata: Row's slot, forwarded. */
  meta?: JSX.Element
  /** Hide `trailing` until hover or focus. */
  reveal?: boolean
  /** This row at rail width: `Row`'s slot, forwarded. The twist goes with the indentation it belongs
   *  to, since a tree at 48px has no room to show depth and nothing to reparent by. */
  collapsed?: JSX.Element
  /** `Row`'s `collapsedIcon`, forwarded. */
  collapsedIcon?: string
  /** The accessible name, and a collapsed row's tooltip. */
  label?: string
  title?: string
  children: JSX.Element
}) {
  return (
    <Row
      item={props.item}
      selected={props.selected}
      depth={props.depth}
      reveal={props.reveal}
      collapsed={props.collapsed}
      collapsedIcon={props.collapsedIcon}
      density="compact"
      variant="tree"
      label={props.label}
      title={props.title}
      meta={props.meta}
      onPress={props.onPress}
      onDoublePress={props.onDoublePress}
      leading={
        <>
          <Show
            when={props.expandable}
            // A non-expandable row still reserves the twist's width, or sibling labels misalign.
            fallback={<span class="ui-row-twist" data-empty="" aria-hidden="true" />}
          >
            <span
              class="ui-row-twist"
              role="button"
              tabindex={-1}
              aria-expanded={props.expanded}
              aria-label={props.expanded ? 'Collapse' : 'Expand'}
              onClick={(event) => {
                // The row's own activate must not also fire: expanding is not opening.
                event.stopPropagation()
                props.onToggle?.()
              }}
            />
          </Show>
          {props.leading}
        </>
      }
      trailing={props.trailing}
    >
      {props.children}
    </Row>
  )
}
